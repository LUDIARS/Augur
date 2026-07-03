import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createPlan } from '../../src/engine/createPlan.ts';
import { planResponseSchema, type CreatePlanRequest, type PlanResponse } from '../../src/schema/index.ts';

// Golden tests per spec/test/service-test-strategy.md: stable output for
// representative requests, regenerated only via `npm run golden:update`.

const casesDir = fileURLToPath(new URL('./cases', import.meta.url));
const caseFiles = readdirSync(casesDir)
  .filter((file) => file.endsWith('.json'))
  .sort();

describe('golden cases', () => {
  it('has the representative case set', () => {
    expect(caseFiles.length).toBeGreaterThanOrEqual(10);
  });

  for (const file of caseFiles) {
    it(file, () => {
      const parsed = JSON.parse(readFileSync(join(casesDir, file), 'utf8')) as {
        request: CreatePlanRequest;
        expected: PlanResponse;
      };
      expect(parsed.expected, `${file} has no expected output; run npm run golden:update`).toBeDefined();
      const actual = createPlan(parsed.request);
      expect(actual).toEqual(parsed.expected);
      // The stored expectation must itself be schema-valid.
      planResponseSchema.parse(parsed.expected);
    });
  }
});
