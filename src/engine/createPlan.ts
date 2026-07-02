import { createPlanRequestSchema, type CreatePlanRequest, type PlanResponse } from '../schema/index.ts';
import { assemble } from './assemble.ts';
import { extractEvidence } from './evidence.ts';
import { experienceGuardrails } from './experienceSuggestions.ts';
import { normalize } from './normalize.ts';
import { ruleRegistry } from './rules/index.ts';
import { scoreAndRank } from './scoring.ts';
import type { PlanOptions } from './types.ts';

// The engine entry point: a pure, synchronous function. All IO (HTTP
// parsing, LLM calls, file reads) happens outside it
// (spec/implementation-design.md, "The engine entry point").

export function createPlan(input: CreatePlanRequest, options: PlanOptions = {}): PlanResponse {
  // Stage 1: validate. Structurally invalid requests throw a ZodError that
  // the HTTP layer maps to the documented 400 envelope.
  const request = createPlanRequestSchema.parse(input);

  // Stage 2: normalize signals into facts (includes budget resolution).
  const facts = normalize(request, options);

  // Stage 3: extract evidence with stable ids.
  const evidence = extractEvidence(facts);

  // Stage 4: apply the objective's rule module, plus budget guardrails
  // that accompany any objective kind.
  const rule = ruleRegistry[facts.objective.kind];
  const { suggestions: ruleSuggestions, fixSkeleton } = rule.plan(facts, evidence);
  const guardrails = experienceGuardrails(facts, evidence);

  // Stage 5: score and rank.
  const ranked = scoreAndRank([...guardrails, ...ruleSuggestions], facts, evidence);

  // Stage 6: assemble the response.
  return assemble(facts, evidence, ranked, fixSkeleton);
}

export type { PlanOptions } from './types.ts';
