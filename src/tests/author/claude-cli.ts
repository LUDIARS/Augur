import { spawn } from 'node:child_process';
import { z } from 'zod';
import type { AuthoringBrief, RunnerId } from '../types.ts';

export class ClaudeCliUnavailableError extends Error {
  readonly exitCode = 2;
  constructor(message: string) {
    super(message);
    this.name = 'ClaudeCliUnavailableError';
  }
}

export class ClaudeCliGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClaudeCliGenerationError';
  }
}

const responseSchema = z.object({
  file: z.string().optional(),
  body: z.string().optional(),
  result: z.string().optional(),
}).passthrough().refine((value) => value.body !== undefined || value.result !== undefined, {
  message: 'Claude JSON response must contain body or result',
});

export interface ClaudeTargetInput {
  model: string;
  file: string;
  runner: RunnerId;
  brief: AuthoringBrief;
  sourceExcerpt: string;
  exemplar?: { file: string; source: string };
  existingFile: boolean;
}

export interface ClaudeCliOptions {
  command?: string;
  prefixArgs?: string[];
  timeoutMs?: number;
}

export async function generateWithClaude(
  input: ClaudeTargetInput,
  options: ClaudeCliOptions = {},
): Promise<string> {
  const output = await invokeClaude(
    options.command ?? 'claude',
    [...(options.prefixArgs ?? []), '-p', '--model', input.model, '--output-format', 'json'],
    promptFor(input),
    options.timeoutMs ?? 120_000,
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(output) as unknown;
  } catch (error) {
    throw new ClaudeCliGenerationError(`Claude returned invalid JSON: ${messageOf(error)}`);
  }
  const envelope = responseSchema.parse(parsed);
  const nested = envelope.body === undefined ? parseNested(envelope.result!) : undefined;
  const declaredFile = envelope.file ?? nested?.file;
  if (declaredFile !== undefined && normalizePath(declaredFile) !== normalizePath(input.file)) {
    throw new ClaudeCliGenerationError(`Claude named an unplanned file: ${declaredFile}`);
  }
  const body = stripFence(envelope.body ?? nested?.body ?? envelope.result!);
  validateBody(body, input);
  return body;
}

export function validateBody(body: string, input: Pick<ClaudeTargetInput, 'file' | 'runner' | 'brief' | 'existingFile'>): void {
  if (body.trim() === '') throw new ClaudeCliGenerationError('Claude returned an empty test body');
  for (const term of input.brief.mustNot) {
    if (body.toLocaleLowerCase().includes(term.toLocaleLowerCase())) {
      throw new ClaudeCliGenerationError(`Claude body contains forbidden term: ${term}`);
    }
  }
  const namedFiles = [...body.matchAll(/(?:^|\n)\s*(?:(?:\/\/|#)\s*)?(?:file|path)\s*:\s*([^\s]+)|(?:^|\n)(?:\+\+\+|---)\s+(?:[ab]\/)?([^\s]+)/gi)]
    .map((match) => match[1] ?? match[2])
    .filter((value): value is string => value !== undefined);
  for (const file of namedFiles) {
    if (normalizePath(file) !== normalizePath(input.file) && file !== '/dev/null') {
      throw new ClaudeCliGenerationError(`Claude body names an unplanned file: ${file}`);
    }
  }
  if (!runnerRecognises(body, input.runner)) {
    throw new ClaudeCliGenerationError(`Claude body is not recognisable by runner ${input.runner}`);
  }
  if (input.existingFile && input.runner === 'vitest' && !/^\s*describe\s*\(/.test(body)) {
    throw new ClaudeCliGenerationError('an existing Vitest file may only receive a describe block');
  }
}

function runnerRecognises(body: string, runner: RunnerId): boolean {
  if (runner === 'vitest') return /\b(?:describe|it|test)\s*\(/.test(body);
  if (runner === 'cargo') return /#\s*\[\s*test\s*\]/.test(body);
  if (runner === 'gtest') return /\bTEST(?:_F|_P)?\s*\(/.test(body);
  if (runner === 'unity') return /\[\s*(?:Test|UnityTest)\s*\]/.test(body);
  return body.trim().length > 0;
}

function promptFor(input: ClaudeTargetInput): string {
  return [
    'Write exactly one test target from this deterministic Augur brief.',
    `Return JSON only: {"file":${JSON.stringify(input.file)},"body":"..."}.`,
    input.existingFile
      ? 'The body must be one append-only describe block with no imports or edits to existing text.'
      : 'The body must be the complete new test file.',
    'Do not name or modify any other file.',
    `Runner: ${input.runner}`,
    `Brief: ${JSON.stringify(input.brief)}`,
    `Subject source excerpt:\n${input.sourceExcerpt}`,
    input.exemplar === undefined ? '' : `Exemplar ${input.exemplar.file}:\n${input.exemplar.source}`,
  ].filter(Boolean).join('\n\n');
}

async function invokeClaude(command: string, argv: readonly string[], prompt: string, timeoutMs: number): Promise<string> {
  return await new Promise((resolveOutput, reject) => {
    const child = spawn(command, [...argv], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer | string) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer | string) => { stderr += chunk.toString(); });
    child.once('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timeout);
      reject(error.code === 'ENOENT'
        ? new ClaudeCliUnavailableError(`claude CLI not found: ${command}`)
        : new ClaudeCliUnavailableError(`claude CLI failed to start: ${messageOf(error)}`));
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
      if (timedOut) reject(new ClaudeCliGenerationError(`claude CLI timed out after ${timeoutMs}ms`));
      else if (code === 0) resolveOutput(stdout);
      else reject(new ClaudeCliGenerationError(`claude CLI exited ${code ?? 'by signal'}: ${stderr.slice(-2000)}`));
    });
    child.stdin.end(prompt);
  });
}

function parseNested(value: string): { file?: string; body?: string } | undefined {
  try {
    const parsed = z.object({ file: z.string().optional(), body: z.string() }).passthrough().safeParse(JSON.parse(value));
    return parsed.success
      ? { ...(parsed.data.file === undefined ? {} : { file: parsed.data.file }), body: parsed.data.body }
      : undefined;
  } catch {
    return undefined;
  }
}

function stripFence(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:[\w+-]+)?\s*\n([\s\S]*?)\n```$/);
  return (match?.[1] ?? trimmed).trim();
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
