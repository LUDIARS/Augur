import type { ContractTotals } from './contracts.ts';
import type { FlagResult, RunRecord } from './types.ts';

export class FlagPreconditionError extends Error {
  readonly exitCode = 1;
  constructor(message: string) {
    super(message);
    this.name = 'FlagPreconditionError';
  }
}

export interface FlagClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  now?: () => Date;
}

export async function flagRun(
  run: RunRecord,
  pullRequest: string,
  options: FlagClientOptions = {},
  contracts?: ContractTotals | undefined,
): Promise<FlagResult> {
  assertFlagPreconditions(run);
  const request = options.fetch ?? fetch;
  const baseUrl = (options.baseUrl ?? process.env.AUGUR_REVISOR_URL ?? 'http://127.0.0.1:4240').replace(/\/$/, '');
  const at = (options.now ?? (() => new Date()))().toISOString();
  let pullRequestId: string;
  try {
    pullRequestId = await resolvePullRequestId(request, baseUrl, pullRequest);
  } catch (error) {
    return result(pullRequest, at, 'rejected', messageOf(error));
  }

  const body = {
    source: 'augur',
    headSha: run.headSha,
    runId: run.runId,
    decision: 'accept',
    by: run.verdict!.by,
    at: run.verdict!.at,
    // The contract counts ride inside `summary` so Revisor renders them beside
    // the test totals; a repository without contracts sends the field unchanged
    // (spec/interface/revisor-verification.md §2).
    summary: contracts === undefined ? run.summary : { ...run.summary, contracts },
    bundle: { kind: run.bundle.kind, testIds: run.bundle.testIds },
    reportUrl: null,
    ...(run.verdict!.note === undefined ? {} : { note: run.verdict!.note }),
  };

  try {
    const response = await request(`${baseUrl}/api/local-prs/${encodeURIComponent(pullRequestId)}/verification`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    if (response.ok) return result(pullRequestId, at, 'ok');
    if (response.status === 404 && !isContractJson(response.headers.get('content-type'), text)) {
      return result(pullRequestId, at, 'not_supported', 'Revisor verification route is not available');
    }
    if (response.status === 400 || response.status === 404 || response.status === 409) {
      return result(pullRequestId, at, 'rejected', responseDetail(text, response.status));
    }
    return result(pullRequestId, at, 'error', responseDetail(text, response.status));
  } catch (error) {
    return result(pullRequestId, at, 'error', messageOf(error));
  }
}

export function assertFlagPreconditions(run: RunRecord): void {
  if (run.status !== 'passed') throw new FlagPreconditionError('run status must be passed before flagging');
  if (run.verdict?.decision !== 'accept') throw new FlagPreconditionError('an accept verdict is required before flagging');
}

function result(
  pullRequestId: string,
  at: string,
  outcome: FlagResult['outcome'],
  detail?: string,
): FlagResult {
  return {
    target: 'revisor',
    pullRequestId,
    at,
    outcome,
    ...(detail === undefined ? {} : { detail: detail.slice(0, 2000) }),
  };
}

async function resolvePullRequestId(request: typeof fetch, baseUrl: string, value: string): Promise<string> {
  const match = /^(?:Rv)?#(\d+)$/i.exec(value);
  if (match === null) return value;
  const response = await request(`${baseUrl}/api/local-prs?view=summary&state=open`);
  if (!response.ok) throw new Error(`could not resolve ${value}: Revisor returned ${response.status}`);
  const data: unknown = await response.json();
  const candidates = extractArray(data);
  const requested = Number(match[1]);
  const found = candidates.find((candidate) => candidateNumber(candidate) === requested);
  const id = found?.id;
  if (typeof id !== 'string') throw new Error(`pull request ${value} was not found`);
  return id;
}

function extractArray(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  for (const key of ['pullRequests', 'items', 'results', 'data']) {
    const nested = value[key];
    if (Array.isArray(nested)) return nested.filter(isRecord);
  }
  return [];
}

function candidateNumber(value: Record<string, unknown>): number | undefined {
  for (const key of ['number', 'reviewNumber', 'localPrNumber', 'sequenceNumber', 'sequence', 'displayNumber']) {
    const candidate = value[key];
    if (typeof candidate === 'number') return candidate;
    if (typeof candidate === 'string' && /^\d+$/.test(candidate)) return Number(candidate);
  }
  const label = value.label ?? value.displayId;
  if (typeof label === 'string') {
    const match = /(?:Rv)?#(\d+)/i.exec(label);
    if (match !== null) return Number(match[1]);
  }
  return undefined;
}

function isContractJson(contentType: string | null, text: string): boolean {
  if (!contentType?.toLowerCase().includes('json')) return false;
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) && isRecord(parsed.error) && typeof parsed.error.code === 'string';
  } catch {
    return false;
  }
}

function responseDetail(text: string, status: number): string {
  try {
    const parsed: unknown = JSON.parse(text);
    if (isRecord(parsed) && isRecord(parsed.error)) {
      const message = parsed.error.message;
      const code = parsed.error.code;
      if (typeof message === 'string') return `${String(code ?? status)}: ${message}`;
      if (typeof code === 'string') return code;
    }
  } catch {
    // The body is used below as a diagnostic only.
  }
  return text.trim() || `Revisor returned ${status}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
