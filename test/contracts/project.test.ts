import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveLogsDir } from '../../src/contracts/project.ts';

describe('resolveLogsDir', () => {
  it('prefers --logs, then VESTIGIUM_LOGS_DIR, then <project>/logs', () => {
    const env = { VESTIGIUM_LOGS_DIR: resolve('/from-env') };
    expect(resolveLogsDir('/project', resolve('/explicit'), env)).toBe(resolve('/explicit'));
    expect(resolveLogsDir('/project', undefined, env)).toBe(resolve('/from-env'));
    expect(resolveLogsDir('/project', undefined, {})).toBe(resolve('/project', 'logs'));
    expect(resolveLogsDir('/project', undefined, { VESTIGIUM_LOGS_DIR: '' })).toBe(resolve('/project', 'logs'));
  });
});
