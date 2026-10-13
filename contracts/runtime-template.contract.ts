// Contract for inspectContractRuntime (spec/tasks/2026-10-13-contract-runtime-template.md, C-RT-1).
// A copy is `current` only when the rendered template reads back unchanged; the
// predicate checks that a `current` verdict always carries a well-formed hash.

type Inspection = { readonly state: string; readonly sha256?: string };

export default {
  post: (result: Inspection, existing: string | undefined): true | string => {
    if (existing === undefined) return result.state === 'missing' || 'an absent copy must be missing';
    if (result.state === 'current' && !/^[0-9a-f]{64}$/.test(result.sha256 ?? '')) return 'a current copy must carry its sha256';
    return true;
  },
};
