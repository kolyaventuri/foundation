type MockCommandResult = {
  result?: unknown;
  success: boolean;
};

type LiveHomeAssistantMockOptions = {
  backupServiceResponse?: unknown;
  config?: Record<string, unknown>;
  downloadBody?: Uint8Array;
  downloadStatus?: number;
  services?: Array<Record<string, unknown>>;
  signPathResponse?: {path?: string};
  states?: Array<Record<string, unknown>>;
  webSocketResults?: Partial<Record<string, MockCommandResult>>;
};

const defaultServices = [
  {
    domain: 'backup',
    services: {
      create: {},
    },
  },
];

const defaultConfig = {
  location_name: 'Test Home',
};

const defaultStates = [
  {
    attributes: {
      friendly_name: 'Kitchen Light',
    },
    entity_id: 'light.kitchen_light',
    state: 'on',
  },
];

const defaultWebSocketResults: Record<string, MockCommandResult> = {
  'config/area_registry/list': {
    result: [
      {
        area_id: 'area.kitchen',
        name: 'Kitchen',
      },
    ],
    success: true,
  },
  'config/device_registry/list': {
    result: [
      {
        area_id: 'area.kitchen',
        floor_id: 'floor.main',
        id: 'device.kitchen_light',
        labels: ['label.energy'],
        name: 'Kitchen Light',
      },
    ],
    success: true,
  },
  'config/entity_registry/list': {
    result: [
      {
        area_id: 'area.kitchen',
        device_id: 'device.kitchen_light',
        entity_id: 'light.kitchen_light',
        floor_id: 'floor.main',
        labels: ['label.energy'],
        name: 'Kitchen Light',
        options: {
          alexa: {
            should_expose: true,
          },
        },
      },
    ],
    success: true,
  },
  'config/floor_registry/list': {
    result: [
      {
        floor_id: 'floor.main',
        name: 'Main Floor',
      },
    ],
    success: true,
  },
  'config/label_registry/list': {
    result: [
      {
        label_id: 'label.energy',
        name: 'Energy',
      },
    ],
    success: true,
  },
};

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json',
    },
    status,
  });
}

export function createLiveHomeAssistantMocks(
  options: LiveHomeAssistantMockOptions = {},
) {
  const commandResults = {
    ...defaultWebSocketResults,
    ...options.webSocketResults,
  };

  const fetchMock: typeof fetch = async (input) => {
    const url = String(input);

    if (url.endsWith('/api/services')) {
      return createJsonResponse(options.services ?? defaultServices);
    }

    if (url.endsWith('/api/config')) {
      return createJsonResponse(options.config ?? defaultConfig);
    }

    if (url.endsWith('/api/states')) {
      return createJsonResponse(options.states ?? defaultStates);
    }

    if (url.includes('/api/services/backup/')) {
      return createJsonResponse(options.backupServiceResponse ?? {});
    }

    if (url.endsWith('/auth/sign_path')) {
      return createJsonResponse(options.signPathResponse ?? {});
    }

    if (url.includes('/download/')) {
      return new Response(options.downloadBody ?? new Uint8Array([1, 2, 3]), {
        status: options.downloadStatus ?? 200,
      });
    }

    throw new Error(`Unexpected fetch URL in test mock: ${url}`);
  };

  class MockWebSocket {
    private readonly listeners = new Map<
      string,
      Array<(event: unknown) => void>
    >();

    constructor(_url: string) {
      queueMicrotask(() => {
        this.emit('message', {
          data: JSON.stringify({type: 'auth_required'}),
        });
      });
    }

    addEventListener(
      type: 'close' | 'error' | 'message' | 'open',
      listener: (event: unknown) => void,
    ) {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    close() {
      return undefined;
    }

    send(data: string) {
      const payload = JSON.parse(data) as {
        access_token?: string;
        id?: number;
        type: string;
      };

      if (payload.type === 'auth') {
        queueMicrotask(() => {
          this.emit('message', {
            data: JSON.stringify({type: 'auth_ok'}),
          });
        });
        return;
      }

      const result = commandResults[payload.type] ?? {
        result: [],
        success: true,
      };

      queueMicrotask(() => {
        this.emit('message', {
          data: JSON.stringify({
            id: payload.id,
            result: result.result,
            success: result.success,
            type: 'result',
          }),
        });
      });
    }

    private emit(type: string, event: unknown) {
      for (const listener of this.listeners.get(type) ?? []) {
        listener(event);
      }
    }
  }

  return {
    WebSocketCtor: MockWebSocket,
    fetch: fetchMock,
  };
}
