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

function resolveFetch(override?: typeof fetch): typeof fetch {
  if (override) {
    return override;
  }

  if (typeof fetch !== 'function') {
    throw new TypeError('Global fetch is not available for LLM enrichment.');
  }

  return fetch;
}

function buildPrompt(findings: Finding[], inventory: InventoryGraph): string {
  const compactFindings = findings.map((finding) => ({
    evidence: finding.evidence,
    findingId: finding.id,
    severity: finding.severity,
    title: finding.title,
  }));

  return [
    'Summarize each Home Assistant finding in one short operator-facing sentence.',
    'Do not invent new findings, severity changes, or remediation steps.',
    'Return JSON with shape {"summaries":[{"findingId":"...","summary":"..."}]}.',
    JSON.stringify({
      findingCount: findings.length,
      findings: compactFindings,
      inventorySource: inventory.source,
    }),
  ].join('\n');
}

function parseJsonResponse(content: string): SummaryPayload {
  return JSON.parse(content) as SummaryPayload;
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
  const baseUrl =
    options.env?.OPENAI_BASE_URL?.trim() ?? 'https://api.openai.com/v1';
  const response = await resolveFetch(options.fetch)(
    `${baseUrl}/chat/completions`,
    {
      body: JSON.stringify({
        messages: [
          {
            content:
              'You summarize existing Home Assistant findings. Return strict JSON only.',
            role: 'system',
          },
          {
            content: buildPrompt(request.findings, request.inventory),
            role: 'user',
          },
        ],
        model,
        temperature: 0.2,
      }),
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  );

  if (!response.ok) {
    return {
      error: `OpenAI enrichment failed with ${response.status}.`,
      findingSummaries: [],
      model,
      provider: 'openai',
      status: 'failed',
    };
  }

  const payload = (await response.json()) as {
    choices?: Array<{message?: {content?: string | null}}>;
  };
  const content = payload.choices?.[0]?.message?.content?.trim();

  if (!content) {
    return {
      error: 'OpenAI enrichment returned no content.',
      findingSummaries: [],
      model,
      provider: 'openai',
      status: 'failed',
    };
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
          content: buildPrompt(request.findings, request.inventory),
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
    return {
      error: `Ollama enrichment failed with ${response.status}.`,
      findingSummaries: [],
      model,
      provider: 'ollama',
      status: 'failed',
    };
  }

  const payload = (await response.json()) as {
    message?: {content?: string | null};
  };
  const content = payload.message?.content?.trim();

  if (!content) {
    return {
      error: 'Ollama enrichment returned no content.',
      findingSummaries: [],
      model,
      provider: 'ollama',
      status: 'failed',
    };
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
