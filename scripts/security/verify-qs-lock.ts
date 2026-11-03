import { isDeepStrictEqual } from 'node:util';
import { contract } from '../../templates/contract-runtime/contract-runtime.ts'; /* augur-inject:import:93a59624 */
import augurContract_56ba93d2 from '../../contracts/qs-lock.contract.ts'; /* augur-inject:contract-predicate:b3dd597a */

// Validate the release-only lock delta without resolving or executing dependencies.
export function verifyQsLock(candidate: string, baseline: string): boolean {
  const expected = JSON.parse(baseline);
  const actual = JSON.parse(candidate);
  const entry = expected.packages['node_modules/qs'];
  if (entry.version !== '6.16.0') throw new Error('expected qs 6.16.0 baseline');
  entry.version = '6.16.2';
  entry.resolved = 'https://registry.npmjs.org/qs/-/qs-6.16.2.tgz';
  entry.integrity = 'sha512-VYdnB5S7/0IeXzBacUtwNAaM6d7Y/PgYnNC7bJCI6meqA/OgnsQbZMtVW8Dt2D1PHgbHGtYmhSoEIgvt7xZ2ZA==';
  return isDeepStrictEqual(actual, expected);
}
// @ts-expect-error augur-inject
verifyQsLock = contract(verifyQsLock, { ...augurContract_56ba93d2, contractId: 'C-3', mode: 'observe', sample: 1, where: 'scripts/security/verify-qs-lock.ts:4', rule: 'contract-wrap', id: '56ba93d2' }); /* augur-inject:contract-wrap:56ba93d2 */
