import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPlan } from '../src/engine/createPlan.ts';

// Regenerates golden expectations. Explicit by design — never run
// automatically (spec/implementation-design.md, "Test Implementation Notes").

const casesDir = new URL('../test/golden/cases', import.meta.url).pathname;

for (const name of readdirSync(casesDir).filter((file) => file.endsWith('.json')).sort()) {
  const path = join(casesDir, name);
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { request: unknown };
  const expected = createPlan(parsed.request as Parameters<typeof createPlan>[0]);
  writeFileSync(path, `${JSON.stringify({ request: parsed.request, expected }, null, 2)}\n`);
  console.log(`updated ${name}`);
}
