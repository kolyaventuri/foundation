export type ProviderKind = 'none' | 'ollama' | 'openai';
export type SurfaceState = 'ready' | 'planned';

export type ConnectionProfile = {
  baseUrl: string;
  configPath?: string;
  name: string;
  token: string;
};

export type ConnectionResult = {
  checkedAt: string;
  endpoint: string;
  latencyMs: number;
  mode: 'mock';
  ok: boolean;
};

export type ConnectionTestResponse = {
  result: ConnectionResult;
};

export type RuntimeSurface = {
  id: string;
  name: string;
  state: SurfaceState;
  summary: string;
};

export type FrameworkSummary = {
  priorities: string[];
  surfaces: RuntimeSurface[];
  tagline: string;
  title: string;
};

export type ProviderDescriptor = {
  description: string;
  id: ProviderKind;
  label: string;
};

export type FrameworkApiResponse = {
  framework: FrameworkSummary;
  providers: ProviderDescriptor[];
};

export type HealthResponse = {
  service: 'api';
  status: 'ok';
  timestamp: string;
};
