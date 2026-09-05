// augur.contracts.json schema (spec/plan/2026-09-05-live-contract-testing.md §3.1).
// The file names which functions carry a contract and where their predicate
// module lives; it holds no predicate logic itself (§3.2 keeps predicates in
// the target repo's TypeScript so they stay typed and testable).

import { z } from 'zod';
import { isRepoRelativePath } from './paths.ts';

export const CONTRACTS_MANIFEST_NAME = 'augur.contracts.json';

export const contractModeSchema = z.enum(['observe', 'enforce']);

export type ContractMode = z.infer<typeof contractModeSchema>;

const repoPathSchema = z.string().min(1).refine(isRepoRelativePath, {
  message: 'must be a repository-relative path contained by the project',
});

export const contractEntrySchema = z
  .object({
    /** Contract id; the first token of Concordia's `acceptance_report[].criterion`. */
    id: z.string().min(1),
    /** The acceptance criterion in full, reproduced byte-for-byte in reports. */
    criterion: z.string().min(1),
    /** `fn` or `Class.method` — the same granularity as an Anatomia anchor. */
    symbol: z.string().min(1),
    /** Repository-relative path of the file declaring `symbol`. */
    file: repoPathSchema,
    /** Repository-relative path of the predicate module (§3.2). */
    module: repoPathSchema,
    mode: contractModeSchema.default('observe'),
    sample: z.number().min(0).max(1).default(1),
  })
  .strict();

export type ContractEntry = z.infer<typeof contractEntrySchema>;

// Duplicate ids are rejected at parse time rather than by `contracts lint`:
// every downstream consumer (injection marker ids, report aggregation) keys on
// the id, so a manifest that carries two of them has no single correct reading.
export const contractsManifestSchema = z
  .object({
    version: z.literal(1),
    contractsDir: repoPathSchema.default('contracts'),
    importFrom: z.string().min(1).default('@ludiars/log-weaver'),
    contracts: z.array(contractEntrySchema).default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.contracts.forEach((entry, index) => {
      if (seen.has(entry.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['contracts', index, 'id'],
          message: `duplicate contract id '${entry.id}'`,
        });
      }
      seen.add(entry.id);
    });
  });

export type ContractsManifest = z.infer<typeof contractsManifestSchema>;

export function parseContractsManifest(json: unknown): ContractsManifest {
  return contractsManifestSchema.parse(json);
}
