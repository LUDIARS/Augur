// C-1: a report must preserve actual evidence facts without inventing a section.
type Run = { readonly evidence?: readonly unknown[]; readonly unresolvedUxRefs?: readonly string[] };
type Report = Run & { readonly evidence?: readonly unknown[]; readonly unresolvedUxRefs?: readonly string[] };

export default {
  post: (result: Report, run: Run): true | string => {
    if (run.evidence === undefined && run.unresolvedUxRefs === undefined
      && (result.evidence !== undefined || result.unresolvedUxRefs !== undefined)) {
      return 'report must omit absent evidence facts';
    }
    if (run.evidence !== undefined && result.evidence?.length !== run.evidence.length) {
      return 'report must preserve evidence count';
    }
    if (run.unresolvedUxRefs !== undefined && result.unresolvedUxRefs?.length !== run.unresolvedUxRefs.length) {
      return 'report must preserve unresolved ux references';
    }
    return true;
  },
};
