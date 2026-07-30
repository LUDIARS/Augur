import {
  flagValue,
  flagValues,
  hasFlag,
  rejectFlags,
  rejectUnknownFlags,
  UsageError,
  type ParsedArgs,
} from './args.ts';
import {
  coverageFrom,
  gatherChange,
  inferProject,
  readJsonFile,
  readSignalFile,
  type ChangeSignals,
  type GatherIo,
} from './gather.ts';
import { experienceQualitySchema } from '../schema/index.ts';
import type {
  CoverageSignal,
  CreatePlanRequest,
  ExperienceGoal,
  ProjectContext,
  RuntimeSignal,
} from '../schema/index.ts';

const OBJECTIVE_KINDS = new Set([
  'new_feature',
  'bug_fix',
  'regression',
  'refactor',
  'performance',
  'stability',
  'security',
  'unknown',
]);

const PROJECT_DOMAINS = new Set(['web', 'game', 'service', 'other']);

// Flags that gather signals from the working directory. A caller that supplies a
// complete request has already decided what the request contains; letting Augur
// also read a directory it does not own would silently mix two answers.
const GATHERING_FLAGS = [
  '--base',
  '--no-git',
  '--failure-log',
  '--failure-command',
  '--failure-exit',
  '--coverage',
  '--signals',
  '--goals',
  '--quality',
  '--domain',
  '--project',
  '--kind',
  '--description',
  '--outcome',
];

// The complete `augur plan` flag surface (spec/interface/cli.md, "Options").
const PLAN_FLAGS = [...GATHERING_FLAGS, '--request', '--json', '--out', '--help'];

export function buildRequest(args: ParsedArgs, io: GatherIo): CreatePlanRequest {
  rejectUnknownFlags(args, PLAN_FLAGS);
  const requestPath = flagValue(args, '--request');
  if (requestPath !== undefined) {
    rejectFlags(args, GATHERING_FLAGS, '--request');
    const supplied = readJsonFile<CreatePlanRequest>(io, requestPath, 'request');
    if (supplied === undefined) throw new UsageError(`could not read a request from ${requestPath}`);
    return supplied;
  }
  return assembleRequest(args, io);
}

function assembleRequest(args: ParsedArgs, io: GatherIo): CreatePlanRequest {
  const request: Record<string, unknown> = { objective: objective(args) };

  const project = projectContext(args, io);
  if (project !== undefined) request['project'] = project;

  const change = changeSignal(args, io);
  if (change !== undefined) request['change'] = change;

  const failure = failureSignal(args, io);
  if (failure !== undefined) request['failure'] = failure;

  const coverage = coverageSignal(args, io);
  if (coverage !== undefined) request['coverage'] = coverage;

  const signals = runtimeSignals(args, io);
  if (signals !== undefined) request['runtimeSignals'] = signals;

  const goals = experienceGoals(args, io);
  if (goals.length > 0) request['experienceGoals'] = goals;

  return request as CreatePlanRequest;
}

function objective(args: ParsedArgs): Record<string, unknown> {
  const description = descriptionOf(args);
  const kind = flagValue(args, '--kind') ?? 'unknown';
  if (!OBJECTIVE_KINDS.has(kind)) {
    throw new UsageError(`--kind must be one of: ${[...OBJECTIVE_KINDS].join(', ')}`);
  }
  const outcome = flagValue(args, '--outcome');
  return {
    kind,
    description,
    ...(outcome === undefined ? {} : { desiredOutcome: outcome }),
  };
}

// A second positional or a positional alongside `--description` names two
// descriptions; picking one silently is the same failure a mistyped flag is, so
// both are usage errors rather than a plan built from whichever won.
function descriptionOf(args: ParsedArgs): string {
  const positional = args.positionals[0];
  if (args.positionals.length > 1) {
    throw new UsageError('only one positional description is accepted');
  }
  const supplied = flagValue(args, '--description');
  if (supplied !== undefined && positional !== undefined) {
    throw new UsageError('--description and a positional description cannot both be given');
  }
  const description = supplied ?? positional;
  if (description === undefined || description.trim().length === 0) {
    throw new UsageError('--description (or a positional description) is required');
  }
  return description.trim();
}

function changeSignal(args: ParsedArgs, io: GatherIo): ChangeSignals | undefined {
  if (hasFlag(args, '--no-git')) return undefined;
  const base = flagValue(args, '--base') ?? 'HEAD';
  // Guarded because the value reaches `git diff` as a bare argument: a leading
  // dash would be read there as an option rather than as the ref it names.
  if (base.startsWith('-')) throw new UsageError('--base must name a git ref, not an option');
  const change = gatherChange(io, base);
  if (change.diff === undefined && change.changedFiles === undefined) return undefined;
  return change;
}

function coverageSignal(args: ParsedArgs, io: GatherIo): CoverageSignal | undefined {
  const path = flagValue(args, '--coverage');
  if (path === undefined) return undefined;
  const text = readSignalFile(io, path);
  return text === undefined ? undefined : coverageFrom(path, text);
}

function runtimeSignals(args: ParsedArgs, io: GatherIo): RuntimeSignal[] | undefined {
  const path = flagValue(args, '--signals');
  if (path === undefined) return undefined;
  const signals = readJsonFile<RuntimeSignal[]>(io, path, 'runtime signals');
  return Array.isArray(signals) && signals.length > 0 ? signals : undefined;
}

function projectContext(args: ParsedArgs, io: GatherIo): ProjectContext | undefined {
  const overridePath = flagValue(args, '--project');
  const inferred = overridePath === undefined
    ? inferProject(io)
    : readJsonFile<ProjectContext>(io, overridePath, 'project context');
  const domain = flagValue(args, '--domain');
  if (domain !== undefined && !PROJECT_DOMAINS.has(domain)) {
    throw new UsageError(`--domain must be one of: ${[...PROJECT_DOMAINS].join(', ')}`);
  }
  if (inferred === undefined && domain === undefined) return undefined;
  return { ...(inferred ?? {}), ...(domain === undefined ? {} : { domain }) } as ProjectContext;
}

function failureSignal(args: ParsedArgs, io: GatherIo): Record<string, unknown> | undefined {
  const logPath = flagValue(args, '--failure-log');
  const command = flagValue(args, '--failure-command');
  const exit = flagValue(args, '--failure-exit');
  if (logPath === undefined && command === undefined && exit === undefined) return undefined;
  const failure: Record<string, unknown> = {};
  if (command !== undefined) failure['command'] = command;
  if (exit !== undefined) {
    // Tested by shape rather than by `Number`, which accepts '', ' 1 ', '0x10'
    // and '1e3' as integers and would record an exit code the runner never gave.
    if (!/^-?\d+$/.test(exit)) throw new UsageError('--failure-exit must be an integer');
    failure['exitCode'] = Number(exit);
  }
  if (logPath !== undefined) {
    const text = readSignalFile(io, logPath);
    // stdout carries the log because a runner writes failures to either stream
    // and the engine reads both the same way.
    if (text !== undefined) failure['stdout'] = text;
  }
  return Object.keys(failure).length > 0 ? failure : undefined;
}

// `--quality` is shorthand for an abstract goal; it merges with `--goals` rather
// than replacing it, so a caller can name one extra quality without rewriting a
// goals file.
function experienceGoals(args: ParsedArgs, io: GatherIo): ExperienceGoal[] {
  const goals: ExperienceGoal[] = [];
  const goalsPath = flagValue(args, '--goals');
  if (goalsPath !== undefined) {
    const supplied = readJsonFile<ExperienceGoal[]>(io, goalsPath, 'experience goals');
    if (Array.isArray(supplied)) goals.push(...supplied);
  }
  for (const quality of flagValues(args, '--quality')) {
    // Checked here like `--kind` and `--domain`: an unchecked typo reached the
    // engine as `experienceGoals.0.quality: invalid enum value`, which names a
    // request field the caller never wrote instead of the flag it mistyped.
    const parsed = experienceQualitySchema.safeParse(quality);
    if (!parsed.success) {
      throw new UsageError(
        `--quality must be one of: ${experienceQualitySchema.options.join(', ')}`,
      );
    }
    goals.push({ quality: parsed.data });
  }
  return goals;
}
