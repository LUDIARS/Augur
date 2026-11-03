import { isDeepStrictEqual } from 'node:util';

// Independent acceptance predicate for the dependency-only update.
export default {
  post: (result: boolean, candidate: string, baseline: string): true | string => {
    const expected = JSON.parse(baseline);
    const qs = expected.packages['node_modules/qs'];
    qs.version = '6.16.2';
    qs.resolved = 'https://registry.npmjs.org/qs/-/qs-6.16.2.tgz';
    qs.integrity = 'sha512-VYdnB5S7/0IeXzBacUtwNAaM6d7Y/PgYnNC7bJCI6meqA/OgnsQbZMtVW8Dt2D1PHgbHGtYmhSoEIgvt7xZ2ZA==';
    return result === isDeepStrictEqual(JSON.parse(candidate), expected)
      || 'only the three qs release fields may change';
  },
};
