import fastify from 'fastify';
import cors from '@fastify/cors';
import type {
  ApiErrorResponse,
  ConnectionProfile,
  ConnectionTestResponse,
  FrameworkApiResponse,
  HealthResponse,
  ScanCreateResponse,
  ScanFindingsResponse,
  ScanHistoryResponse,
  ScanReadResponse,
  ScanRun,
} from '@ha-repair/contracts';
import {collectMockInventory, testConnection} from '@ha-repair/ha-client';
import {listProviderDescriptors} from '@ha-repair/llm';
import {createFrameworkSummary, runScan} from '@ha-repair/scan-engine';

const scanHistory = new Map<string, ScanRun>();

function buildConnectionProfile(
  payload: Partial<ConnectionProfile>,
): ConnectionProfile {
  const {baseUrl, configPath, name, token} = payload;

  return {
    baseUrl: baseUrl ?? '',
    name: name ?? 'default',
    token: token ?? '',
    ...(configPath ? {configPath} : {}),
  };
}

export function createServer() {
  const server = fastify({
    logger: true,
  });

  void server.register(cors, {
    origin: true,
  });

  server.get('/health', async () => {
    const response: HealthResponse = {
      service: 'api',
      status: 'ok',
      timestamp: new Date().toISOString(),
    };

    return response;
  });

  server.get('/api/framework', async () => {
    const response: FrameworkApiResponse = {
      framework: createFrameworkSummary(),
      providers: listProviderDescriptors(),
    };

    return response;
  });

  server.post<{Body: Partial<ConnectionProfile>}>(
    '/api/profiles/test',
    async (request) => {
      const response: ConnectionTestResponse = {
        result: await testConnection(buildConnectionProfile(request.body)),
      };

      return response;
    },
  );

  server.post<{Body: Partial<ConnectionProfile>}>(
    '/api/connections/test',
    async (request) => {
      const response: ConnectionTestResponse = {
        result: await testConnection(buildConnectionProfile(request.body)),
      };

      return response;
    },
  );

  server.post('/api/scans', async () => {
    const scan = runScan(collectMockInventory());
    scanHistory.set(scan.id, scan);

    const response: ScanCreateResponse = {
      scan,
    };

    return response;
  });

  server.get<{Params: {id: string}}>(
    '/api/scans/:id',
    async (request, reply) => {
      const scan = scanHistory.get(request.params.id);

      if (!scan) {
        const errorResponse: ApiErrorResponse = {
          error: 'scan_not_found',
        };

        return reply.code(404).send(errorResponse);
      }

      const response: ScanReadResponse = {
        scan,
      };

      return response;
    },
  );

  server.get<{Params: {id: string}}>(
    '/api/scans/:id/findings',
    async (request, reply) => {
      const scan = scanHistory.get(request.params.id);

      if (!scan) {
        const errorResponse: ApiErrorResponse = {
          error: 'scan_not_found',
        };

        return reply.code(404).send(errorResponse);
      }

      const response: ScanFindingsResponse = {
        findings: scan.findings,
        scanId: scan.id,
      };

      return response;
    },
  );

  server.get('/api/history', async () => {
    const response: ScanHistoryResponse = {
      scans: [...scanHistory.values()].map((scan) => ({
        createdAt: scan.createdAt,
        findingsCount: scan.findings.length,
        id: scan.id,
      })),
    };

    return response;
  });

  return server;
}
