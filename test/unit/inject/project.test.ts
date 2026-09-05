import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseContractsManifest } from '../../../src/contracts/manifest.ts';
import { loadContractsManifest } from '../../../src/contracts/project.ts';
import { buildContractTargets } from '../../../src/inject/contract-targets.ts';
import { runOnProject } from '../../../src/inject/project.ts';

const scratch: string[] = [];

afterEach(() => {
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('runOnProject contract targets', () => {
  it('rejects traversal before an outside target can be changed', () => {
    const root = mkdtempSync(join(tmpdir(), 'augur-contract-traversal-'));
    scratch.push(root);
    const project = join(root, 'project');
    const outside = join(root, 'outside.ts');
    mkdirSync(project);
    writeFileSync(outside, 'sentinel\n');
    writeFileSync(join(project, 'augur.contracts.json'), JSON.stringify({
      version: 1,
      contracts: [{
        id: 'C-escape',
        criterion: 'must stay contained',
        symbol: 'outside',
        file: '../outside.ts',
        module: '../outside.ts',
      }],
    }));

    expect(() => loadContractsManifest(project)).toThrow(/repository-relative path contained by the project/);
    expect(readFileSync(outside, 'utf8')).toBe('sentinel\n');
  });

  it('reports a missing target file as unresolved', () => {
    const project = mkdtempSync(join(tmpdir(), 'augur-contract-project-'));
    scratch.push(project);
    mkdirSync(join(project, 'src'));
    writeFileSync(join(project, 'augur.inject.json'), JSON.stringify({ service: 'fixture' }));
    const manifest = parseContractsManifest({
      version: 1,
      contracts: [{
        id: 'C-1',
        criterion: 'C-1 missing target',
        symbol: 'missing',
        file: 'src/missing.ts',
        module: 'contracts/missing.contract.ts',
      }],
    });
    const targets = buildContractTargets(manifest, () => 'missing');

    const result = runOnProject(project, 'check', { write: false, contractTargets: targets });

    expect(result.summary.unresolved).toBe(1);
    expect(result.points).toMatchObject([{ rule: 'contract-wrap', file: 'src/missing.ts', state: 'unresolved' }]);
  });
});
