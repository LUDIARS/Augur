import { resolveModel } from '@ludiars/one-shot';

export default {
  post: (result: readonly string[], model: string, prefixArgs: readonly string[]): true | string => {
    const expected = [...prefixArgs, '-p', '--model', resolveModel(model, 'claude'), '--output-format', 'json'];
    return (result.length === expected.length && expected.every((arg, index) => result[index] === arg))
      || 'Claude arguments must preserve the prefix and use the resolved model';
  },
};
