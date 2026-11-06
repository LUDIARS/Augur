import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { verifyQsLock } from '../../scripts/security/verify-qs-lock.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const baseline = execFileSync('git', ['show', 'bd67b93efb56570fd51548e3f6117dc2680f9d49:package-lock.json'], { cwd: root, encoding: 'utf8' });
const current = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8')) as {
  packages: Record<string, Record<string, unknown>>;
};

/**
 * The release-only update as it landed: the baseline with only qs moved to the
 * fixed release. Later dependency additions change the rest of the lock, so the
 * delta rule is exercised on this reconstruction, and the current lock is held
 * to the fixed qs entry itself.
 */
function releaseOnlyUpdate(): string {
  const lock = JSON.parse(baseline) as typeof current;
  lock.packages['node_modules/qs'] = current.packages['node_modules/qs']!;
  return JSON.stringify(lock);
}

describe('qs release-only lock update', () => {
  it('keeps qs on the fixed release in the current lock', () => {
    expect(current.packages['node_modules/qs']).toMatchObject({
      version: '6.16.2',
      resolved: 'https://registry.npmjs.org/qs/-/qs-6.16.2.tgz',
      integrity: 'sha512-VYdnB5S7/0IeXzBacUtwNAaM6d7Y/PgYnNC7bJCI6meqA/OgnsQbZMtVW8Dt2D1PHgbHGtYmhSoEIgvt7xZ2ZA==',
    });
  });

  it('accepts the fixed release and rejects the vulnerable baseline', () => {
    expect(verifyQsLock(releaseOnlyUpdate(), baseline)).toBe(true);
    expect(verifyQsLock(baseline, baseline)).toBe(false);
  });

  it('rejects unrelated dependency changes and altered integrity', () => {
    const other = JSON.parse(releaseOnlyUpdate());
    other.packages['node_modules/express'].version = '99.0.0';
    expect(verifyQsLock(JSON.stringify(other), baseline)).toBe(false);
    const tampered = JSON.parse(releaseOnlyUpdate());
    tampered.packages['node_modules/qs'].integrity = 'sha512-invalid';
    expect(verifyQsLock(JSON.stringify(tampered), baseline)).toBe(false);
  });
});
