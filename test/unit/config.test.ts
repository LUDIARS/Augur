import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config/config.ts';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('loadConfig', () => {
  it('reads defaults from augur.config.json', () => {
    const config = loadConfig();
    expect(config.port).toBeGreaterThan(0);
    expect(config.logLevel).toBeDefined();
  });

  it('overrides port from AUGUR_PORT', () => {
    vi.stubEnv('AUGUR_PORT', '5555');
    expect(loadConfig().port).toBe(5555);
  });

  it('fails fast on invalid AUGUR_PORT instead of silently falling back', () => {
    vi.stubEnv('AUGUR_PORT', 'not-a-port');
    expect(() => loadConfig()).toThrow(/AUGUR_PORT/);
  });

  it('fails fast on invalid AUGUR_LOG_LEVEL instead of silently falling back', () => {
    vi.stubEnv('AUGUR_LOG_LEVEL', 'verbose');
    expect(() => loadConfig()).toThrow(/AUGUR_LOG_LEVEL/);
  });
});
