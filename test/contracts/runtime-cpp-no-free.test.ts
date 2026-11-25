// contract-runtime.hpp must not manage memory by hand: Anatomia's C++ code checks block `free`
// (memory/c-allocation) in every project the runtime is synced into (Portus #4234, 2026-11-25).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const TEMPLATE = readFileSync(resolve(import.meta.dirname, '..', '..', 'templates', 'contract-runtime', 'contract-runtime.hpp'), 'utf8');
const code = TEMPLATE.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');

describe('C++ contract runtime environment reads', () => {
  it('copies getenv at once and never calls free or _dupenv_s', () => {
    expect(code).not.toMatch(/\bfree\s*\(/);
    expect(code).not.toMatch(/_dupenv_s/);
    expect(code).toMatch(/std::getenv\(name\)/);
  });
});
