type Candidate = { readonly contract?: { readonly sample: number } };

export default {
  post: (fragment: string, candidate: Candidate): true | string => {
    const sample = candidate.contract?.sample;
    const spec = /::augur::ContractSpec\{((?:"(?:[^"\\]|\\.)*", ){2}"(?:[^"\\]|\\.)*")(.*?)\},/.exec(fragment);
    const expected = sample === 1 ? '' : `, ${sample}`;
    return spec?.[2] === expected || 'C++ contract spec must preserve the configured sampling rate';
  },
};
