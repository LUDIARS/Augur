// Human rendering of a contract summary (spec/plan/2026-09-05-live-contract-testing.md §1.2).
// One contract per line — state, id, symbol, calls, violations, latest reason —
// so a report of a dozen contracts stays one screen. Pure text; the CLI owns IO.

import { latestText, phaseBreakdown } from './acceptance.ts';
import type { ContractSummaryEntry, ContractsSummary } from './aggregate.ts';

export function formatContractsText(summary: ContractsSummary): string {
  const lines = summary.contracts.map((entry) => [
    entry.state.padEnd(9),
    entry.id.padEnd(6),
    entry.symbol.padEnd(20),
    `calls ${String(entry.calls).padEnd(5)}`,
    `violations ${entry.violationTotal}`,
    detail(entry),
  ].join(' ').trimEnd());
  lines.push(summaryLine(summary));
  return `${lines.join('\n')}\n`;
}

export function formatContractsMarkdown(summary: ContractsSummary): string {
  const lines = [
    '## Contracts',
    '',
    `Window: ${summary.window.since ?? '(all)'} → ${summary.window.until ?? '(now)'}`,
    '',
    '| state | id | symbol | calls | violations | detail |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const entry of summary.contracts) {
    lines.push(`| ${entry.state} | \`${entry.id}\` | \`${entry.symbol}\` | ${entry.calls} | ${entry.violationTotal} | ${escapeCell(detail(entry))} |`);
  }
  lines.push('', summaryLine(summary));
  return `${lines.join('\n')}\n`;
}

export function summaryLine(summary: ContractsSummary): string {
  const { covered, violated, uncovered } = summary.totals;
  const { matched, foreign, outOfWindow, undated } = summary.diagnostics;
  return `summary: covered=${covered} violated=${violated} uncovered=${uncovered}`
    + ` (events matched=${matched} foreign=${foreign} out-of-window=${outOfWindow} undated=${undated})`;
}

/** The one thing a reader needs beyond the counts, per state. */
function detail(entry: ContractSummaryEntry): string {
  if (entry.state === 'violated') return `(${phaseBreakdown(entry)}) ${latestText(entry)}`;
  if (entry.state === 'uncovered') return `(${entry.uncoveredReason ?? 'not-called'})`;
  return entry.file;
}

function escapeCell(text: string): string {
  return text.replaceAll('|', '\\|').replaceAll('\n', ' ');
}
