// `augur contracts <verb>` (spec/plan/2026-09-05-live-contract-testing.md §6.1).
// The IO half of contract linting: read the contract file and every source it
// names, then hand the pure linter a lookup. Duplicate ids surface as the
// manifest's own parse error, which main.ts already maps to exit 1.

import { lintContracts, type ContractLintFinding } from '../contracts/lint.ts';
import { normalizeRepoPath } from '../contracts/paths.ts';
import {
  contractsManifestPath,
  loadContractsManifest,
  predicateStateOf,
  readSourceIfPresent,
} from '../contracts/project.ts';
import { flagValue, hasFlag, parseArgv, rejectUnknownFlags, UsageError } from './args.ts';
import type { CliIo } from './main.ts';

export async function runContractsCommand(argv: readonly string[], io: CliIo): Promise<number> {
  const args = parseArgv(argv);
  if (args.command !== 'lint') throw new UsageError(`unknown contracts verb '${args.command ?? ''}'`);
  rejectUnknownFlags(args, ['--project', '--json', '--help']);

  const projectDir = flagValue(args, '--project') ?? io.cwd;
  const manifest = loadContractsManifest(projectDir);
  if (manifest === null) {
    throw new UsageError(`${contractsManifestPath(projectDir)} not found`);
  }

  const findings = lintContracts(manifest, {
    source: (file) => readSourceIfPresent(projectDir, file),
    predicate: (module) => predicateStateOf(projectDir, module),
  });

  if (hasFlag(args, '--json')) {
    io.stdout(`${JSON.stringify({ project: projectDir, contracts: manifest.contracts.length, findings }, null, 2)}\n`);
  } else {
    io.stdout(formatFindings(manifest.contracts.length, findings));
  }
  return findings.length > 0 ? 1 : 0;
}

function formatFindings(total: number, findings: readonly ContractLintFinding[]): string {
  const lines = findings.map(
    (finding) => `${finding.code.padEnd(13)} ${finding.contractId.padEnd(8)} ${normalizeRepoPath(finding.file)}  ${finding.message}`,
  );
  lines.push(`summary: contracts=${total} findings=${findings.length}`);
  return `${lines.join('\n')}\n`;
}
