import {describe, expect, it} from 'vitest';
import {normalizeBaseUrl, testConnection} from './index';

describe('ha-client', () => {
  it('normalizes trailing slashes', () => {
    expect(normalizeBaseUrl('http://homeassistant.local:8123///')).toBe(
      'http://homeassistant.local:8123',
    );
  });

  it('reports a mock healthy connection when url and token exist', async () => {
    await expect(
      testConnection({
        baseUrl: 'http://ha.local:8123/',
        name: 'primary',
        token: 'abc123',
      }),
    ).resolves.toMatchObject({
      endpoint: 'http://ha.local:8123',
      mode: 'mock',
      ok: true,
    });
  });
});
