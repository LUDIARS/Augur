// Contract for renderContractRuntime (spec/tasks/2026-10-13-contract-runtime-template.md, C-RT-2).
// The generated copy must start with the version/hash header and end with the
// template body, so `runtime check` can verify it without Augur's history.

export default {
  post: (result: string, template: string): true | string => {
    if (!/^\/\/ augur-contract-runtime version=\d+ sha256=[0-9a-f]{64}\n/.test(result)) return 'header missing';
    return result.endsWith(template.replace(/\r\n/g, '\n')) || 'body must be the template';
  },
};
