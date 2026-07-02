import type {
  CoverageSignal,
  Evidence,
  ExperienceExemption,
  ExperienceQuality,
  ExperienceTarget,
  FixStrategy,
  Objective,
  PlanningConstraint,
  Priority,
  RuntimeSignal,
  TestDraft,
  TestKind,
} from '../schema/index.ts';

// Rule modules read NormalizedFacts, never the raw request
// (spec/implementation-design.md, "Normalized facts").

export type FailureFact = {
  command?: string;
  exitCode?: number;
  stderr?: string;
  stdout?: string;
  stackTrace?: string;
  frames: string[]; // parsed "at ..." lines, best effort
};

export type ResolvedBudget = {
  quality: ExperienceQuality;
  target: ExperienceTarget;
  proposed: boolean; // filled from catalog defaults instead of caller input
  relaxed: boolean; // this is an exemption's relaxedTarget, not the strict budget
  exemption?: ExperienceExemption; // governing exemption, when any
  // An LLM-proposed exemption never removes a guardrail; it only downgrades
  // it with reasoning (spec/feature/experience-driven-constraints.md).
  downgradedByProposal?: ExperienceExemption;
  catalogRef?: { entryId: string; keyResultId: string };
  violations: RuntimeSignal[];
};

export type ExemptionConflict = {
  exemption: ExperienceExemption;
  target: ExperienceTarget; // the caller-explicit target the exemption tried to cover
};

export type NormalizedFacts = {
  objective: Objective;
  projectDomain?: 'web' | 'game' | 'service' | 'other';
  changedFiles: string[];
  hasDiff: boolean;
  failure: FailureFact | null;
  coverage: CoverageSignal | null;
  runtime: RuntimeSignal[];
  budgets: ResolvedBudget[];
  appliedExemptions: ExperienceExemption[];
  exemptionConflicts: ExemptionConflict[];
  unquantifiedCustomGoals: number;
  constraints: PlanningConstraint[];
  conflictingSignals: string[]; // human descriptions of contradictory inputs
  frameworks: string[];
  testRunners: string[];
};

export type EvidenceRefs = {
  list: Evidence[];
  objectiveId: string;
  projectId?: string;
  diffId?: string;
  changedFileIds: Map<string, string>;
  failureLogId?: string;
  stackTraceId?: string;
  coverageId?: string;
  runtimeIds: Map<RuntimeSignal, string>;
  budgetIds: Map<ResolvedBudget, string>;
  exemptionIds: Map<ExperienceExemption, string>;
  violationIds: Map<RuntimeSignal, string>;
};

export type CandidateSuggestion = {
  title: string;
  kind: TestKind;
  priority: Priority;
  confidence: number;
  targetFiles?: string[];
  rationale: string;
  draft: TestDraft;
  budget?: ExperienceTarget;
  proposedBudget?: boolean;
  evidenceIds: string[];
};

export type CandidateStep = {
  title: string;
  description: string;
  targetFiles?: string[];
  dependsOnPrevious?: boolean;
  evidenceIds: string[];
};

export type CandidateRisk = {
  severity: Priority;
  description: string;
};

export type FixPolicySkeleton = {
  strategy: FixStrategy;
  steps: CandidateStep[];
  risks: CandidateRisk[];
  rollback?: string;
};

export type RuleOutput = {
  suggestions: CandidateSuggestion[];
  fixSkeleton: FixPolicySkeleton;
};

export interface RuleModule {
  kind: Objective['kind'];
  plan(facts: NormalizedFacts, evidence: EvidenceRefs): RuleOutput;
}

export type PlanOptions = {
  // Phase 4: pre-computed LLM exemption proposals fed in from outside.
  // The engine itself never calls the network.
  proposedExemptions?: ExperienceExemption[];
};
