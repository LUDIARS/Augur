// augur.inject.json / fleet file schemas (spec/feature/log-injection.md).

import { z } from 'zod';
import { INJECT_RULES } from './types.ts';

export const injectManifestSchema = z
  .object({
    service: z.string().min(1),
    include: z.array(z.string().min(1)).default(['src/**/*.ts']),
    exclude: z.array(z.string().min(1)).default([]),
    runtime: z
      .object({
        autoImport: z.boolean().default(true),
        entrypoints: z.array(z.string().min(1)).default([]),
      })
      .default({}),
    rules: z.record(z.enum(INJECT_RULES), z.boolean()).default({}),
    importFrom: z.string().min(1).default('@ludiars/log-weaver'),
  })
  .strict();

export type InjectManifest = z.infer<typeof injectManifestSchema>;

export const fleetSchema = z.object({ projects: z.array(z.string().min(1)).min(1) }).strict();

export type Fleet = z.infer<typeof fleetSchema>;

export function parseManifest(json: unknown): InjectManifest {
  return injectManifestSchema.parse(json);
}

/** Rules default to on; the manifest only records explicit toggles. */
export function ruleEnabled(manifest: InjectManifest, rule: (typeof INJECT_RULES)[number]): boolean {
  return manifest.rules[rule] ?? true;
}
