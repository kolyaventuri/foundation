import fastify from 'fastify';
import cors from '@fastify/cors';
import type {
  ConnectionProfile,
  ConnectionTestResponse,
  FrameworkApiResponse,
  HealthResponse,
} from '@ha-repair/contracts';
import {testConnection} from '@ha-repair/ha-client';
import {listProviderDescriptors} from '@ha-repair/llm';
import {createFrameworkSummary} from '@ha-repair/scan-engine';

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

  return server;
}
