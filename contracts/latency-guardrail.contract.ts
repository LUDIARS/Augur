// Contract for latencyGuardrailCandidates (spec/feature/experience-driven-constraints.md
// "Default latency guardrail", C-LG-1). A Web/API service always gets the
// EG-C01 api_latency p95 <= 1000ms guardrail without caller-supplied goals; a
// service that is not Web/API gets none.

type Budget = { readonly metric: string; readonly threshold: number; readonly unit: string; readonly percentile?: number };
type Candidate = { readonly kind: string; readonly budget?: Budget };
type Input = { readonly detection: { readonly webApi: boolean }; readonly placement: unknown };

export default {
  post: (result: readonly Candidate[], input: Input): true | string => {
    if (!input.detection.webApi) return result.length === 0 || 'a non Web/API service must not get latency guardrails';
    if (input.placement === undefined) return result.length === 0 || 'an unplaced guardrail must not be emitted';
    return result.some((candidate) => candidate.kind === 'guardrail'
      && candidate.budget?.metric === 'api_latency'
      && candidate.budget.threshold === 1000
      && candidate.budget.unit === 'ms'
      && candidate.budget.percentile === 95)
      || 'the default EG-C01 api_latency p95 <= 1000ms guardrail is missing';
  },
};
