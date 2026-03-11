import {readFile} from 'node:fs/promises';
import path from 'node:path';
import OpenAI from 'openai';
import type {
  Finding,
  InventoryGraph,
  ProviderDescriptor,
  ProviderKind,
  ScanEnrichment,
} from '@ha-repair/contracts';

type EnrichScanRequest = {
  findings: Finding[];
  inventory: InventoryGraph;
  provider: ProviderKind;
};

type EnrichScanOptions = {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
};

type SummaryPayload = {
  summaries: Array<{
    findingId: string;
    summary: string;
  }>;
};

type PromptTemplateName =
  | 'entity-categorization'
  | 'entity-renaming'
  | 'finding-summaries';

type PromptRole = 'system' | 'user';

type ResponsePayload = {
  output?: Array<{
    content?: Array<{
      text?: string | null;
      type?: string;
    }>;
    type?: string;
  }>;
  output_text?: string | null;
};

const providers: ProviderDescriptor[] = [
  {
    description:
      'Deterministic-only mode for offline usage, testing, and rule-engine baselines.',
    id: 'none',
    label: 'No provider',
  },
  {
    description:
      'Local-first inference through Ollama for private categorization and naming help.',
    id: 'ollama',
    label: 'Ollama',
  },
  {
    description:
      'Hosted enrichment for higher-quality classification and repair summaries when enabled.',
    id: 'openai',
    label: 'OpenAI',
  },
];

const promptDirectory = path.resolve(__dirname, '../prompts');
const promptCache = new Map<string, Promise<string>>();
const findingSummarySchema = {
  additionalProperties: false,
  properties: {
    summaries: {
      items: {
        additionalProperties: false,
        properties: {
          findingId: {
            type: 'string',
          },
          summary: {
            type: 'string',
          },
        },
        required: ['findingId', 'summary'],
        type: 'object',
      },
      type: 'array',
    },
  },
  required: ['summaries'],
  type: 'object',
} as const;

function resolveFetch(override?: typeof fetch): typeof fetch {
  if (override) {
    return override;
  }

  if (typeof fetch !== 'function') {
    throw new TypeError('Global fetch is not available for LLM enrichment.');
  }

  return fetch;
}

function buildFindingSummaryContext(
  findings: Finding[],
  inventory: InventoryGraph,
): string {
  const compactFindings = findings.map((finding) => ({
    evidence: finding.evidence,
    findingId: finding.id,
    severity: finding.severity,
    title: finding.title,
  }));

  return JSON.stringify({
    findingCount: findings.length,
    findings: compactFindings,
    inventorySource: inventory.source,
  });
}

function parseJsonResponse(content: string): SummaryPayload {
  const parsed = JSON.parse(content) as Partial<SummaryPayload>;

  if (!Array.isArray(parsed.summaries)) {
    throw new TypeError('LLM response is missing a summaries array.');
  }

  return {
    summaries: parsed.summaries.map((summary) => {
      if (
        !summary ||
        typeof summary.findingId !== 'string' ||
        typeof summary.summary !== 'string'
      ) {
        throw new TypeError('LLM response contains an invalid summary item.');
      }

      return {
        findingId: summary.findingId,
        summary: summary.summary,
      };
    }),
  };
}

function renderPromptTemplate(
  template: string,
  variables: Record<string, string>,
): string {
  return template.replaceAll(/{{(\w+)}}/g, (match, key: string) => {
    const value = variables[key];

    if (typeof value !== 'string') {
      throw new TypeError(`Prompt variable "${key}" is not defined.`);
    }

    return value;
  });
}

async function loadPromptTemplate(
  name: PromptTemplateName,
  role: PromptRole,
): Promise<string> {
  const cacheKey = `${name}:${role}`;
  const cached = promptCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const template = readFile(
    path.join(promptDirectory, `${name}.${role}.txt`),
    'utf8',
  );
  promptCache.set(cacheKey, template);
  return template;
}

async function renderPromptPair(
  name: PromptTemplateName,
  variables: Record<string, string>,
) {
  const [systemTemplate, userTemplate] = await Promise.all([
    loadPromptTemplate(name, 'system'),
    loadPromptTemplate(name, 'user'),
  ]);

  return {
    system: renderPromptTemplate(systemTemplate, variables),
    user: renderPromptTemplate(userTemplate, variables),
  };
}

function extractResponseText(payload: ResponsePayload): string | undefined {
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  for (const item of payload.output ?? []) {
    if (item.type !== 'message') {
      continue;
    }

    for (const content of item.content ?? []) {
      if (content.type === 'output_text' && typeof content.text === 'string') {
        const text = content.text.trim();

        if (text) {
          return text;
        }
      }
    }
  }
}

function formatProviderFailure(
  provider: ProviderKind,
  model: string,
  error: string,
): ScanEnrichment {
  return {
    error,
    findingSummaries: [],
    model,
    provider,
    status: 'failed',
  };
}

async function runOpenAiAdapter(
  request: EnrichScanRequest,
  options: EnrichScanOptions,
): Promise<ScanEnrichment> {
  const apiKey = options.env?.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    return {
      error: 'OPENAI_API_KEY is not configured.',
      findingSummaries: [],
      provider: 'openai',
      status: 'skipped',
    };
  }

  const model = options.env?.OPENAI_MODEL?.trim() ?? 'gpt-4.1-mini';
  const prompts = await renderPromptPair('finding-summaries', {
    context_json: buildFindingSummaryContext(
      request.findings,
      request.inventory,
    ),
  });
  const client = new OpenAI({
    apiKey,
    ...(options.env?.OPENAI_BASE_URL?.trim()
      ? {baseURL: options.env.OPENAI_BASE_URL.trim()}
      : {}),
    ...(options.fetch ? {fetch: options.fetch} : {}),
  });

  let payload: ResponsePayload;

  try {
    payload = (await client.responses.create({
      input: prompts.user,
      instructions: prompts.system,
      model,
      temperature: 0.2,
      text: {
        format: {
          name: 'finding_summaries',
          schema: findingSummarySchema,
          strict: true,
          type: 'json_schema',
        },
      },
    })) as ResponsePayload;
  } catch (error) {
    const status =
      typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      typeof error.status === 'number'
        ? error.status
        : undefined;

    return formatProviderFailure(
      'openai',
      model,
      status
        ? `OpenAI enrichment failed with ${status}.`
        : error instanceof Error
          ? error.message
          : 'Unknown OpenAI enrichment error',
    );
  }

  const content = extractResponseText(payload);

  if (!content) {
    return formatProviderFailure(
      'openai',
      model,
      'OpenAI enrichment returned no content.',
    );
  }

  const parsed = parseJsonResponse(content);

  return {
    findingSummaries: parsed.summaries,
    generatedAt: new Date().toISOString(),
    model,
    provider: 'openai',
    status: 'completed',
  };
}

async function runOllamaAdapter(
  request: EnrichScanRequest,
  options: EnrichScanOptions,
): Promise<ScanEnrichment> {
  const model = options.env?.OLLAMA_MODEL?.trim() ?? 'llama3.1';
  const baseUrl =
    options.env?.OLLAMA_BASE_URL?.trim() ?? 'http://127.0.0.1:11434';
  const response = await resolveFetch(options.fetch)(`${baseUrl}/api/chat`, {
    body: JSON.stringify({
      messages: [
        {
          content:
            'You summarize existing Home Assistant findings. Return strict JSON only.',
          role: 'system',
        },
        {
          content: [
            'Summarize each Home Assistant finding in one short operator-facing sentence.',
            'Do not invent new findings, severity changes, or remediation steps.',
            'Return JSON with shape {"summaries":[{"findingId":"...","summary":"..."}]}.',
            buildFindingSummaryContext(request.findings, request.inventory),
          ].join('\n'),
          role: 'user',
        },
      ],
      model,
      stream: false,
    }),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  });

  if (!response.ok) {
    return formatProviderFailure(
      'ollama',
      model,
      `Ollama enrichment failed with ${response.status}.`,
    );
  }

  const payload = (await response.json()) as {
    message?: {content?: string | null};
  };
  const content = payload.message?.content?.trim();

  if (!content) {
    return formatProviderFailure(
      'ollama',
      model,
      'Ollama enrichment returned no content.',
    );
  }

  const parsed = parseJsonResponse(content);

  return {
    findingSummaries: parsed.summaries,
    generatedAt: new Date().toISOString(),
    model,
    provider: 'ollama',
    status: 'completed',
  };
}

export async function enrichScan(
  request: EnrichScanRequest,
  options: EnrichScanOptions = {},
): Promise<ScanEnrichment> {
  if (request.provider === 'none') {
    return {
      findingSummaries: [],
      provider: 'none',
      status: 'disabled',
    };
  }

  try {
    if (request.provider === 'openai') {
      return await runOpenAiAdapter(request, options);
    }

    return await runOllamaAdapter(request, options);
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : 'Unknown enrichment error',
      findingSummaries: [],
      provider: request.provider,
      status: 'failed',
    };
  }
}

export function listProviderDescriptors() {
  return providers;
}
