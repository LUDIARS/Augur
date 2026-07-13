import { z } from 'zod';

// Zod schemas are the single source of truth for the shapes defined in
// spec/data/core-schema.md. Types are inferred, never hand-written twice.

export const objectiveKindSchema = z.enum([
  'new_feature',
  'bug_fix',
  'regression',
  'refactor',
  'performance',
  'stability',
  'security',
  'unknown',
]);

export const objectiveSchema = z.object({
  kind: objectiveKindSchema,
  description: z.string().min(1, 'objective.description is required'),
  desiredOutcome: z.string().optional(),
});

export const projectDomainSchema = z.enum(['web', 'game', 'service', 'other']);

export const projectContextSchema = z.object({
  name: z.string().optional(),
  domain: projectDomainSchema.optional(),
  language: z.string().optional(),
  frameworks: z.array(z.string()).optional(),
  testRunners: z.array(z.string()).optional(),
  packageManager: z.string().optional(),
});

export const changeSignalSchema = z.object({
  diff: z.string().optional(),
  changedFiles: z.array(z.string()).optional(),
});

export const failureSignalSchema = z.object({
  command: z.string().optional(),
  exitCode: z.number().int().optional(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  stackTrace: z.string().optional(),
});

export const coverageSignalSchema = z.object({
  format: z.enum(['lcov', 'json', 'text', 'unknown']),
  content: z.string(),
});

export const runtimeSignalSchema = z.object({
  type: z.enum(['web_response', 'api_latency', 'memory', 'cpu', 'media_analysis', 'custom']),
  name: z.string(),
  value: z.number(),
  unit: z.string(),
  percentile: z.number().optional(),
  scope: z.string().optional(),
  source: z.string().optional(),
});

export const experienceQualitySchema = z.enum([
  // Common (any interactive product)
  'responsiveness', // EG-C01
  'smoothness', // EG-C02
  'feedback', // EG-C03
  'stability_feel', // EG-C04
  'consistency', // EG-C05
  'startup_readiness', // EG-C06
  'progress_transparency', // EG-C07
  'recoverability', // EG-C08
  'continuity', // EG-C09
  'effortlessness', // EG-C10
  'accessibility', // EG-C11
  'resource_frugality', // EG-C12
  // Web
  'freshness', // EG-W01
  'seamless_navigation', // EG-W02
  'cross_browser_consistency', // EG-W03
  'shareability', // EG-W04
  // Game (including networked play)
  'control_latency', // EG-G01
  'frame_pacing', // EG-G02
  'netplay_responsiveness', // EG-G03
  'sync_integrity', // EG-G04
  'disruption_tolerance', // EG-G05
  'matchmaking_flow', // EG-G06
  'load_seamlessness', // EG-G07
  'audio_visual_sync', // EG-G08
  'fairness_feel', // EG-G09
  'progression_integrity', // EG-G10
  'visual_fidelity', // EG-G11
  'content_rating_compliance', // EG-G12
  'custom',
]);

export const experienceTargetSchema = z.object({
  metric: z.string(),
  threshold: z.number(),
  unit: z.string(),
  percentile: z.number().optional(),
  scope: z.string().optional(),
});

export const experienceExemptionSchema = z.object({
  scope: z.string(),
  reason: z.string(),
  relaxedTarget: experienceTargetSchema.optional(),
  proposedBy: z.enum(['caller', 'llm']).optional(),
});

export const experienceGoalSchema = z.object({
  quality: experienceQualitySchema,
  description: z.string().optional(),
  targets: z.array(experienceTargetSchema).optional(),
  exemptions: z.array(experienceExemptionSchema).optional(),
});

export const planningConstraintSchema = z.object({
  type: z.enum(['runner', 'framework', 'scope', 'time', 'policy', 'custom']),
  value: z.string(),
});

export const prioritySchema = z.enum(['critical', 'high', 'medium', 'low']);

export const focusedTestingRiskSchema = z.enum([
  'boundary',
  'memory_safety',
  'authorization',
  'state_transition',
  'concurrency',
  'contract',
]);

export const focusedVariableSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(['parameter', 'field']),
  priority: prioritySchema,
  type: z.string().min(1).optional(),
});

export const focusedTargetSchema = z.object({
  symbol: z.string().min(1),
  file: z.string().min(1),
  line: z.number().int().nonnegative(),
  variables: z.array(focusedVariableSchema),
});

export const focusedDomainSchema = z.object({
  domain: z.string().min(1),
  priority: prioritySchema,
  risks: z.array(focusedTestingRiskSchema).min(1),
  inferredRisks: z.array(focusedTestingRiskSchema).min(1).optional(),
  rationale: z.string().min(1).optional(),
  targets: z.array(focusedTargetSchema).min(1),
});

export const focusedTestingSchema = z.object({
  source: z.literal('anatomia'),
  domains: z.array(focusedDomainSchema).min(1),
}).superRefine((value, ctx) => {
  const seen = new Set<string>();
  value.domains.forEach((domain, index) => {
    if (seen.has(domain.domain)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['domains', index, 'domain'],
        message: `duplicate focused domain "${domain.domain}"`,
      });
    }
    seen.add(domain.domain);
  });
});

export const createPlanRequestSchema = z.object({
  objective: objectiveSchema,
  project: projectContextSchema.optional(),
  change: changeSignalSchema.optional(),
  failure: failureSignalSchema.optional(),
  coverage: coverageSignalSchema.optional(),
  runtimeSignals: z.array(runtimeSignalSchema).optional(),
  experienceGoals: z.array(experienceGoalSchema).optional(),
  constraints: z.array(planningConstraintSchema).optional(),
  focusedTesting: focusedTestingSchema.optional(),
});

export const testDraftSchema = z.object({
  framework: z.string().optional(),
  description: z.string(),
  outline: z.array(z.string()).optional(),
});

export const testKindSchema = z.enum([
  'unit',
  'integration',
  'contract',
  'e2e',
  'performance',
  'regression',
  'security',
  'flaky',
]);

export const testSuggestionSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: testKindSchema,
  priority: prioritySchema,
  confidence: z.number().min(0).max(1),
  targetFiles: z.array(z.string()).optional(),
  rationale: z.string(),
  draft: testDraftSchema,
  budget: experienceTargetSchema.optional(),
  proposedBudget: z.boolean().optional(),
  evidenceIds: z.array(z.string()),
});

export const testPlanSchema = z.object({
  suggestions: z.array(testSuggestionSchema),
});

export const fixStrategySchema = z.enum([
  'minimal',
  'behavior_preserving',
  'contract_first',
  'test_first',
  'investigate_first',
]);

export const fixStepSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  targetFiles: z.array(z.string()).optional(),
  dependsOn: z.array(z.string()).optional(),
  evidenceIds: z.array(z.string()),
});

export const riskSchema = z.object({
  id: z.string(),
  severity: prioritySchema,
  description: z.string(),
});

export const fixPolicySchema = z.object({
  strategy: fixStrategySchema,
  steps: z.array(fixStepSchema),
  risks: z.array(riskSchema),
  rollback: z.string().optional(),
});

export const evidenceTypeSchema = z.enum([
  'objective',
  'diff',
  'changed_file',
  'failure_log',
  'stack_trace',
  'coverage',
  'runtime_signal',
  'experience_goal',
  'budget_violation',
  'budget_exemption',
  'project_metadata',
  'focused_test_focus',
]);

export const evidenceSchema = z.object({
  id: z.string(),
  type: evidenceTypeSchema,
  file: z.string().optional(),
  detail: z.string(),
});

export const planResponseSchema = z.object({
  // Stamped by the HTTP layer only when persistence is enabled (Phase 5);
  // absent responses stay byte-identical to stateless behavior
  // (spec/data/core-schema.md "PlanResponse").
  planId: z.string().optional(),
  createdAt: z.string().optional(),
  summary: z.string(),
  testPlan: testPlanSchema,
  fixPolicy: fixPolicySchema,
  evidence: z.array(evidenceSchema),
});

export type ObjectiveKind = z.infer<typeof objectiveKindSchema>;
export type Objective = z.infer<typeof objectiveSchema>;
export type ProjectDomain = z.infer<typeof projectDomainSchema>;
export type ProjectContext = z.infer<typeof projectContextSchema>;
export type ChangeSignal = z.infer<typeof changeSignalSchema>;
export type FailureSignal = z.infer<typeof failureSignalSchema>;
export type CoverageSignal = z.infer<typeof coverageSignalSchema>;
export type RuntimeSignal = z.infer<typeof runtimeSignalSchema>;
export type ExperienceQuality = z.infer<typeof experienceQualitySchema>;
export type ExperienceTarget = z.infer<typeof experienceTargetSchema>;
export type ExperienceExemption = z.infer<typeof experienceExemptionSchema>;
export type ExperienceGoal = z.infer<typeof experienceGoalSchema>;
export type PlanningConstraint = z.infer<typeof planningConstraintSchema>;
export type FocusedTestingRisk = z.infer<typeof focusedTestingRiskSchema>;
export type FocusedVariable = z.infer<typeof focusedVariableSchema>;
export type FocusedTarget = z.infer<typeof focusedTargetSchema>;
export type FocusedDomain = z.infer<typeof focusedDomainSchema>;
export type FocusedTesting = z.infer<typeof focusedTestingSchema>;
export type CreatePlanRequest = z.infer<typeof createPlanRequestSchema>;
export type TestDraft = z.infer<typeof testDraftSchema>;
export type TestKind = z.infer<typeof testKindSchema>;
export type Priority = z.infer<typeof prioritySchema>;
export type TestSuggestion = z.infer<typeof testSuggestionSchema>;
export type TestPlan = z.infer<typeof testPlanSchema>;
export type FixStrategy = z.infer<typeof fixStrategySchema>;
export type FixStep = z.infer<typeof fixStepSchema>;
export type Risk = z.infer<typeof riskSchema>;
export type FixPolicy = z.infer<typeof fixPolicySchema>;
export type EvidenceType = z.infer<typeof evidenceTypeSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type PlanResponse = z.infer<typeof planResponseSchema>;
