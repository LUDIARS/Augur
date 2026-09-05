import type { InjectRule } from './types.ts';

/** Runtime export required by each rule that uses a named import. */
export const RUNTIME_SYMBOL_BY_RULE: Partial<Record<InjectRule, string>> = {
  'silent-catch': 'weaverLog',
  'spawn-watch': 'watchChild',
  'interval-guard': 'guardAsync',
  'listener-guard': 'guardAsync',
  'contract-wrap': 'contract',
};
