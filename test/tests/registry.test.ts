import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadRegistry, RegistryValidationError, saveRegistry } from '../../src/tests/registry.ts';
import { makeRepository, record } from './fixtures.ts';

describe('test registry boundary', () => {
  it('round-trips canonical JSONL byte-identically', () => {
    const repo = mkdtempSync(join(tmpdir(), 'augur-registry-'));
    makeRepository(repo, [record()]);
    const path = join(repo, '.augur', 'tests.jsonl');
    const before = readFileSync(path, 'utf8');
    saveRegistry(repo, loadRegistry(repo));
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it.each([
    ['absolute file', { file: '/tmp/escape.test.ts' }],
    ['parent traversal', { file: '../escape.test.ts' }],
    ['unknown runner', { runner: 'jest' }],
    ['unknown kind', { kind: 'smoke' }],
    ['unknown status', { status: 'disabled' }],
    ['unknown origin type', { origin: { type: 'robot', ref: '' } }],
    ['string command', { runner: 'command', command: 'npm test' }],
  ])('rejects %s while loading', (_name, mutation) => {
    const repo = mkdtempSync(join(tmpdir(), 'augur-registry-invalid-'));
    makeRepository(repo, []);
    writeFileSync(join(repo, '.augur', 'tests.jsonl'), `${JSON.stringify({ ...record(), ...mutation })}\n`, 'utf8');
    expect(() => loadRegistry(repo)).toThrow(RegistryValidationError);
  });
});
