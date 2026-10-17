// Contract for judgeProbe (C-LG-4): a probe fails exactly when its p95 exceeds
// the threshold; a p95 equal to the threshold passes.

type Verdict = { readonly status: 'passed' | 'failed'; readonly p95Ms: number };

export default {
  post: (result: Verdict, _samples: readonly number[], thresholdMs: number): true | string => (
    result.status === (result.p95Ms > thresholdMs ? 'failed' : 'passed')
    || `status ${result.status} contradicts p95 ${result.p95Ms}ms against ${thresholdMs}ms`
  ),
};
