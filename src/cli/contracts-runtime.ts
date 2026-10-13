// `augur contracts runtime <sync|check>` (spec/tasks/2026-10-13-contract-runtime-template.md).
// sync writes Augur's template to the project's runtime copy with a version and
// hash header; check reports drift and exits 1 so a gate can refuse a stale or
// hand-edited copy. The copy's path comes from `augur.contracts.json#runtimeFile`
// unless `--path` names it (the first sync of a project that has no field yet).

import { contractsManifestPath, loadContractsManifest } from '../contracts/project.ts';
import { isRepoRelativePath, normalizeRepoPath } from '../contracts/paths.ts';
import { readContractRuntimeTemplate, readRuntimeCopy, writeRuntimeCopy } from '../contracts/runtime-files.ts';
import {
  inspectContractRuntime,
  renderContractRuntime,
  runtimeFlavorOf,
  type RuntimeInspection,
} from '../contracts/runtime-template.ts';
import { flagValue, hasFlag, parseArgv, rejectUnknownFlags, UsageError, type ParsedArgs } from './args.ts';
import type { CliIo } from './main.ts';

type RuntimeTarget = { readonly projectDir: string; readonly runtimeFile: string; readonly template: string };

export function runContractsRuntimeCommand(argv: readonly string[], io: CliIo): number {
  const args = parseArgv(argv);
  rejectUnknownFlags(args, ['--project', '--path', '--json', '--help']);
  if (args.command === 'sync') return runSync(resolveTarget(args, io), args, io);
  if (args.command === 'check') return runCheck(resolveTarget(args, io), args, io);
  throw new UsageError(`unknown contracts runtime verb '${args.command ?? ''}'`);
}

function resolveTarget(args: ParsedArgs, io: CliIo): RuntimeTarget {
  const projectDir = flagValue(args, '--project') ?? io.cwd;
  const manifest = loadContractsManifest(projectDir);
  if (manifest === null) throw new UsageError(`${contractsManifestPath(projectDir)} not found`);
  const given = flagValue(args, '--path') ?? manifest.runtimeFile;
  if (given === undefined) {
    throw new UsageError('no runtime file: set augur.contracts.json#runtimeFile or pass --path <repo-relative file>');
  }
  if (!isRepoRelativePath(given)) throw new UsageError(`--path must be repository-relative: ${given}`);
  const runtimeFile = normalizeRepoPath(given);
  const flavor = runtimeFlavorOf(runtimeFile);
  if (flavor === null) throw new UsageError(`runtime file must end in .ts, .mts, .mjs or .js: ${runtimeFile}`);
  return { projectDir, runtimeFile, template: readContractRuntimeTemplate(flavor) };
}

function runSync(target: RuntimeTarget, args: ParsedArgs, io: CliIo): number {
  const before = inspectContractRuntime(readRuntimeCopy(target.projectDir, target.runtimeFile), target.template);
  const written = before.state === 'current' ? null : writeRuntimeCopy(target.projectDir, target.runtimeFile, renderContractRuntime(target.template));
  const result = { project: target.projectDir, runtimeFile: target.runtimeFile, previous: before.state, written: written !== null };
  io.stdout(hasFlag(args, '--json')
    ? `${JSON.stringify(result, null, 2)}\n`
    : `${written === null ? 'up to date' : `wrote (was ${before.state})`}: ${target.runtimeFile}\n`);
  return 0;
}

function runCheck(target: RuntimeTarget, args: ParsedArgs, io: CliIo): number {
  const inspection = inspectContractRuntime(readRuntimeCopy(target.projectDir, target.runtimeFile), target.template);
  io.stdout(hasFlag(args, '--json')
    ? `${JSON.stringify({ project: target.projectDir, runtimeFile: target.runtimeFile, ...inspection }, null, 2)}\n`
    : formatInspection(target.runtimeFile, inspection));
  return inspection.state === 'current' ? 0 : 1;
}

function formatInspection(runtimeFile: string, inspection: RuntimeInspection): string {
  if (inspection.state === 'current') return `current: ${runtimeFile} (template version ${inspection.version})\n`;
  return `${inspection.state}: ${runtimeFile}  ${inspection.message}\n`;
}
