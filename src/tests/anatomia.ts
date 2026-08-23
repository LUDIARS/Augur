import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export class AnatomiaUnavailableError extends Error {
  readonly exitCode = 2;
  constructor(message: string) {
    super(message);
    this.name = 'AnatomiaUnavailableError';
  }
}

export class AnatomiaInvocationError extends Error {
  readonly exitCode = 2;
  constructor(message: string) {
    super(message);
    this.name = 'AnatomiaInvocationError';
  }
}

const symbolHitSchema = z.object({
  name: z.string(),
  signature: z.string(),
  filePath: z.string(),
  startLine: z.number().int().nonnegative(),
  endLine: z.number().int().nonnegative(),
  anchor: z.string().nullable(),
  fanIn: z.number().int().nonnegative(),
  fanOut: z.number().int().nonnegative(),
}).passthrough();

const symbolHitsSchema = z.object({ hits: z.array(symbolHitSchema) }).passthrough();

const programDiagnosisSchema = z.object({
  modules: z.array(z.object({
    moduleId: z.string(),
    layer: z.string().nullable(),
    files: z.array(z.string()),
  }).passthrough()),
  totals: z.object({ unclassifiedModules: z.number().int().nonnegative() }).passthrough(),
}).passthrough();

const diffFunctionSchema = z.object({
  anchor: z.string().nullable(),
  name: z.string(),
  line: z.number().int().nonnegative(),
  signature: z.string().optional(),
}).passthrough();

const prDiffReviewSchema = z.object({
  temporary: z.literal(true),
  diff: z.object({
    available: z.boolean(),
    head: z.string().nullable().optional(),
    files: z.array(z.object({
      path: z.string(),
      status: z.enum(['added', 'deleted', 'modified']),
      added: z.array(diffFunctionSchema),
      changed: z.array(diffFunctionSchema),
      removed: z.array(diffFunctionSchema),
    }).passthrough()),
    anchors: z.object({
      added: z.array(z.string()),
      changed: z.array(z.string()),
      all: z.array(z.string()),
    }).passthrough(),
  }).passthrough(),
  domain: z.object({
    targetDomains: z.array(z.object({ name: z.string(), changedAnchors: z.array(z.string()) }).passthrough()),
    dualLayer: z.object({ unclassifiedAnchors: z.array(z.string()) }).passthrough(),
  }).passthrough(),
  quality: z.object({
    changedFunctions: z.array(z.object({
      anchor: z.string(),
      cyclomatic: z.number().nonnegative(),
      fanIn: z.number().int().nonnegative(),
      fanOut: z.number().int().nonnegative(),
    }).passthrough()),
  }).passthrough(),
  architecture: z.object({
    changedViolations: z.array(z.object({
      severity: z.string(),
      locations: z.array(z.object({ anchor: z.string() }).passthrough()),
    }).passthrough()),
  }).passthrough(),
}).passthrough();

export type AnatomiaSymbolHit = z.infer<typeof symbolHitSchema>;
export type ProgramDomainDiagnosis = z.infer<typeof programDiagnosisSchema>;
export type PrDiffReview = z.infer<typeof prDiffReviewSchema>;

export interface PrImpact {
  analysis: PrDiffReview;
  changedAnchors: string[];
  impactedAnchors: string[];
}

export async function analyzePr(repoPath: string, base?: string, callerDepth = 2): Promise<PrImpact> {
  const analysis = await prReview(repoPath, base);
  const changedAnchors = extractChangedAnchors(analysis);
  const impactedAnchors = await collectCallers(repoPath, changedAnchors, callerDepth);
  return { analysis, changedAnchors, impactedAnchors };
}

export async function prReview(repoPath: string, base?: string): Promise<PrDiffReview> {
  const args = ['pr-review', '--repo', resolve(repoPath), '--json'];
  if (base !== undefined && base !== '') args.push('--base', base);
  return prDiffReviewSchema.parse(await runAnatomia(args));
}

export async function domainsProgram(repoPath: string): Promise<ProgramDomainDiagnosis> {
  return programDiagnosisSchema.parse(await runAnatomia(['domains', 'program', '--repo', resolve(repoPath), '--json']));
}

/** Backward-compatible T1 name. */
export const programDomains = domainsProgram;

export async function callers(name: string, repoPath: string, depth = 1): Promise<AnatomiaSymbolHit[]> {
  const seen = new Set<string>();
  const output: AnatomiaSymbolHit[] = [];
  let frontier = [name];
  for (let level = 0; level < depth && frontier.length > 0; level += 1) {
    const next: string[] = [];
    for (const symbol of [...frontier].sort()) {
      const response = symbolHitsSchema.parse(await runAnatomia([
        'callers', symbol, '--repo', resolve(repoPath), '--limit', '1000', '--json',
      ]));
      for (const hit of response.hits) {
        if (hit.anchor === null || seen.has(hit.anchor)) continue;
        seen.add(hit.anchor);
        output.push(hit);
        if (hit.fanIn > 0) next.push(hit.anchor);
      }
    }
    frontier = next;
  }
  return output.sort((left, right) => (left.anchor ?? '').localeCompare(right.anchor ?? ''));
}

export async function find(name: string, repoPath: string): Promise<AnatomiaSymbolHit[]> {
  const output = await runAnatomia(['find', name, '--repo', resolve(repoPath), '--limit', '1000', '--json']);
  return symbolHitsSchema.parse(output).hits;
}

export async function where(task: string, repoPath: string): Promise<unknown> {
  return await runAnatomia(['where', '--task', task, '--repo', resolve(repoPath), '--json']);
}

export async function collectCallers(repoPath: string, anchors: readonly string[], depth: number): Promise<string[]> {
  const direct = new Set(anchors);
  const impacted = new Set<string>();
  for (const anchor of [...anchors].sort()) {
    for (const hit of await callers(anchor, repoPath, depth)) {
      if (hit.anchor !== null && !direct.has(hit.anchor)) impacted.add(hit.anchor);
    }
  }
  return [...impacted].sort();
}

export async function runAnatomia(args: readonly string[]): Promise<unknown> {
  const directory = resolve(process.env.AUGUR_ANATOMIA_DIR ?? defaultAnatomiaDirectory());
  const cli = resolve(directory, 'bin', 'anatomia.mjs');
  if (!existsSync(cli)) throw new AnatomiaUnavailableError(`Anatomia CLI not found: ${cli}`);
  const output = await spawnJson(process.execPath, [cli, ...args]);
  try {
    return JSON.parse(output) as unknown;
  } catch (error) {
    throw new AnatomiaInvocationError(`Anatomia returned invalid JSON: ${messageOf(error)}`);
  }
}

export function parsePrDiffReview(value: unknown): PrDiffReview {
  return prDiffReviewSchema.parse(value);
}

export function extractChangedAnchors(value: unknown): string[] {
  const parsed = prDiffReviewSchema.parse(value);
  return uniqueStrings([...parsed.diff.anchors.added, ...parsed.diff.anchors.changed]);
}

async function spawnJson(command: string, argv: string[]): Promise<string> {
  return await new Promise((resolveOutput, reject) => {
    const child = spawn(command, argv, { shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer | string) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer | string) => { stderr += chunk.toString(); });
    child.once('error', (error) => reject(new AnatomiaUnavailableError(`Anatomia failed to start: ${messageOf(error)}`)));
    child.once('close', (code) => {
      if (code === 0) resolveOutput(stdout);
      else reject(new AnatomiaInvocationError(`Anatomia exited ${code ?? 'by signal'}: ${stderr.slice(-2000)}`));
    });
  });
}

function defaultAnatomiaDirectory(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'Anatomia');
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
