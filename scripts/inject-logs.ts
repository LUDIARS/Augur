// Log injection CLI (spec/interface/inject-cli.md).
//
//   node --experimental-strip-types scripts/inject-logs.ts <command> \
//     (--project <dir> | --fleet <file.json>) [--json] [--dry-run] [--strict] [--rule <name>]...
//
// Commands: scan | apply | check | remove. Markers in the target source are
// the only state; see spec/feature/log-injection.md.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fleetSchema } from '../src/inject/manifest.ts';
import { runOnProject, type ProjectRunResult } from '../src/inject/project.ts';
import { INJECT_RULES, type InjectRule } from '../src/inject/types.ts';

type Command = 'scan' | 'apply' | 'check' | 'remove';

function usage(message?: string): never {
  if (message !== undefined) console.error(`error: ${message}\n`);
  console.error(
    'usage: inject-logs.ts <scan|apply|check|remove> (--project <dir> | --fleet <file.json>)\n' +
      '                      [--json] [--dry-run] [--strict] [--rule <name>]...',
  );
  process.exit(2);
}

const args = process.argv.slice(2);
const command = args[0] as Command | undefined;
if (command === undefined || !['scan', 'apply', 'check', 'remove'].includes(command)) {
  usage(`unknown command: ${command ?? '(none)'}`);
}

let project: string | undefined;
let fleet: string | undefined;
let json = false;
let dryRun = false;
let strict = false;
const rules: InjectRule[] = [];

for (let i = 1; i < args.length; i += 1) {
  const arg = args[i] as string;
  if (arg === '--project') project = args[++i];
  else if (arg === '--fleet') fleet = args[++i];
  else if (arg === '--json') json = true;
  else if (arg === '--dry-run') dryRun = true;
  else if (arg === '--strict') strict = true;
  else if (arg === '--rule') {
    const rule = args[++i];
    if (rule === undefined || !(INJECT_RULES as readonly string[]).includes(rule)) {
      usage(`unknown rule: ${rule ?? '(none)'} (expected one of ${INJECT_RULES.join(', ')})`);
    }
    rules.push(rule as InjectRule);
  } else usage(`unknown option: ${arg}`);
}

if ((project === undefined) === (fleet === undefined)) {
  usage('exactly one of --project / --fleet is required');
}

const projectDirs: string[] = [];
if (project !== undefined) {
  projectDirs.push(resolve(project));
} else {
  const fleetPath = resolve(fleet as string);
  const parsed = fleetSchema.parse(JSON.parse(readFileSync(fleetPath, 'utf8')));
  for (const entry of parsed.projects) projectDirs.push(resolve(dirname(fleetPath), entry));
}

const results: ProjectRunResult[] = [];
let failed = false;

for (const dir of projectDirs) {
  try {
    results.push(
      runOnProject(dir, command, {
        write: command === 'apply' || command === 'remove' ? !dryRun : false,
        rules: rules.length > 0 ? rules : undefined,
      }),
    );
  } catch (error) {
    failed = true;
    console.error(`error: ${dir}: ${(error as Error).message}`);
  }
}

if (json) {
  console.log(JSON.stringify(project !== undefined ? results[0] : results, null, 2));
} else {
  for (const result of results) {
    console.log(`# ${result.service} (${result.project})`);
    for (const point of [...result.points].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
      console.log(
        `${point.state.padEnd(8)} ${point.rule.padEnd(14)} ${point.file}:${point.line}  ${point.anchor}`,
      );
    }
    if (result.filesChanged.length > 0) {
      const verb = command === 'remove' ? 'cleaned' : 'updated';
      console.log(`${verb} ${result.filesChanged.length} file(s)${dryRun ? ' (dry-run, not written)' : ''}`);
    }
    console.log(
      `summary: applied=${result.summary.applied} pending=${result.summary.pending} orphaned=${result.summary.orphaned}`,
    );
  }
}

if (failed) process.exit(1);
if (command === 'check' && strict) {
  const drift = results.some((r) => r.summary.pending > 0 || r.summary.orphaned > 0);
  if (drift) process.exit(1);
}
