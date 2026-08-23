import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';

export const busConfigSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('local'), env: z.array(z.string()).default([]) }).strict(),
  z.object({
    type: z.literal('wrapper'),
    command: z.array(z.string()).min(1),
    env: z.array(z.string()).default([]),
  }).strict(),
]);

export const runnerConfigSchema = z.object({
  command: z.array(z.string()).min(1).optional(),
  selectorFlag: z.string().optional(),
  reporter: z.string().optional(),
}).passthrough();

const quotaEntrySchema = z.object({
  max: z.number().int().positive().optional(),
  priority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
}).strict();

export const testsConfigSchema = z.object({
  version: z.literal(1).default(1),
  repository: z.string().min(1),
  defaultBus: z.string().min(1).default('local'),
  buses: z.record(busConfigSchema).default({}),
  runners: z.record(runnerConfigSchema).default({}),
  quota: z.object({
    default: z.object({ max: z.number().int().positive().default(12) }).default({}),
    byPriority: z.object({
      critical: z.number().int().positive().default(24),
      high: z.number().int().positive().default(16),
      medium: z.number().int().positive().default(10),
      low: z.number().int().positive().default(6),
    }).default({}),
    domains: z.record(quotaEntrySchema).default({}),
  }).default({}),
  retirement: z.object({
    probationAfterDays: z.number().nonnegative().default(90),
    probationAfterPasses: z.number().int().nonnegative().default(30),
    retireAfterDays: z.number().nonnegative().default(180),
    incidentHorizonDays: z.number().nonnegative().default(365),
    exemptKinds: z.array(z.enum(['regression', 'assurance', 'guardrail'])).default(['guardrail']),
    exemptAlways: z.boolean().default(true),
  }).default({}),
  impact: z.object({ callerDepth: z.number().int().nonnegative().default(2) }).default({}),
  layout: z.object({ newTestPath: z.string().optional() }).default({}),
  timeoutMs: z.number().int().positive().default(600_000),
}).strict();

export type BusConfig = z.infer<typeof busConfigSchema>;
export type RunnerConfig = z.infer<typeof runnerConfigSchema>;
export type TestsConfig = z.infer<typeof testsConfigSchema>;

export function loadTestsConfig(repoPath: string): TestsConfig {
  const path = join(resolve(repoPath), '.augur', 'tests.config.json');
  if (!existsSync(path)) throw new Error(`test configuration not found: ${path}`);
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  return testsConfigSchema.parse(raw);
}

export function quotaForDomain(config: TestsConfig, domain: string): number {
  const entry = config.quota.domains[domain];
  if (entry?.max !== undefined) return entry.max;
  if (entry?.priority !== undefined) return config.quota.byPriority[entry.priority];
  return config.quota.default.max;
}
