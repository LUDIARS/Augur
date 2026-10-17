// Contract for percentile (C-LG-3): nearest-rank percentile, so the result is
// an observed sample and at least ceil(p/100 * n) samples are <= the result.

export default {
  post: (result: number, samples: readonly number[], p: number): true | string => {
    if (!samples.includes(result)) return 'percentile must be an observed sample';
    const atOrBelow = samples.filter((sample) => sample <= result).length;
    return atOrBelow >= Math.ceil((p / 100) * samples.length) || 'too few samples at or below the percentile';
  },
};
