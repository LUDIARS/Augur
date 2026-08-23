import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { testPlanSchema, type TestPlan } from './types.ts';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const storedTestPlanSchema = z.object({
  kind: z.literal('test-plan'),
  planId: z.string().startsWith('plan_'),
  createdAt: z.string().datetime(),
  repoPath: z.string().min(1),
  plan: testPlanSchema,
}).strict();

export type StoredTestPlan = z.infer<typeof storedTestPlanSchema>;

export interface PlanStore {
  save(plan: Omit<TestPlan, 'planId'>, repoPath: string): TestPlan;
  put(record: StoredTestPlan): void;
  get(planId: string): StoredTestPlan | undefined;
}

export class FilePlanStore implements PlanStore {
  private readonly dataDir: string;
  private readonly now: () => Date;
  private readonly idFactory: (at: Date) => string;

  constructor(
    dataDir: string,
    now: () => Date = () => new Date(),
    idFactory: (at: Date) => string = createPlanId,
  ) {
    this.dataDir = dataDir;
    this.now = now;
    this.idFactory = idFactory;
  }

  save(plan: Omit<TestPlan, 'planId'>, repoPath: string): TestPlan {
    const at = this.now();
    const stamped = testPlanSchema.parse({ ...plan, planId: this.idFactory(at) });
    this.put({
      kind: 'test-plan',
      planId: stamped.planId,
      createdAt: at.toISOString(),
      repoPath: resolve(repoPath),
      plan: stamped,
    });
    return stamped;
  }

  put(record: StoredTestPlan): void {
    const parsed = storedTestPlanSchema.parse(record);
    const directory = join(resolve(this.dataDir), 'test-plans');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, `${safePlanId(parsed.planId)}.json`), `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  }

  get(planId: string): StoredTestPlan | undefined {
    if (!isPlanId(planId)) return undefined;
    const id = safePlanId(planId);
    const candidates = [
      join(resolve(this.dataDir), 'test-plans', `${id}.json`),
      join(resolve(this.dataDir), 'plans', `${id}.json`),
    ];
    for (const path of candidates) {
      if (!existsSync(path)) continue;
      const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
      const legacy = unwrapLegacy(raw);
      return storedTestPlanSchema.parse(legacy);
    }
    return undefined;
  }
}

export function createPlanId(at = new Date()): string {
  const timestamp = BigInt(at.getTime());
  const random = BigInt(`0x${randomBytes(10).toString('hex')}`);
  return `plan_${encodeCrockford(timestamp, 10)}${encodeCrockford(random, 16)}`;
}

function encodeCrockford(input: bigint, length: number): string {
  let value = input;
  let output = '';
  for (let index = 0; index < length; index += 1) {
    output = CROCKFORD[Number(value & 31n)] + output;
    value >>= 5n;
  }
  return output;
}

function safePlanId(planId: string): string {
  if (!isPlanId(planId)) throw new Error(`invalid test plan id: ${planId}`);
  return planId;
}

function isPlanId(planId: string): boolean {
  return /^plan_[0-9A-HJKMNP-TV-Z]{26}$/i.test(planId);
}

function unwrapLegacy(raw: unknown): unknown {
  if (isRecord(raw) && raw.kind === 'test-plan' && isRecord(raw.plan)) return raw;
  const plan = isRecord(raw) && isRecord(raw.response) ? raw.response : raw;
  if (!isRecord(plan) || typeof plan.planId !== 'string') return raw;
  return {
    kind: 'test-plan',
    planId: plan.planId,
    createdAt: isRecord(raw) && typeof raw.createdAt === 'string' ? raw.createdAt : new Date(0).toISOString(),
    repoPath: isRecord(raw) && typeof raw.repoPath === 'string' ? raw.repoPath : '.',
    plan,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
