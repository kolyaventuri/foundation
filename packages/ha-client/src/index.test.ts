import {describe, expect, it} from 'vitest';
import {
  collectMockInventory,
  normalizeBaseUrl,
  probeCapabilities,
  testConnection,
} from './index';

describe('ha-client', () => {
  it('normalizes trailing slashes', () => {
    expect(normalizeBaseUrl('http://homeassistant.local:8123///')).toBe(
      'http://homeassistant.local:8123',
    );
  });

  it('probes mocked capabilities from endpoint posture', () => {
    expect(probeCapabilities('http://ha.local:8123').labels).toBe(
      'unsupported',
    );
    expect(probeCapabilities('https://ha.local:8123').labels).toBe('supported');
  });

  it('collects a baseline mock inventory fixture', () => {
    const inventory = collectMockInventory();

    expect(inventory.source).toBe('mock');
    expect(inventory.entities.length).toBeGreaterThan(0);
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
