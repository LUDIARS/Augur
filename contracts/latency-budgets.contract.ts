// Contract for mergeLatencyBudgets (C-LG-2). The default budget is always
// present; every Elegantia antipattern with an `augur` budget is linked to
// exactly one budget group; an unreachable Elegantia yields the default only.

type Group = { readonly key: string; readonly elegantiaRefs: readonly string[] };
type Source =
  | { readonly status: 'ok'; readonly items: ReadonlyArray<{ readonly id: string; readonly augur?: unknown }> }
  | { readonly status: string };

export default {
  post: (result: readonly Group[], source: Source): true | string => {
    if (!result.some((group) => group.key === 'api_latency:p95:<=1000ms:*')) return 'default budget group missing';
    if (source.status !== 'ok' || !('items' in source)) {
      return (result.length === 1 && result[0]!.elegantiaRefs.length === 0) || 'unreachable Elegantia must yield the default budget only';
    }
    for (const item of source.items) {
      if (item.augur === null || item.augur === undefined) continue;
      const linked = result.filter((group) => group.elegantiaRefs.includes(item.id)).length;
      if (linked !== 1) return `${item.id} must be linked to exactly one budget group (found ${linked})`;
    }
    return true;
  },
};
