// `augur contracts <verb>` (spec/plan/2026-09-05-live-contract-testing.md §6.1).
// The IO half of contract linting and reporting: read the contract file, the
// sources it names, and the weaver logs, then hand the pure layers their input.
// Duplicate ids surface as the manifest's own parse error, which main.ts already
// maps to exit 1.

import { activeContractMarkers } from '../inject/contract-markers.ts';
import { ContractAcceptanceError, toAcceptanceReport } from '../contracts/acceptance.ts';
import type { ContractWindow } from '../contracts/aggregate.ts';
import { collectContractSummary } from '../contracts/collect.ts';
import { normalizeContractTimestamp } from '../contracts/events.ts';
import { lintContracts, type ContractLintFinding } from '../contracts/lint.ts';
import { normalizeRepoPath } from '../contracts/paths.ts';
import {
  contractsManifestPath,
  loadContractsManifest,
  predicateStateOf,
  readSourceIfPresent,
} from '../contracts/project.ts';
import { formatContractsMarkdown, formatContractsText } from '../contracts/report-format.ts';
import { flagValue, hasFlag, parseArgv, rejectUnknownFlags, UsageError, type ParsedArgs } from './args.ts';
import type { CliIo } from './main.ts';

export async function runContractsCommand(argv: readonly string[], io: CliIo): Promise<number> {
  const args = parseArgv(argv);
  if (args.command === 'lint') return runLint(args, io);
  if (args.command === 'report') return await runReport(args, io);
  throw new UsageError(`unknown contracts verb '${args.command ?? ''}'`);
}

function runLint(args: ParsedArgs, io: CliIo): number {
  rejectUnknownFlags(args, ['--project', '--json', '--help']);

  const projectDir = flagValue(args, '--project') ?? io.cwd;
  const manifest = requireManifest(projectDir);

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

async function runReport(args: ParsedArgs, io: CliIo): Promise<number> {
  rejectUnknownFlags(args, ['--project', '--logs', '--since', '--all', '--acceptance', '--json', '--markdown', '--help']);
  const projectDir = flagValue(args, '--project') ?? io.cwd;
  requireManifest(projectDir);

  const window = resolveWindow(args);
  const acceptance = hasFlag(args, '--acceptance');
  const json = hasFlag(args, '--json');
  const markdown = hasFlag(args, '--markdown');
  if (json && markdown) throw new UsageError('--json and --markdown are mutually exclusive');
  if (acceptance && markdown) throw new UsageError('--acceptance produces JSON; --markdown cannot be combined with it');

  const collected = await collectContractSummary(projectDir, {
    markers: activeContractMarkers,
    logsDir: flagValue(args, '--logs'),
    window,
  });
  // requireManifest already proved the file is there, so a null here cannot happen.
  if (collected === null) throw new UsageError(`${contractsManifestPath(projectDir)} not found`);
  const { summary } = collected;

  if (summary.diagnostics.undated > 0) {
    io.stderr(`warning: ${summary.diagnostics.undated} contract event(s) had no readable timestamp\n`);
  }

  if (acceptance) {
    try {
      io.stdout(`${JSON.stringify(toAcceptanceReport(summary), null, 2)}\n`);
    } catch (error) {
      // Acceptance policy failures are domain errors until they reach the CLI;
      // here they become usage errors so main maps them to the documented exit 1.
      if (error instanceof ContractAcceptanceError) throw new UsageError(error.message);
      throw error;
    }
    return 0;
  }
  io.stdout(json
    ? `${JSON.stringify({ project: projectDir, logs: collected.logsDir, ...summary }, null, 2)}\n`
    : markdown ? formatContractsMarkdown(summary) : formatContractsText(summary));
  return 0;
}

// `--since` or `--all`, never neither: a report with no lower bound would let a
// violation from a previous delegation decide this one (§6.1). `--acceptance`
// additionally refuses `--all`, because "every event ever" is diagnostic, not
// evidence about the change under review.
function resolveWindow(args: ParsedArgs): ContractWindow {
  const since = flagValue(args, '--since');
  const all = hasFlag(args, '--all');
  if (since === undefined && !all) throw new UsageError('one of --since <iso> or --all is required');
  if (since !== undefined && all) throw new UsageError('--since and --all are mutually exclusive');
  if (all) {
    if (hasFlag(args, '--acceptance')) throw new UsageError('--acceptance cannot be combined with --all; pass --since <iso>');
    return {};
  }
  const parsed = normalizeContractTimestamp(since!);
  if (parsed === undefined) throw new UsageError(`--since is not an ISO 8601 instant: ${since!}`);
  return { since: parsed };
}

function requireManifest(projectDir: string): NonNullable<ReturnType<typeof loadContractsManifest>> {
  const manifest = loadContractsManifest(projectDir);
  if (manifest === null) throw new UsageError(`${contractsManifestPath(projectDir)} not found`);
  return manifest;
}

function formatFindings(total: number, findings: readonly ContractLintFinding[]): string {
  const lines = findings.map(
    (finding) => `${finding.code.padEnd(13)} ${finding.contractId.padEnd(8)} ${normalizeRepoPath(finding.file)}  ${finding.message}`,
  );
  lines.push(`summary: contracts=${total} findings=${findings.length}`);
  return `${lines.join('\n')}\n`;
}
