import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { verifyQsLock } from '../../scripts/security/verify-qs-lock.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const baseline = execFileSync('git', ['show', 'bd67b93efb56570fd51548e3f6117dc2680f9d49:package-lock.json'], { cwd: root, encoding: 'utf8' });
const candidate = readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8');

describe('qs release-only lock update', () => {
  it('accepts the fixed release and rejects the vulnerable baseline', () => {
    expect(verifyQsLock(candidate, baseline)).toBe(true);
    expect(verifyQsLock(baseline, baseline)).toBe(false);
  });

  it('rejects unrelated dependency changes and altered integrity', () => {
    const other = JSON.parse(candidate);
    other.packages['node_modules/express'].version = '99.0.0';
    expect(verifyQsLock(JSON.stringify(other), baseline)).toBe(false);
    const tampered = JSON.parse(candidate);
    tampered.packages['node_modules/qs'].integrity = 'sha512-invalid';
    expect(verifyQsLock(JSON.stringify(tampered), baseline)).toBe(false);
  });
});
