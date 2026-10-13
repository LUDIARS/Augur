import { describe, expect, it } from 'vitest';
import { readContractRuntimeTemplate } from '../../src/contracts/runtime-files.ts';
import {
  CONTRACT_RUNTIME_TEMPLATE_VERSION,
  inspectContractRuntime,
  renderContractRuntime,
  runtimeFlavorOf,
} from '../../src/contracts/runtime-template.ts';

const TEMPLATE = 'export const a = 1;\n';

describe('contract runtime template distribution', () => {
  it('maps file extensions to the typed or plain template', () => {
    expect(runtimeFlavorOf('src/contract-runtime.ts')).toBe('ts');
    expect(runtimeFlavorOf('src/contract-runtime.mts')).toBe('ts');
    expect(runtimeFlavorOf('src/contract-runtime.mjs')).toBe('mjs');
    expect(runtimeFlavorOf('src/contract-runtime.js')).toBe('mjs');
    expect(runtimeFlavorOf('src/contract-runtime.cjs')).toBeNull();
  });

  it('renders a header with the template version and body hash, and reads it back as current', () => {
    const rendered = renderContractRuntime(TEMPLATE);
    expect(rendered.split('\n')[0]).toMatch(new RegExp(`^// augur-contract-runtime version=${CONTRACT_RUNTIME_TEMPLATE_VERSION} sha256=[0-9a-f]{64}$`));
    expect(rendered.endsWith(TEMPLATE)).toBe(true);
    expect(inspectContractRuntime(rendered, TEMPLATE)).toMatchObject({ state: 'current', version: CONTRACT_RUNTIME_TEMPLATE_VERSION });
    // A checkout with autocrlf must not read as drift.
    expect(inspectContractRuntime(rendered.replace(/\n/g, '\r\n'), TEMPLATE).state).toBe('current');
  });

  it('tells missing, hand-written, edited and outdated copies apart', () => {
    const rendered = renderContractRuntime(TEMPLATE);
    expect(inspectContractRuntime(undefined, TEMPLATE).state).toBe('missing');
    expect(inspectContractRuntime(TEMPLATE, TEMPLATE).state).toBe('unmanaged');
    expect(inspectContractRuntime(`${rendered}// local tweak\n`, TEMPLATE).state).toBe('modified');
    expect(inspectContractRuntime(rendered, 'export const a = 2;\n').state).toBe('outdated');
    const olderVersion = rendered.replace(`version=${CONTRACT_RUNTIME_TEMPLATE_VERSION}`, 'version=1');
    expect(inspectContractRuntime(olderVersion, TEMPLATE).state).toBe('outdated');
  });

  it('ships both flavors of the template', () => {
    for (const flavor of ['ts', 'mjs'] as const) {
      const text = readContractRuntimeTemplate(flavor);
      expect(text).toContain('export function contract');
      expect(text).toContain('AUGUR_CONTRACT_LOG_RETENTION_DAYS');
    }
  });
});
