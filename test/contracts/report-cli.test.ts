import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runContractsCommand } from '../../src/cli/contracts.ts';
import { main, type CliIo } from '../../src/cli/main.ts';
import { UsageError } from '../../src/cli/args.ts';
import { loadContractTargets } from '../../src/inject/contract-project.ts';
import { runOnProject } from '../../src/inject/project.ts';

const SOURCE = [
  'export function applyPlan(plan, registry) {',
  '  registry.set(plan.id, plan);',
  '  return registry;',
  '}',
  '',
].join('\n');

const PREDICATE = 'export default { post: (result) => result.size > 0 || \'registry shrank\' };\n';

type Capture = { exit: number; stdout: string; stderr: string };

/**
 * A project with one contract wrapped for real: the report only counts events
 * whose marker id the current source carries, so the marker has to come from an
 * actual `apply` rather than from a hand-written id.
 */
async function makeProject(options: { sample?: number; injected?: boolean } = {}): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'augur-contracts-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  mkdirSync(join(dir, 'contracts'), { recursive: true });
  mkdirSync(join(dir, 'logs'), { recursive: true });
  writeFileSync(join(dir, 'src', 'plan.ts'), SOURCE, 'utf8');
  writeFileSync(join(dir, 'contracts', 'plan.contract.ts'), PREDICATE, 'utf8');
  writeFileSync(join(dir, 'augur.inject.json'), JSON.stringify({ service: 'fixture' }), 'utf8');
  writeFileSync(join(dir, 'augur.contracts.json'), JSON.stringify({
    version: 1,
    contracts: [{
      id: 'C-1',
      criterion: 'C-1 applyPlan(plan, registry): the registry never shrinks',
      symbol: 'applyPlan',
      file: 'src/plan.ts',
      module: 'contracts/plan.contract.ts',
      ...(options.sample === undefined ? {} : { sample: options.sample }),
    }],
  }), 'utf8');

  if (options.injected !== false) {
    const targets = await loadContractTargets(dir, { includeExisting: true });
    runOnProject(dir, 'apply', { write: true, rules: ['contract-wrap'], contractTargets: targets });
  }
  return dir;
}

async function markerIdOf(dir: string): Promise<string> {
  const { activeContractMarkers } = await import('../../src/inject/contract-markers.ts');
  const markers = await activeContractMarkers(dir);
  const id = markers.get('C-1');
  expect(id, 'the fixture must be injected before events are written').toBeDefined();
  return id!;
}

function writeLog(dir: string, lines: readonly unknown[]): void {
  writeFileSync(join(dir, 'logs', 'weaver.jsonl'), `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8');
}

async function report(dir: string, argv: readonly string[]): Promise<Capture> {
  let stdout = '';
  let stderr = '';
  const io: CliIo = { cwd: dir, stdout: (text) => { stdout += text; }, stderr: (text) => { stderr += text; }, readStdin: () => '' };
  // `--logs` is explicit so the developer's own VESTIGIUM_LOGS_DIR cannot feed
  // this fixture; the resolution order itself is covered in project.test.ts.
  const exit = await runContractsCommand(['report', '--project', dir, '--logs', join(dir, 'logs'), ...argv], io);
  return { exit, stdout, stderr };
}

describe('augur contracts report', () => {
  it('requires one of --since or --all', async () => {
    const dir = await makeProject();
    await expect(report(dir, [])).rejects.toThrow(UsageError);
    await expect(report(dir, ['--since', '2026-09-05T00:00:00.000Z', '--all'])).rejects.toThrow(/mutually exclusive/);
  });

  it('refuses --acceptance with --all', async () => {
    const dir = await makeProject();
    await expect(report(dir, ['--all', '--acceptance', '--json'])).rejects.toThrow(/--acceptance cannot be combined with --all/);
  });

  it('rejects a --since that is not an ISO 8601 instant', async () => {
    const dir = await makeProject();
    await expect(report(dir, ['--since', 'yesterday'])).rejects.toThrow(/not an ISO 8601 instant/);
    await expect(report(dir, ['--since', '2026-09-05T00:00:00'])).rejects.toThrow(/not an ISO 8601 instant/);
  });

  it('counts the events the current marker produced and skips foreign ones', async () => {
    const dir = await makeProject();
    const marker = await markerIdOf(dir);
    writeLog(dir, [
      { msg: 'contract observed', ctx: { contract: 'C-1', id: marker, phase: 'ok', observed_at: '2026-09-05T00:00:01.000Z' } },
      { msg: 'contract observed', ctx: { contract: 'C-1', id: 'someone-elses-marker', phase: 'ok', observed_at: '2026-09-05T00:00:02.000Z' } },
    ]);
    const result = await report(dir, ['--since', '2026-09-05T00:00:00.000Z', '--json']);
    const parsed = JSON.parse(result.stdout) as { contracts: Array<{ state: string; calls: number }>; diagnostics: { foreign: number } };
    expect(result.exit).toBe(0);
    expect(parsed.contracts[0]).toMatchObject({ state: 'covered', calls: 1 });
    expect(parsed.diagnostics.foreign).toBe(1);
  });

  it('prints one line per contract for a human', async () => {
    const dir = await makeProject();
    const marker = await markerIdOf(dir);
    writeLog(dir, [
      { msg: 'contract violated', ctx: { contract: 'C-1', id: marker, phase: 'post', reason: 'registry shrank', where: 'src/plan.ts:2', observed_at: '2026-09-05T00:00:01.000Z' } },
    ]);
    const result = await report(dir, ['--since', '2026-09-05T00:00:00.000Z']);
    const [line] = result.stdout.split('\n');
    expect(line).toMatch(/^violated\s+C-1\s+applyPlan\s+calls 1\s+violations 1/);
    expect(line).toContain('registry shrank');
  });

  it('reports not-injected when the source carries no marker', async () => {
    const dir = await makeProject({ injected: false });
    writeLog(dir, [{ msg: 'contract observed', ctx: { contract: 'C-1', id: 'anything', observed_at: '2026-09-05T00:00:01.000Z' } }]);
    const result = await report(dir, ['--all', '--json']);
    const parsed = JSON.parse(result.stdout) as { contracts: Array<{ uncoveredReason: string }> };
    expect(parsed.contracts[0]?.uncoveredReason).toBe('not-injected');
  });

  it('emits the acceptance shape and warns about undated events', async () => {
    const dir = await makeProject();
    const marker = await markerIdOf(dir);
    writeLog(dir, [
      { msg: 'contract observed', ctx: { contract: 'C-1', id: marker, observed_at: '2026-09-05T00:00:01.000Z' } },
      { msg: 'contract observed', ctx: { contract: 'C-1', id: marker } },
    ]);
    const result = await report(dir, ['--since', '2026-09-05T00:00:00.000Z', '--acceptance', '--json']);
    const parsed = JSON.parse(result.stdout) as Array<{ criterion: string; met: boolean; note: string }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ criterion: 'C-1 applyPlan(plan, registry): the registry never shrinks', met: true });
    expect(result.stderr).toContain('no readable timestamp');
  });

  it('fails --acceptance when a contract is sampled', async () => {
    const dir = await makeProject({ sample: 0.5 });
    writeLog(dir, []);
    let stderr = '';
    const io: CliIo = {
      cwd: dir,
      stdout: () => {},
      stderr: (text) => { stderr += text; },
      readStdin: () => '',
    };
    const exit = await main([
      'contracts', 'report', '--project', dir, '--logs', join(dir, 'logs'),
      '--since', '2026-09-05T00:00:00.000Z', '--acceptance', '--json',
    ], io);
    expect(exit).toBe(1);
    expect(stderr).toContain('sample 1');
  });

  it('rejects an unknown verb and a project with no contract file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'augur-empty-'));
    const io: CliIo = { cwd: dir, stdout: () => {}, stderr: () => {}, readStdin: () => '' };
    await expect(runContractsCommand(['summarise'], io)).rejects.toThrow(/unknown contracts verb/);
    await expect(runContractsCommand(['report', '--project', dir, '--all'], io)).rejects.toThrow(/augur\.contracts\.json not found/);
  });
});
