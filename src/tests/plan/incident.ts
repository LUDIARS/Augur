import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { AnatomiaSymbolHit } from '../anatomia.ts';
import type { RunStore } from '../run-store.ts';
import type { TestRecord } from '../types.ts';
import type { TargetSubject } from './targets.ts';

export interface IncidentAnchor {
  anchor: string;
  subject: TargetSubject;
  log: string;
  failure: string;
  expectedAfterFix: string;
  domains?: TestRecord['domains'];
}

export interface IncidentDependencies {
  find: (name: string, repoPath: string) => Promise<AnatomiaSymbolHit[]>;
  where: (task: string, repoPath: string) => Promise<unknown>;
  runStore: RunStore;
  registry: readonly TestRecord[];
}

const vestigiumLineSchema = z.object({
  marker: z.union([z.string(), z.number()]),
  site: z.union([
    z.string(),
    z.object({ file: z.string(), line: z.number().int().nonnegative().optional() }).passthrough(),
  ]),
}).passthrough();

export async function intakeIncident(
  reference: string,
  repoPath: string,
  dependencies: IncidentDependencies,
): Promise<IncidentAnchor[]> {
  if (reference.startsWith('run:')) return fromRun(reference.slice(4), dependencies);
  const body = readFileSync(reference, 'utf8');
  const first = body.split(/\r?\n/).find((line) => line.trim() !== '')?.trim() ?? '';
  if (first === '---') return await fromProblemLog(body, repoPath, dependencies);
  return await fromVestigium(body, repoPath, dependencies);
}

async function fromProblemLog(
  body: string,
  repoPath: string,
  dependencies: IncidentDependencies,
): Promise<IncidentAnchor[]> {
  const parsed = parseFrontmatter(body);
  const affected = listValue(parsed.frontmatter.affected);
  if (affected.length === 0) throw new Error('problem log frontmatter must contain affected');
  const symptoms = listValue(parsed.frontmatter.symptoms).join('; ');
  const rootCause = listValue(parsed.frontmatter.root_cause).join('; ');
  const log = excerpt(parsed.content || symptoms);
  const failure = symptoms || 'The problem log records an operational failure.';
  const expectedAfterFix = rootCause
    ? `The affected behavior no longer exhibits the failure after correcting: ${rootCause}`
    : 'The affected behavior no longer exhibits the recorded symptoms.';
  const resolved = await Promise.all(affected.map(async (item) => await resolveAffected(item, repoPath, dependencies)));
  return collapse(resolved.flat().map((item) => ({ ...item, log, failure, expectedAfterFix })));
}

async function fromVestigium(
  body: string,
  repoPath: string,
  dependencies: IncidentDependencies,
): Promise<IncidentAnchor[]> {
  const lines = body.split(/\r?\n/).filter((line) => line.trim() !== '');
  const markers = lines.map((line, index) => {
    let raw: unknown;
    try {
      raw = JSON.parse(line) as unknown;
    } catch (error) {
      throw new Error(`Vestigium line ${index + 1} is invalid JSON: ${messageOf(error)}`);
    }
    return vestigiumLineSchema.parse(raw);
  });
  const unique = new Map<string, (typeof markers)[number]>();
  for (const marker of markers) unique.set(siteText(marker.site), marker);
  const output: IncidentAnchor[] = [];
  for (const marker of unique.values()) {
    const site = siteText(marker.site);
    const resolved = await resolveAffected(site, repoPath, dependencies, String(marker.marker));
    output.push(...resolved.map((item) => ({
      ...item,
      log: excerpt(JSON.stringify(marker)),
      failure: `Vestigium marker ${String(marker.marker)} occurred at ${site}.`,
      expectedAfterFix: `The operation at ${site} completes without emitting marker ${String(marker.marker)}.`,
    })));
  }
  return collapse(output);
}

async function fromRun(runId: string, dependencies: IncidentDependencies): Promise<IncidentAnchor[]> {
  const run = await dependencies.runStore.get(runId);
  if (run === undefined) throw new Error(`incident run not found: ${runId}`);
  const failedIds = new Set(run.results
    .filter((result) => result.status === 'failed' || result.status === 'error')
    .map((result) => result.testId));
  if (failedIds.size === 0) throw new Error(`incident run has no failed tests: ${runId}`);
  const resultById = new Map(run.results.map((result) => [result.testId, result]));
  const output: IncidentAnchor[] = [];
  for (const test of dependencies.registry.filter((item) => failedIds.has(item.id))) {
    const result = resultById.get(test.id);
    for (const anchor of test.anchors) {
      output.push({
        anchor,
        subject: { symbol: test.name, file: test.file, line: 0 },
        log: excerpt(result?.outputTail ?? ''),
        failure: result?.failureMessage ?? `Registered test ${test.id} failed in run ${runId}.`,
        expectedAfterFix: `The boundary covered by ${test.name} passes while preserving the previously failing case.`,
        domains: test.domains,
      });
    }
  }
  if (output.length === 0) throw new Error(`failed tests in ${runId} have no registered anchors`);
  return collapse(output);
}

async function resolveAffected(
  affected: string,
  repoPath: string,
  dependencies: IncidentDependencies,
  marker?: string,
): Promise<Array<Pick<IncidentAnchor, 'anchor' | 'subject'>>> {
  const location = parseLocation(affected);
  const symbol = location.symbol ?? marker;
  if (symbol !== undefined && symbol !== '') {
    const hits = (await dependencies.find(symbol, repoPath)).filter((hit) => (
      hit.anchor !== null && (location.file === undefined || normalizePath(hit.filePath) === location.file)
    ));
    if (hits.length > 0) return hits.map((hit) => ({
      anchor: hit.anchor!,
      subject: {
        symbol: hit.name,
        file: normalizePath(hit.filePath),
        line: hit.startLine,
        signature: hit.signature,
      },
    }));
  }

  const whereResult = await dependencies.where(affected, repoPath);
  const anchors = extractAnchors(whereResult);
  if (anchors.length === 0) throw new Error(`Anatomia could not resolve incident affected site: ${affected}`);
  return anchors.map((anchor) => ({
    anchor,
    subject: {
      symbol: symbol ?? affected,
      file: location.file ?? 'incident/unknown',
      line: location.line ?? 0,
    },
  }));
}

function parseFrontmatter(body: string): { frontmatter: Record<string, string | string[]>; content: string } {
  const match = body.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
  if (match === null) throw new Error('problem log has invalid frontmatter');
  const frontmatter: Record<string, string | string[]> = {};
  let current: string | undefined;
  for (const rawLine of match[1]!.split(/\r?\n/)) {
    const nested = rawLine.match(/^\s+(symbol|line):\s*(.+)$/);
    if (nested !== null && current === 'affected' && Array.isArray(frontmatter.affected) && frontmatter.affected.length > 0) {
      const index = frontmatter.affected.length - 1;
      const prior = frontmatter.affected[index]!;
      const value = stripQuotes(nested[2]!.trim());
      if (nested[1] === 'symbol') frontmatter.affected[index] = `${prior}#${value}`;
      else {
        const [file, symbol] = prior.split('#', 2);
        frontmatter.affected[index] = `${file}:${value}${symbol === undefined ? '' : `#${symbol}`}`;
      }
      continue;
    }
    const key = rawLine.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (key !== null) {
      current = key[1]!;
      const value = stripQuotes(key[2]!.trim());
      frontmatter[current] = value.startsWith('[') && value.endsWith(']')
        ? value.slice(1, -1).split(',').map((item) => stripQuotes(item.trim())).filter(Boolean)
        : value;
      continue;
    }
    const item = rawLine.match(/^\s*-\s+(.+)$/);
    if (item !== null && current !== undefined) {
      const existing = frontmatter[current];
      let value = stripQuotes(item[1]!.trim());
      if (current === 'affected') value = value.replace(/^file:\s*/, '');
      frontmatter[current] = [...(Array.isArray(existing) ? existing : existing ? [existing] : []), value];
    }
  }
  return { frontmatter, content: body.slice(match[0].length).trim() };
}

function parseLocation(value: string): { file?: string; line?: number; symbol?: string } {
  const symbolSplit = value.match(/^(.*?)(?:#|::)([^:#]+)$/);
  const base = symbolSplit?.[1] ?? value;
  const location = base.match(/^(.+?):(\d+)(?::\d+)?$/);
  const file = normalizePath(location?.[1] ?? base);
  return {
    ...(file.includes('/') || /\.[A-Za-z0-9]+$/.test(file) ? { file } : {}),
    ...(location === null ? {} : { line: Number(location[2]) }),
    ...(symbolSplit === null ? {} : { symbol: symbolSplit[2] }),
  };
}

function extractAnchors(value: unknown): string[] {
  const output = new Set<string>();
  const visit = (item: unknown): void => {
    if (Array.isArray(item)) {
      for (const child of item) visit(child);
      return;
    }
    if (item === null || typeof item !== 'object') return;
    for (const [key, child] of Object.entries(item as Record<string, unknown>)) {
      if ((key === 'anchor' || key === 'anchorId') && typeof child === 'string') output.add(child);
      else visit(child);
    }
  };
  visit(value);
  return [...output].sort();
}

function collapse(items: readonly IncidentAnchor[]): IncidentAnchor[] {
  const output = new Map<string, IncidentAnchor>();
  for (const item of items) if (!output.has(`${item.anchor}\n${item.subject.file}\n${item.subject.line}`)) {
    output.set(`${item.anchor}\n${item.subject.file}\n${item.subject.line}`, item);
  }
  return [...output.values()].sort((left, right) => left.anchor.localeCompare(right.anchor));
}

function listValue(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value === undefined || value === '' ? [] : [value];
}

function siteText(site: string | { file: string; line?: number | undefined }): string {
  return typeof site === 'string' ? site : `${site.file}${site.line === undefined ? '' : `:${site.line}`}`;
}

function stripQuotes(value: string): string {
  return value.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, '$1$2');
}

function excerpt(value: string): string {
  return value.slice(0, 1000);
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
