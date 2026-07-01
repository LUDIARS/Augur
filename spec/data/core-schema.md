# Core Data Schema

Augur does not require a database for the MVP.

This document defines the durable data shapes exchanged through APIs, CLIs, reports, and future storage. If persistence is added later, these schemas should be treated as the source of truth for stored records.

## CreatePlanRequest

```ts
type CreatePlanRequest = {
  objective: Objective;
  project?: ProjectContext;
  change?: ChangeSignal;
  failure?: FailureSignal;
  coverage?: CoverageSignal;
  runtimeSignals?: RuntimeSignal[];
  constraints?: PlanningConstraint[];
};
```

## Objective

The objective tells Augur why the caller is asking for guidance.

```ts
type Objective = {
  kind:
    | "new_feature"
    | "bug_fix"
    | "regression"
    | "refactor"
    | "performance"
    | "stability"
    | "security"
    | "unknown";
  description: string;
  desiredOutcome?: string;
};
```

## ProjectContext

```ts
type ProjectContext = {
  name?: string;
  language?: string;
  frameworks?: string[];
  testRunners?: string[];
  packageManager?: string;
};
```

## Signals

```ts
type ChangeSignal = {
  diff?: string;
  changedFiles?: string[];
};

type FailureSignal = {
  command?: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  stackTrace?: string;
};

type CoverageSignal = {
  format: "lcov" | "json" | "text" | "unknown";
  content: string;
};

type RuntimeSignal = {
  type: "web_response" | "api_latency" | "memory" | "cpu" | "custom";
  name: string;
  value: number;
  unit: string;
  source?: string;
};
```

## PlanResponse

```ts
type PlanResponse = {
  summary: string;
  testPlan: TestPlan;
  fixPolicy: FixPolicy;
  evidence: Evidence[];
};
```

## TestPlan

```ts
type TestPlan = {
  suggestions: TestSuggestion[];
};

type TestSuggestion = {
  id: string;
  title: string;
  kind:
    | "unit"
    | "integration"
    | "contract"
    | "e2e"
    | "performance"
    | "regression"
    | "flaky";
  priority: "critical" | "high" | "medium" | "low";
  confidence: number;
  targetFiles?: string[];
  rationale: string;
  draft: TestDraft;
  evidenceIds: string[];
};
```

## FixPolicy

```ts
type FixPolicy = {
  strategy: "minimal" | "behavior_preserving" | "contract_first" | "test_first" | "investigate_first";
  steps: FixStep[];
  risks: Risk[];
  rollback?: string;
};

type FixStep = {
  id: string;
  title: string;
  description: string;
  targetFiles?: string[];
  dependsOn?: string[];
};
```

## Shared Types

```ts
type TestDraft = {
  framework?: string;
  description: string;
  outline?: string[];
};

type Evidence = {
  id: string;
  type:
    | "objective"
    | "diff"
    | "changed_file"
    | "failure_log"
    | "stack_trace"
    | "coverage"
    | "runtime_signal"
    | "project_metadata";
  file?: string;
  detail: string;
};

type Risk = {
  id: string;
  severity: "critical" | "high" | "medium" | "low";
  description: string;
};

type PlanningConstraint = {
  type: "runner" | "framework" | "scope" | "time" | "policy" | "custom";
  value: string;
};
```

