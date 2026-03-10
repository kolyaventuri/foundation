import type {ConnectionProfile, ConnectionResult} from '@ha-repair/contracts';

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/u, '');
}

export async function testConnection(
  profile: ConnectionProfile,
): Promise<ConnectionResult> {
  const endpoint = normalizeBaseUrl(profile.baseUrl);

  return {
    checkedAt: new Date().toISOString(),
    endpoint,
    latencyMs: 0,
    mode: 'mock',
    ok: endpoint.length > 0 && profile.token.trim().length > 0,
  };
}

export {normalizeBaseUrl};
