import fastify from 'fastify';
import cors from '@fastify/cors';
import type {
  ConnectionProfile,
  ConnectionTestResponse,
  FrameworkApiResponse,
  HealthResponse,
  ScanCreateResponse,
  ScanFindingsResponse,
  ScanRun,
} from '@ha-repair/contracts';
import {collectMockInventory, testConnection} from '@ha-repair/ha-client';
import {listProviderDescriptors} from '@ha-repair/llm';
import {createFrameworkSummary, runScan} from '@ha-repair/scan-engine';

const scanHistory = new Map<string, ScanRun>();

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
    '/api/connections/test',
    async (request) => {
      const {baseUrl, configPath, name, token} = request.body;
      const profile: ConnectionProfile = {
        baseUrl: baseUrl ?? '',
        name: name ?? 'default',
        token: token ?? '',
        ...(configPath ? {configPath} : {}),
      };

      const response: ConnectionTestResponse = {
        result: await testConnection(profile),
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
        return reply.code(404).send({
          error: 'scan_not_found',
        });
      }

      return {
        scan,
      };
    },
  );

  server.get<{Params: {id: string}}>(
    '/api/scans/:id/findings',
    async (request, reply) => {
      const scan = scanHistory.get(request.params.id);

      if (!scan) {
        return reply.code(404).send({
          error: 'scan_not_found',
        });
      }

      const response: ScanFindingsResponse = {
        findings: scan.findings,
        scanId: scan.id,
      };

      return response;
    },
  );

  server.get('/api/history', async () => {
    return {
      scans: [...scanHistory.values()].map((scan) => ({
        createdAt: scan.createdAt,
        findingsCount: scan.findings.length,
        id: scan.id,
      })),
    };
  });

  return server;
}
