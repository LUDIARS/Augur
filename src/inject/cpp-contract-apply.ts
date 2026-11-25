// contract-wrap fragments for C++ (SPEC-CONTRACT-CPP-INJECT).
//
// A C++ function cannot be reassigned the way `f = contract(f, spec)` rebinds a
// JavaScript function, so the body is wrapped in place. Every edit is an
// insert; the original bytes stay where they were:
//
//   int f(int a) { BODY }
//   int f(int a) { return ::augur::invoke_observed(::augur::ContractSpec{"C-1", "<id>", "src/f.cpp:3"},
//                      contracts::f_checks, [&]() -> int { /*marker*/ BODY }, a); /*end*/ }
//
// plus one `#include` per predicate header and one for the runtime header.
// Pure: candidates in, edits out.

import { posix } from 'node:path';
import { marker, pointId } from './markers.ts';
import { CONTRACT_IMPORT_RULE, CONTRACT_RULE } from './contract-scan.ts';
import type { Candidate, TextEdit } from './types.ts';
import { contract } from '../../templates/contract-runtime/contract-runtime.ts'; /* augur-inject:import:faa3583a */
import augurContract_6cd66574 from '../../contracts/cpp-runtime-sample.contract.ts'; /* augur-inject:contract-predicate:6df01489 */

/** Closing half of a wrap; bookkeeping only (it belongs to the opening marker's point). */
export const CONTRACT_END_RULE = 'contract-end';
export const CPP_RUNTIME_INCLUDE_RULE = 'import';

/** A C++ string literal; contract ids and paths are plain ASCII but escape anyway. */
function cppString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** The opening fragment, inserted right after the body's `{`. */
export function cppOpenFragment(candidate: Candidate): string {
  const binding = candidate.contract;
  const site = candidate.cpp;
  if (binding === undefined || site === undefined) throw new Error(`C++ contract-wrap candidate ${candidate.id} has no site`);
  const sample = binding.sample === 1 ? '' : `, ${binding.sample}`;
  const spec = `::augur::ContractSpec{${cppString(binding.contractId)}, ${cppString(candidate.id)}, ${cppString(`${candidate.file}:${candidate.line}`)}${sample}}`;
  return ` return ::augur::invoke_observed(${spec}, ${binding.local}, [&]() -> ${site.returnType} { ${marker(CONTRACT_RULE, candidate.id)}`;
}
// @ts-expect-error augur-inject
cppOpenFragment = contract(cppOpenFragment, { ...augurContract_6cd66574, contractId: 'C-5', mode: 'observe', sample: 1, where: 'src/inject/cpp-contract-apply.ts:29', rule: 'contract-wrap', id: '6cd66574' }); /* augur-inject:contract-wrap:6cd66574 */

/** The closing fragment, inserted before the body's `}`. */
export function cppCloseFragment(candidate: Candidate): string {
  const parameters = candidate.cpp?.parameters ?? [];
  const forwarded = parameters.length > 0 ? `}, ${parameters.join(', ')});` : '});';
  return `${forwarded} ${marker(CONTRACT_END_RULE, candidate.id)} `;
}

export function cppContractEdits(candidate: Candidate): TextEdit[] {
  const site = candidate.cpp;
  if (site === undefined) return [];
  return [
    { start: site.bodyOpen, end: site.bodyOpen, text: cppOpenFragment(candidate) },
    { start: site.bodyClose, end: site.bodyClose, text: cppCloseFragment(candidate) },
  ];
}

/** Include path of `module` as written from `file` (both repository-relative). */
export function relativeInclude(file: string, module: string): string {
  return posix.relative(posix.dirname(file), module);
}

/** Offset after the last top-level `#include` line, else after `#pragma once`, else 0. */
export function includeAnchor(text: string): number {
  let anchor = 0;
  const directive = /^[ \t]*#[ \t]*(include|pragma[ \t]+once)\b.*$/gm;
  for (const match of text.matchAll(directive)) {
    const end = match.index + match[0].length;
    anchor = text[end] === '\r' ? end + 2 : text[end] === '\n' ? end + 1 : end;
  }
  return anchor;
}

function includeLine(path: string, rule: string, id: string, crlf: boolean): string {
  return `#include ${cppString(path)} ${marker(rule, id)}${crlf ? '\r\n' : '\n'}`;
}

function hasInclude(text: string, path: string): boolean {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^[ \\t]*#[ \\t]*include[ \\t]*["<]${escaped}[">]`, 'm').test(text);
}

/**
 * One marker-tagged `#include` for each predicate header the pending wraps use,
 * and one for the runtime header unless the file already includes it.
 */
export function cppIncludeEdit(relPath: string, text: string, pending: readonly Candidate[]): TextEdit | null {
  const crlf = text.includes('\r\n');
  const lines: string[] = [];
  const seen = new Set<string>();
  let runtime: string | null = null;
  for (const candidate of pending) {
    const binding = candidate.contract;
    if (binding === undefined || candidate.cpp === undefined) continue;
    runtime ??= binding.importFrom;
    const header = relativeInclude(relPath, binding.module ?? binding.specifier);
    if (seen.has(header) || hasInclude(text, header)) continue;
    seen.add(header);
    lines.push(includeLine(header, CONTRACT_IMPORT_RULE, pointId(CONTRACT_IMPORT_RULE, relPath, binding.contractId, 0), crlf));
  }
  if (runtime !== null && !hasInclude(text, runtime)) {
    lines.unshift(includeLine(runtime, CPP_RUNTIME_INCLUDE_RULE, pointId(CPP_RUNTIME_INCLUDE_RULE, relPath, runtime, 0), crlf));
  }
  if (lines.length === 0) return null;
  const anchor = includeAnchor(text);
  // A file without a trailing newline after its last directive needs one first.
  const lead = anchor > 0 && text[anchor - 1] !== '\n' ? (crlf ? '\r\n' : '\n') : '';
  return { start: anchor, end: anchor, text: lead + lines.join('') };
}
