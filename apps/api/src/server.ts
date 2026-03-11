import fastify from 'fastify';
import cors from '@fastify/cors';
import type {
  ApiErrorResponse,
  ConnectionProfile,
  ConnectionTestResponse,
  FixApplyRequest,
  FixApplyResponse,
  FixPreviewRequest,
  FixPreviewResponse,
  FrameworkApiResponse,
  HealthResponse,
  ProfileListResponse,
  ProfileReadResponse,
  ScanCreateRequest,
  ScanCreateResponse,
  ScanFindingsResponse,
  ScanHistoryResponse,
  ScanReadResponse,
} from '@ha-repair/contracts';
import {listProviderDescriptors} from '@ha-repair/llm';
import {createFrameworkSummary} from '@ha-repair/scan-engine';
import {
  createRepairService,
  type RepairServiceOptions,
  RepairServiceError,
} from '@ha-repair/storage';

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

function sendErrorResponse(error: unknown): [number, ApiErrorResponse] {
  if (error instanceof RepairServiceError) {
    return [
      error.statusCode,
      {
        error: error.code,
      },
    ];
  }

  return [
    500,
    {
      error: 'internal_error',
    },
  ];
}

export async function createServer(options: RepairServiceOptions = {}) {
  const repairService = await createRepairService(options);
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
        result: await repairService.testInlineProfile(
          buildConnectionProfile(request.body),
        ),
      };

      return response;
    },
  );

  server.post<{Body: Partial<ConnectionProfile>}>(
    '/api/connections/test',
    async (request) => {
      const response: ConnectionTestResponse = {
        result: await repairService.testInlineProfile(
          buildConnectionProfile(request.body),
        ),
      };

      return response;
    },
  );

  server.get('/api/profiles', async () => {
    const response: ProfileListResponse = {
      profiles: await repairService.listProfiles(),
    };

    return response;
  });

  server.post<{Body: Partial<ConnectionProfile>}>(
    '/api/profiles',
    async (request, reply) => {
      try {
        const response: ProfileReadResponse = {
          profile: await repairService.saveProfile(
            buildConnectionProfile(request.body),
          ),
        };

        return response;
      } catch (error) {
        const [statusCode, payload] = sendErrorResponse(error);
        return reply.code(statusCode).send(payload);
      }
    },
  );

  server.get<{Params: {name: string}}>(
    '/api/profiles/:name',
    async (request, reply) => {
      try {
        const response: ProfileReadResponse = {
          profile: await repairService.getProfile(request.params.name),
        };

        return response;
      } catch (error) {
        const [statusCode, payload] = sendErrorResponse(error);
        return reply.code(statusCode).send(payload);
      }
    },
  );

  server.delete<{Params: {name: string}}>(
    '/api/profiles/:name',
    async (request, reply) => {
      try {
        return await repairService.deleteProfile(request.params.name);
      } catch (error) {
        const [statusCode, payload] = sendErrorResponse(error);
        return reply.code(statusCode).send(payload);
      }
    },
  );

  server.post<{Params: {name: string}}>(
    '/api/profiles/:name/test',
    async (request, reply) => {
      try {
        const response: ConnectionTestResponse = {
          result: await repairService.testSavedProfile(request.params.name),
        };

        return response;
      } catch (error) {
        const [statusCode, payload] = sendErrorResponse(error);
        return reply.code(statusCode).send(payload);
      }
    },
  );

  server.post<{Params: {name: string}}>(
    '/api/profiles/:name/default',
    async (request, reply) => {
      try {
        const response: ProfileReadResponse = {
          profile: await repairService.setDefaultProfile(request.params.name),
        };

        return response;
      } catch (error) {
        const [statusCode, payload] = sendErrorResponse(error);
        return reply.code(statusCode).send(payload);
      }
    },
  );

  server.post<{Body: ScanCreateRequest}>(
    '/api/scans',
    async (request, reply) => {
      try {
        const response: ScanCreateResponse = {
          scan: await repairService.createScan(request.body ?? {}),
        };

        return response;
      } catch (error) {
        const [statusCode, payload] = sendErrorResponse(error);
        return reply.code(statusCode).send(payload);
      }
    },
  );

  server.get<{Params: {id: string}}>(
    '/api/scans/:id',
    async (request, reply) => {
      try {
        const response: ScanReadResponse = {
          scan: await repairService.getScan(request.params.id),
        };

        return response;
      } catch (error) {
        const [statusCode, payload] = sendErrorResponse(error);
        return reply.code(statusCode).send(payload);
      }
    },
  );

  server.get<{Params: {id: string}}>(
    '/api/scans/:id/findings',
    async (request, reply) => {
      try {
        const findings = await repairService.getScanFindings(request.params.id);
        const response: ScanFindingsResponse = {
          findings,
          scanId: request.params.id,
        };

        return response;
      } catch (error) {
        const [statusCode, payload] = sendErrorResponse(error);
        return reply.code(statusCode).send(payload);
      }
    },
  );

  server.get('/api/history', async () => {
    const response: ScanHistoryResponse = {
      scans: await repairService.listHistory(),
    };

    return response;
  });

  server.post<{Body: FixPreviewRequest}>(
    '/api/fixes/preview',
    async (request, reply) => {
      try {
        const response: FixPreviewResponse = await repairService.previewFixes(
          request.body,
        );

        return response;
      } catch (error) {
        const [statusCode, payload] = sendErrorResponse(error);
        return reply.code(statusCode).send(payload);
      }
    },
  );

  server.post<{Body: FixApplyRequest}>(
    '/api/fixes/apply',
    async (request, reply) => {
      try {
        const response: FixApplyResponse = await repairService.applyFixes(
          request.body,
        );

        return response;
      } catch (error) {
        const [statusCode, payload] = sendErrorResponse(error);
        return reply.code(statusCode).send(payload);
      }
    },
  );

  server.addHook('onClose', async () => {
    await repairService.close();
  });

  return server;
}
