import { latestText, phaseBreakdown } from '../contracts/acceptance.ts';
import type { ContractsSummary } from '../contracts/aggregate.ts';
import { summaryLine } from '../contracts/report-format.ts';
import type { RunRecord, TestRecord } from './types.ts';

export type Report = RunRecord & {
  tests: Record<string, TestRecord>;
  /** Absent for a repository that declares no contracts (§6.3). */
  contracts?: ContractsSummary;
};

export function createReport(
  run: RunRecord,
  records: readonly TestRecord[],
  contracts?: ContractsSummary | undefined,
): Report {
  const byId = new Map(records.map((record) => [record.id, record]));
  const tests = Object.fromEntries(run.bundle.testIds.flatMap((id) => {
    const test = byId.get(id);
    return test === undefined ? [] : [[id, test]];
  }));
  return { ...run, tests, ...(contracts === undefined ? {} : { contracts }) };
}

export function formatReportText(report: Report): string {
  const lines = [
    `Augur test report — ${report.runId}`,
    `Repository: ${report.repository}`,
    `Head: ${report.headSha}`,
    `Status: ${report.status}`,
    '',
  ];
  for (const [domain, results] of groupResults(report)) {
    lines.push(domain);
    for (const result of results) {
      const test = report.tests[result.testId];
      lines.push(`  ${symbol(result.status)} ${result.testId} ${test?.name ?? '(registry entry unavailable)'} (${result.durationMs}ms)`);
      if (result.failureMessage !== undefined) lines.push(`    ${result.failureMessage}`);
    }
    lines.push('');
  }
  if (report.contracts !== undefined) lines.push(...contractLines(report.contracts), '');
  lines.push(`Summary: ${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.error} error, ${report.summary.skipped} skipped`);
  if (report.verdict !== undefined) lines.push(`Verdict: ${report.verdict.decision} by ${report.verdict.by}`);
  return `${lines.join('\n')}\n`;
}

// One line per contract, beside the test results rather than in a separate
// command: the judge reads both on one screen (§6.3).
function contractLines(contracts: ContractsSummary): string[] {
  const lines = ['Contracts'];
  for (const entry of contracts.contracts) {
    const detail = entry.state === 'violated'
      ? ` (${phaseBreakdown(entry)}) ${latestText(entry)}`
      : entry.state === 'uncovered' ? ` (${entry.uncoveredReason ?? 'not-called'})` : '';
    lines.push(`  ${entry.state.padEnd(9)} ${entry.id.padEnd(6)} ${entry.symbol} calls ${entry.calls} violations ${entry.violationTotal}${detail}`);
  }
  lines.push(`  ${summaryLine(contracts)}`);
  return lines;
}

export function formatReportMarkdown(report: Report): string {
  const lines = [
    `## Augur test report \`${report.runId}\``,
    '',
    `**${report.status.toUpperCase()}** — \`${report.headSha}\``,
    '',
  ];
  for (const [domain, results] of groupResults(report)) {
    lines.push(`### ${domain}`, '');
    for (const result of results) {
      const test = report.tests[result.testId];
      lines.push(`- ${symbol(result.status)} \`${result.testId}\` ${test?.name ?? '(registry entry unavailable)'} (${result.durationMs}ms)`);
      if (result.failureMessage !== undefined) lines.push(`  - ${result.failureMessage.replaceAll('\n', ' ')}`);
    }
    lines.push('');
  }
  if (report.contracts !== undefined) {
    lines.push('### Contracts', '');
    for (const entry of report.contracts.contracts) {
      const detail = entry.state === 'violated' ? ` — ${latestText(entry)}` : '';
      lines.push(`- ${entry.state} \`${entry.id}\` \`${entry.symbol}\` calls ${entry.calls}, violations ${entry.violationTotal}${detail}`);
    }
    lines.push('', summaryLine(report.contracts), '');
  }
  lines.push(`Passed ${report.summary.passed}/${report.summary.total}; failed ${report.summary.failed}; errors ${report.summary.error}; skipped ${report.summary.skipped}.`);
  return `${lines.join('\n')}\n`;
}

function groupResults(report: Report): Array<[string, RunRecord['results']]> {
  const groups = new Map<string, RunRecord['results']>();
  for (const result of report.results) {
    const test = report.tests[result.testId];
    const domains = test?.domains.business.length ? test.domains.business : ['(unowned)'];
    for (const domain of domains) {
      const group = groups.get(domain) ?? [];
      group.push(result);
      groups.set(domain, group);
    }
  }
  const rank: Record<RunRecord['results'][number]['status'], number> = { failed: 0, error: 1, passed: 2, skipped: 3 };
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([domain, results]) => [
    domain,
    [...results].sort((left, right) => rank[left.status] - rank[right.status] || left.testId.localeCompare(right.testId)),
  ]);
}

function symbol(status: RunRecord['results'][number]['status']): string {
  return { passed: '✔', failed: '✘', skipped: '–', error: '!' }[status];
}
