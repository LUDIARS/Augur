// Contract for toAcceptanceReport (spec/plan/2026-09-05-live-contract-testing.md §12, C3-2).
// `met` is a claim a delegation is judged on, so the predicate checks the one
// rule that makes it trustworthy: it tracks `covered` and nothing else.

type Summary = { readonly contracts: ReadonlyArray<{ readonly state: string }> };

type Item = { readonly met: boolean };

export default {
  post: (result: readonly Item[], summary: Summary): true | string => {
    if (result.length !== summary.contracts.length) return 'every contract must appear in the acceptance report';
    return result.every((item, index) => item.met === (summary.contracts[index]?.state === 'covered'))
      || 'met must be true only for covered contracts';
  },
};
