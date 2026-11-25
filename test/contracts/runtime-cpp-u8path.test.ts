// contract-runtime.hpp must not call std::filesystem::u8path unconditionally: it is deprecated in
// C++20 and MSVC's STL4021 stops builds that treat warnings as errors (Actio #4231, 2026-11-25).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const TEMPLATE = readFileSync(resolve(import.meta.dirname, '..', '..', 'templates', 'contract-runtime', 'contract-runtime.hpp'), 'utf8');

describe('C++ contract runtime path construction', () => {
  it('builds the log directory through utf8_path, using u8path only before char8_t exists', () => {
    expect(TEMPLATE).toMatch(/utf8_path\(\*configured\)/);
    const uses = TEMPLATE.split('\n').filter((line) => /u8path\(/.test(line) && !/^\s*\/\//.test(line));
    expect(uses).toEqual(['  return std::filesystem::u8path(text);']);
    const guarded = TEMPLATE.slice(TEMPLATE.indexOf('#if defined(__cpp_char8_t)'), TEMPLATE.indexOf('#endif', TEMPLATE.indexOf('#if defined(__cpp_char8_t)')));
    expect(guarded).toContain('#else\n  return std::filesystem::u8path(text);');
  });
});
