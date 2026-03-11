import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import type {FastifyInstance} from 'fastify';
import type {
  ConnectionTestResponse,
  ScanCreateResponse,
  ScanFindingsResponse,
  ScanHistoryResponse,
  ScanReadResponse,
} from '@ha-repair/contracts';
import {createServer} from './server';

let server: FastifyInstance;

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

beforeEach(() => {
  server = createServer();
});

afterEach(async () => {
  await server.close();
});

describe('api server', () => {
  it('tests profile connections through the phase-a endpoint', async () => {
    const response = await server.inject({
      method: 'POST',
      payload: {
        baseUrl: 'https://ha.local:8123',
        token: 'abc123',
      },
      url: '/api/profiles/test',
    });

    expect(response.statusCode).toBe(200);

    const body = parseJson<ConnectionTestResponse>(response.body);
    expect(body.result.ok).toBe(true);
    expect(body.result.capabilities.labels).toBe('supported');
  });

  it('supports scan lifecycle endpoints and history', async () => {
    const createResponse = await server.inject({
      method: 'POST',
      url: '/api/scans',
    });

    expect(createResponse.statusCode).toBe(200);
    const created = parseJson<ScanCreateResponse>(createResponse.body);
    expect(created.scan.id).toEqual(expect.any(String));
    expect(created.scan.findings.length).toBeGreaterThan(0);

    const scanResponse = await server.inject({
      method: 'GET',
      url: `/api/scans/${created.scan.id}`,
    });

    expect(scanResponse.statusCode).toBe(200);
    const scanBody = parseJson<ScanReadResponse>(scanResponse.body);
    expect(scanBody.scan.id).toBe(created.scan.id);

    const findingsResponse = await server.inject({
      method: 'GET',
      url: `/api/scans/${created.scan.id}/findings`,
    });

    expect(findingsResponse.statusCode).toBe(200);
    const findingsBody = parseJson<ScanFindingsResponse>(findingsResponse.body);
    expect(findingsBody.scanId).toBe(created.scan.id);

    const historyResponse = await server.inject({
      method: 'GET',
      url: '/api/history',
    });

    expect(historyResponse.statusCode).toBe(200);
    const historyBody = parseJson<ScanHistoryResponse>(historyResponse.body);
    expect(historyBody.scans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          findingsCount: created.scan.findings.length,
          id: created.scan.id,
        }),
      ]),
    );
  });
});
