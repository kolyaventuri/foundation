import {describe, expect, it, vi} from 'vitest';
import type {InventoryGraph} from '@ha-repair/contracts';
import {enrichScan} from './index';

type OpenAiRequestBody = {
  input?: string;
  instructions?: string;
  model?: string;
  text?: {
    format?: {
      name?: string;
      type?: string;
    };
  };
};

const inventory: InventoryGraph = {
  areas: [],
  automations: [],
  devices: [],
  entities: [
    {
      disabledBy: null,
      displayName: 'Kitchen Light',
      entityId: 'light.kitchen_light',
      isStale: false,
      name: null,
    },
    {
      disabledBy: null,
      displayName: 'Kitchen Light',
      entityId: 'sensor.kitchen_light_power',
      isStale: true,
      name: null,
    },
  ],
  floors: [],
  labels: [],
  scenes: [],
  source: 'mock',
};

describe('llm', () => {
  it('skips OpenAI enrichment when the API key is missing', async () => {
    await expect(
      enrichScan({
        findings: [],
        inventory,
        provider: 'openai',
      }),
    ).resolves.toMatchObject({
      error: 'OPENAI_API_KEY is not configured.',
      provider: 'openai',
      status: 'skipped',
    });
  });

  it('uses the Responses API through the OpenAI SDK and parses summaries', async () => {
    let requestUrl = '';
    let requestMethod = '';
    let requestHeaders: Headers | undefined;
    let requestBody: OpenAiRequestBody | undefined;
    const mockedFetch = vi.fn(async (input: unknown, init?: RequestInit) => {
      requestUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input instanceof Request
              ? input.url
              : '';
      requestMethod = init?.method ?? '';
      requestHeaders = new Headers(init?.headers);

      const parsedBody = JSON.parse(String(init?.body)) as unknown;
      requestBody = parsedBody as OpenAiRequestBody;

      return new Response(
        JSON.stringify({
          created_at: 1,
          error: null,
          id: 'resp_123',
          incomplete_details: null,
          model: 'gpt-5-nano',
          object: 'response',
          output: [
            {
              content: [
                {
                  text: JSON.stringify({
                    summaries: [
                      {
                        findingId: 'duplicate_name:Kitchen Light',
                        summary:
                          'Kitchen Light is duplicated across two entities.',
                      },
                    ],
                  }),
                  type: 'output_text',
                },
              ],
              id: 'msg_123',
              role: 'assistant',
              type: 'message',
            },
          ],
          output_text: JSON.stringify({
            summaries: [
              {
                findingId: 'duplicate_name:Kitchen Light',
                summary: 'Kitchen Light is duplicated across two entities.',
              },
            ],
          }),
          status: 'completed',
        }),
        {
          headers: {
            'content-type': 'application/json',
          },
          status: 200,
        },
      );
    });

    await expect(
      enrichScan(
        {
          findings: [
            {
              evidence:
                'Entities light.kitchen_light and sensor.kitchen_light_power share the same display name.',
              id: 'duplicate_name:Kitchen Light',
              kind: 'duplicate_name',
              objectIds: ['light.kitchen_light', 'sensor.kitchen_light_power'],
              severity: 'medium',
              title: 'Duplicate name: Kitchen Light',
            },
          ],
          inventory,
          provider: 'openai',
        },
        {
          env: {
            OPENAI_API_KEY: 'test-key',
            OPENAI_BASE_URL: 'https://gateway.example/v1',
          },
          fetch: mockedFetch,
        },
      ),
    ).resolves.toMatchObject({
      findingSummaries: [
        {
          findingId: 'duplicate_name:Kitchen Light',
          summary: 'Kitchen Light is duplicated across two entities.',
        },
      ],
      model: 'gpt-5-nano',
      provider: 'openai',
      status: 'completed',
    });

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(requestUrl).toBe('https://gateway.example/v1/responses');
    expect(requestMethod).toBe('POST');
    expect(requestHeaders?.get('content-type')).toBe('application/json');
    expect(requestBody?.instructions).toContain(
      'Return output that matches the requested JSON schema.',
    );
    expect(requestBody?.input).toContain(
      'Summarize each Home Assistant finding',
    );
    expect(requestBody?.input).toContain('duplicate_name:Kitchen Light');
    expect(requestBody?.model).toBe('gpt-5-nano');
    expect(requestBody?.text?.format).toMatchObject({
      name: 'finding_summaries',
      type: 'json_schema',
    });
  });
});
