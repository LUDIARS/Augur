import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export class AnatomiaUnavailableError extends Error {
  readonly exitCode = 2;
  constructor(message: string) {
    super(message);
    this.name = 'AnatomiaUnavailableError';
  }
}

export interface PrImpact {
  analysis: unknown;
  changedAnchors: string[];
  impactedAnchors: string[];
}

export async function analyzePr(repoPath: string, base?: string, callerDepth = 2): Promise<PrImpact> {
  const args = ['pr-review', '--repo', resolve(repoPath), '--json'];
  if (base !== undefined && base !== '') args.push('--base', base);
  const analysis = await runAnatomia(args);
  const changedAnchors = extractChangedAnchors(analysis);
  const impactedAnchors = await collectCallers(repoPath, changedAnchors, callerDepth);
  return { analysis, changedAnchors, impactedAnchors };
}

export async function programDomains(repoPath: string): Promise<unknown> {
  return await runAnatomia(['domains', 'program', '--repo', resolve(repoPath), '--json']);
}

export async function collectCallers(repoPath: string, anchors: readonly string[], depth: number): Promise<string[]> {
  const seen = new Set(anchors);
  let frontier = [...anchors].sort();
  for (let level = 0; level < depth && frontier.length > 0; level += 1) {
    const next = new Set<string>();
    for (const anchor of frontier) {
      const output = await runAnatomia(['callers', anchor, '--repo', resolve(repoPath), '--limit', '1000', '--json']);
      for (const caller of extractHitAnchors(output)) {
        if (!seen.has(caller)) {
          seen.add(caller);
          next.add(caller);
        }
      }
    }
    frontier = [...next].sort();
  }
  return [...seen].filter((anchor) => !anchors.includes(anchor)).sort();
}

export async function runAnatomia(args: readonly string[]): Promise<unknown> {
  const directory = resolve(process.env.AUGUR_ANATOMIA_DIR ?? defaultAnatomiaDirectory());
  const cli = resolve(directory, 'bin', 'anatomia.mjs');
  if (!existsSync(cli)) throw new AnatomiaUnavailableError(`Anatomia CLI not found: ${cli}`);
  const output = await spawnJson(process.execPath, [cli, ...args]);
  try {
    return JSON.parse(output) as unknown;
  } catch (error) {
    throw new Error(`Anatomia returned invalid JSON: ${messageOf(error)}`);
  }
}

export function extractChangedAnchors(value: unknown): string[] {
  const object = asRecord(value);
  const diff = asRecord(object?.diff);
  const anchors = asRecord(diff?.anchors);
  return uniqueStrings([...(asStrings(anchors?.added)), ...(asStrings(anchors?.changed))]);
}

function extractHitAnchors(value: unknown): string[] {
  const object = asRecord(value);
  const candidates = Array.isArray(value) ? value : Array.isArray(object?.hits) ? object.hits : [];
  const anchors: string[] = [];
  for (const candidate of candidates) {
    const hit = asRecord(candidate);
    const anchor = hit?.anchor ?? hit?.anchorId ?? asRecord(hit?.symbol)?.anchor;
    if (typeof anchor === 'string') anchors.push(anchor);
  }
  return uniqueStrings(anchors);
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
      else reject(new Error(`Anatomia exited ${code ?? 'by signal'}: ${stderr.slice(-2000)}`));
    });
  });
}

function defaultAnatomiaDirectory(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'Anatomia');
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function asStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === 'string') return [item];
    const object = asRecord(item);
    const anchor = object?.anchor ?? object?.anchorId ?? object?.id;
    return typeof anchor === 'string' ? [anchor] : [];
  });
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
