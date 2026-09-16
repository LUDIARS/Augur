import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { PraeformaEvidenceResult, RunRecord, TestRecord } from './types.ts';

const mappingSchema = z.object({
  baseUrl: z.string().url(),
  projectId: z.string().min(1),
  sourceProjectKey: z.string().min(1),
  scenarios: z.record(z.object({ scenarioId: z.string().min(1), useCaseId: z.string().min(1).nullable() }).strict()),
}).strict();

type Mapping = z.infer<typeof mappingSchema>;
type Target = { testId: string; scenarioId: string; targetKind: 'scenario' | 'use_case'; targetId: string };
type Workspace = { scenario: { revision: number }; useCases: Array<{ id: string; revision: number }> };

export interface EvidenceDependencies {
  fetch: typeof globalThis.fetch;
  now: () => Date;
}

export class EvidenceConfigurationError extends Error { readonly exitCode = 2; }

/** @implements SPEC-PRAEFORMA-EVIDENCE */
export async function publishEvidence(
  run: RunRecord,
  records: readonly TestRecord[],
  input: { repoPath: string; dryRun: boolean },
  dependencies: Partial<EvidenceDependencies> = {},
): Promise<PraeformaEvidenceResult> {
  const mapping = loadMapping(input.repoPath);
  const fetch = dependencies.fetch ?? globalThis.fetch;
  const now = dependencies.now ?? (() => new Date());
  const byId = new Map(records.map((record) => [record.id, record]));
  const unresolved = new Set<string>();
  const targets = targetsFor(run, byId, mapping, unresolved);
  const evidence = [...(run.evidence ?? [])];
  const completed = new Set(evidence.map((item) => `${item.testId}\n${item.targetKind}\n${item.targetId}`));
  const failed: PraeformaEvidenceResult['failed'] = [];
  const planned: PraeformaEvidenceResult['planned'] = [];
  let registered = 0;
  let skipped = 0;
  const workspaces = new Map<string, Workspace>();

  for (const target of targets) {
    const key = `${target.testId}\n${target.targetKind}\n${target.targetId}`;
    if (completed.has(key)) {
      skipped += 1;
      continue;
    }
    try {
      const workspace = await workspaceFor(mapping, target.scenarioId, workspaces, fetch);
      const payload = bodyFor(run, byId.get(target.testId), target, mapping, workspace);
      if (input.dryRun) {
        planned.push({ testId: target.testId, targetKind: target.targetKind, targetId: target.targetId, body: payload });
        registered += 1;
        continue;
      }
      const response = await fetch(endpoint(mapping, target.scenarioId, 'evidence'), request(mapping, 'POST', payload));
      if (!response.ok) throw new Error(`Praeforma POST ${response.status}: ${await response.text()}`);
      const responseBody = await response.json() as { evidence?: { id?: unknown } };
      if (typeof responseBody.evidence?.id !== 'string') throw new Error('Praeforma response lacks evidence id');
      evidence.push({ testId: target.testId, targetKind: target.targetKind, targetId: target.targetId, evidenceId: responseBody.evidence.id, at: now().toISOString() });
      completed.add(key);
      registered += 1;
    } catch (error) {
      failed.push({ testId: target.testId, targetId: target.targetId, message: messageOf(error) });
    }
  }
  return {
    attempted: targets.length,
    registered,
    skipped,
    failed,
    unresolvedUxRefs: [...unresolved].sort(),
    evidence,
    planned,
    dryRun: input.dryRun,
  };
}

function loadMapping(repoPath: string): Mapping {
  const path = join(repoPath, '.augur', 'praeforma.json');
  if (!existsSync(path)) throw new EvidenceConfigurationError(`Praeforma evidence is not configured: ${path}`);
  try {
    return mappingSchema.parse(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  } catch (error) {
    throw new EvidenceConfigurationError(`invalid Praeforma evidence configuration: ${messageOf(error)}`);
  }
}

function targetsFor(run: RunRecord, records: ReadonlyMap<string, TestRecord>, mapping: Mapping, unresolved: Set<string>): Target[] {
  const targets = new Map<string, Target>();
  for (const result of run.results) {
    const refs = records.get(result.testId)?.uxRefs ?? [];
    for (const ref of refs) {
      const destination = mapping.scenarios[ref];
      if (destination === undefined) {
        unresolved.add(ref);
        continue;
      }
      const target = {
        testId: result.testId,
        scenarioId: destination.scenarioId,
        targetKind: destination.useCaseId === null ? 'scenario' : 'use_case',
        targetId: destination.useCaseId ?? destination.scenarioId,
      } as const;
      targets.set(`${target.testId}\n${target.targetKind}\n${target.targetId}`, target);
    }
  }
  return [...targets.values()].sort((left, right) => `${left.testId}\n${left.targetId}`.localeCompare(`${right.testId}\n${right.targetId}`));
}

async function workspaceFor(mapping: Mapping, scenarioId: string, cache: Map<string, Workspace>, fetch: typeof globalThis.fetch): Promise<Workspace> {
  const cached = cache.get(scenarioId);
  if (cached !== undefined) return cached;
  const response = await fetch(endpoint(mapping, scenarioId, 'workspace'), request(mapping, 'GET'));
  if (!response.ok) throw new Error(`Praeforma GET ${response.status}: ${await response.text()}`);
  const value = await response.json() as { workspace?: Workspace };
  const workspace = value.workspace;
  if (workspace === undefined) throw new EvidenceConfigurationError('Praeforma workspace response lacks workspace configuration');
  if (!Number.isInteger(workspace.scenario.revision) || !Array.isArray(workspace.useCases)) throw new Error('Praeforma workspace response is invalid');
  cache.set(scenarioId, workspace);
  return workspace;
}

function bodyFor(run: RunRecord, test: TestRecord | undefined, target: Target, mapping: Mapping, workspace: Workspace): Record<string, unknown> {
  const result = run.results.find((item) => item.testId === target.testId);
  if (result === undefined) throw new Error(`run result is absent for ${target.testId}`);
  const useCaseRevision = target.targetKind === 'use_case'
    ? workspace.useCases.find((item) => item.id === target.targetId)?.revision
    : undefined;
  if (target.targetKind === 'use_case' && !Number.isInteger(useCaseRevision)) throw new Error(`use case is absent from scenario workspace: ${target.targetId}`);
  return {
    targetKind: target.targetKind,
    targetId: target.targetId,
    kind: 'test',
    sourceProjectKey: mapping.sourceProjectKey,
    sourceRevision: run.headSha,
    sourceRef: `${run.repository}@${run.headSha} run:${run.runId} test:${target.testId}`,
    status: result.status,
    expectedScenarioRevision: workspace.scenario.revision,
    expectedUseCaseRevision: target.targetKind === 'use_case' ? useCaseRevision : null,
    payload: {
      runId: run.runId,
      testId: target.testId,
      name: test?.name ?? target.testId,
      bundle: run.bundle,
      durationMs: result.durationMs,
      ...(result.failureMessage === undefined ? {} : { failureMessage: result.failureMessage }),
    },
  };
}

function endpoint(mapping: Mapping, scenarioId: string, suffix: 'workspace' | 'evidence'): string {
  return `${mapping.baseUrl.replace(/\/$/, '')}/api/projects/${encodeURIComponent(mapping.projectId)}/ux-design/scenarios/${encodeURIComponent(scenarioId)}/${suffix}`;
}

function request(mapping: Mapping, method: 'GET' | 'POST', body?: Record<string, unknown>): RequestInit {
  return {
    method,
    headers: { Origin: mapping.baseUrl, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
