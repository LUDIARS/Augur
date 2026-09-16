import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EvidenceConfigurationError, publishEvidence } from '../../src/tests/evidence.ts';
import { createReport, formatReportText } from '../../src/tests/report.ts';
import { record, runRecord } from './fixtures.ts';

function repository(): string {
  const path = mkdtempSync(join(tmpdir(), 'augur-evidence-'));
  mkdirSync(join(path, '.augur'));
  writeFileSync(join(path, '.augur', 'praeforma.json'), JSON.stringify({
    baseUrl: 'http://127.0.0.1:8889', projectId: 'pf-project', sourceProjectKey: 'Cc',
    scenarios: { 'UX-CC-W1': { scenarioId: 'scenario-1', useCaseId: 'use-case-1' } },
  }), 'utf8');
  return path;
}

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('Praeforma evidence publishing', () => {
  it('gets current revisions and posts an Origin-bound evidence record', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      calls.push(init === undefined ? { url: String(url) } : { url: String(url), init });
      return calls.length === 1
        ? response(200, { workspace: { scenario: { revision: 7 }, useCases: [{ id: 'use-case-1', revision: 3 }] } })
        : response(201, { evidence: { id: 'e-1' } });
    };
    const result = await publishEvidence(runRecord(), [record({ uxRefs: ['UX-CC-W1'] })], { repoPath: repository(), dryRun: false }, { fetch, now: () => new Date('2026-09-16T00:00:00.000Z') });

    expect(result).toMatchObject({ attempted: 1, registered: 1, failed: [], unresolvedUxRefs: [] });
    expect(calls[0]?.init?.headers).toMatchObject({ Origin: 'http://127.0.0.1:8889' });
    expect(JSON.parse(String(calls[1]?.init?.body))).toMatchObject({ expectedScenarioRevision: 7, expectedUseCaseRevision: 3, status: 'passed', kind: 'test' });
  });

  it('does not post an already-recorded run/test/target tuple', async () => {
    const fetch = async (): Promise<Response> => { throw new Error('fetch must not be called'); };
    const run = runRecord({ evidence: [{ testId: 't-000000000001', targetKind: 'use_case', targetId: 'use-case-1', evidenceId: 'e-1', at: '2026-09-16T00:00:00.000Z' }] });
    const result = await publishEvidence(run, [record({ uxRefs: ['UX-CC-W1'] })], { repoPath: repository(), dryRun: false }, { fetch });
    expect(result).toMatchObject({ attempted: 1, registered: 0, skipped: 1, failed: [] });
  });

  it('keeps unresolved UX references without preventing mapped evidence', async () => {
    let call = 0;
    const fetch = async (): Promise<Response> => (++call === 1
      ? response(200, { workspace: { scenario: { revision: 1 }, useCases: [{ id: 'use-case-1', revision: 1 }] } })
      : response(201, { evidence: { id: 'e-1' } }));
    const result = await publishEvidence(runRecord(), [record({ uxRefs: ['UNKNOWN', 'UX-CC-W1'] })], { repoPath: repository(), dryRun: false }, { fetch });
    expect(result).toMatchObject({ registered: 1, unresolvedUxRefs: ['UNKNOWN'], failed: [] });
  });

  it.each([403, 500])('reports Praeforma HTTP %i as failure', async (status) => {
    const fetch = async (): Promise<Response> => response(status, { error: 'not allowed' });
    const result = await publishEvidence(runRecord(), [record({ uxRefs: ['UX-CC-W1'] })], { repoPath: repository(), dryRun: false }, { fetch });
    expect(result.failed).toHaveLength(1);
    expect(result.registered).toBe(0);
  });

  it('fails with exit 2 semantics when no mapping is configured', async () => {
    const path = mkdtempSync(join(tmpdir(), 'augur-evidence-missing-'));
    await expect(publishEvidence(runRecord(), [record()], { repoPath: path, dryRun: false }))
      .rejects.toBeInstanceOf(EvidenceConfigurationError);
  });

  it('reports registered evidence and unresolved UX references only when present', () => {
    const report = createReport(runRecord({
      evidence: [{ testId: 't-000000000001', targetKind: 'use_case', targetId: 'use-case-1', evidenceId: 'e-1', at: '2026-09-16T00:00:00.000Z' }],
      unresolvedUxRefs: ['UX-UNKNOWN'],
    }), [record()]);
    expect(formatReportText(report)).toContain('Evidence: 1 registered, 1 unresolved uxRefs');
    expect(formatReportText(createReport(runRecord(), [record()]))).not.toContain('Evidence:');
  });
});
