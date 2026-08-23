import { z } from 'zod';

export const runnerIdSchema = z.enum(['vitest', 'cargo', 'gtest', 'unity', 'command']);
export const testKindSchema = z.enum(['regression', 'assurance', 'guardrail']);
export const testStatusSchema = z.enum(['candidate', 'active', 'probation', 'retired']);
export const originTypeSchema = z.enum(['pr', 'incident', 'experience', 'manual']);

const repositoryFileSchema = z.string().min(1).superRefine((value, context) => {
  if (/^(?:[A-Za-z]:[\\/]|[/\\])/.test(value)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'must be repo-relative' });
  }
  if (value.includes('\\')) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'must use POSIX separators' });
  }
  if (value.split('/').includes('..')) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'must not contain ..' });
  }
});

export const testRecordSchema = z.object({
  id: z.string().regex(/^t-[A-Za-z0-9-]+$/),
  repository: z.string().min(1),
  name: z.string().min(1),
  file: repositoryFileSchema,
  selector: z.string().min(1).optional(),
  runner: runnerIdSchema,
  command: z.array(z.string()).min(1).optional(),
  kind: testKindSchema,
  domains: z.object({
    business: z.array(z.string()),
    program: z.array(z.string()).min(1),
  }).strict(),
  anchors: z.array(z.string()),
  origin: z.object({
    type: originTypeSchema,
    ref: z.string(),
    planId: z.string().optional(),
    authoredBy: z.enum(['session', 'claude-cli', 'human']).optional(),
  }).strict(),
  runtime: z.boolean(),
  always: z.boolean(),
  status: testStatusSchema,
  createdAt: z.string().datetime(),
  lastRunAt: z.string().datetime().optional(),
  lastFailedAt: z.string().datetime().optional(),
  passStreak: z.number().int().nonnegative(),
  runs: z.number().int().nonnegative(),
  retiredAt: z.string().datetime().optional(),
  retiredReason: z.string().optional(),
  tags: z.array(z.string()).optional(),
  note: z.string().optional(),
}).strict().superRefine((value, context) => {
  if (value.runner === 'command' && value.command === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['command'],
      message: 'is required when runner is command',
    });
  }
});

export const verdictSchema = z.object({
  decision: z.enum(['accept', 'reject']),
  by: z.string().min(1),
  at: z.string().datetime(),
  note: z.string().optional(),
}).strict();

export const flagResultSchema = z.object({
  target: z.literal('revisor'),
  pullRequestId: z.string().min(1),
  at: z.string().datetime(),
  outcome: z.enum(['ok', 'not_supported', 'rejected', 'error']),
  detail: z.string().optional(),
}).strict();

export const runResultSchema = z.object({
  testId: z.string(),
  status: z.enum(['passed', 'failed', 'skipped', 'error']),
  durationMs: z.number().nonnegative(),
  failureMessage: z.string().max(2000).optional(),
  outputTail: z.string().max(4000).optional(),
}).strict();

export const bundleKindSchema = z.enum(['pr', 'domain', 'all', 'ids']);

export const runRecordSchema = z.object({
  runId: z.string().startsWith('r-'),
  repository: z.string(),
  repoPath: z.string(),
  headSha: z.string(),
  branch: z.string().nullable(),
  bundle: z.object({
    kind: bundleKindSchema,
    selector: z.string().nullable(),
    testIds: z.array(z.string()),
    reason: z.record(z.string()),
  }).strict(),
  bus: z.string(),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
  durationMs: z.number().nonnegative(),
  results: z.array(runResultSchema),
  summary: z.object({
    total: z.number().int().nonnegative(),
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    error: z.number().int().nonnegative(),
  }).strict(),
  status: z.enum(['passed', 'failed', 'error']),
  verdict: verdictSchema.optional(),
  flag: flagResultSchema.optional(),
}).strict();

export type RunnerId = z.infer<typeof runnerIdSchema>;
export type TestKind = z.infer<typeof testKindSchema>;
export type TestStatus = z.infer<typeof testStatusSchema>;
export type TestRecord = z.infer<typeof testRecordSchema>;
export type Verdict = z.infer<typeof verdictSchema>;
export type FlagResult = z.infer<typeof flagResultSchema>;
export type RunResult = z.infer<typeof runResultSchema>;
export type BundleKind = z.infer<typeof bundleKindSchema>;
export type RunRecord = z.infer<typeof runRecordSchema>;

export interface RunQuery {
  repository?: string | undefined;
  headSha?: string | undefined;
  bundleKind?: BundleKind | undefined;
  since?: string | undefined;
  status?: RunRecord['status'] | undefined;
}

export interface RegisterInput {
  repoPath: string;
  file: string;
  name: string;
  runner: RunnerId;
  selector?: string;
  command?: string[];
  kind?: TestKind;
  program: string[];
  business?: string[];
  anchors?: string[];
  runtime?: boolean;
  always?: boolean;
}

export interface RunInput {
  repository?: string | undefined;
  repoPath?: string | undefined;
  bundle: string | { kind: BundleKind; selector?: string | null | undefined };
  head?: string | undefined;
  bus?: string | undefined;
  cached?: boolean | undefined;
  promote?: boolean | undefined;
  forRevisor?: boolean | undefined;
  /** Internal reservation used by the HTTP async adapter. */
  runId?: string | undefined;
}

export interface LintResult { valid: boolean; errors: string[] }
export interface SweepResult { changes: Array<{ id: string; from: TestStatus; to: TestStatus; reason: string }>; applied: boolean }
export interface PruneResult { files: string[]; applied: boolean }

export function deriveRunStatus(results: readonly RunResult[]): RunRecord['status'] {
  if (results.some((result) => result.status === 'failed')) return 'failed';
  if (results.some((result) => result.status === 'error')) return 'error';
  if (results.some((result) => result.status === 'passed')) return 'passed';
  return 'error';
}
