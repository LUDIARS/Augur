import { describe, expect, it } from 'vitest';
import {
  alignSpecifierExtension,
  relativeImportStyle,
  toRuntimeSpecifier,
} from '../../../src/inject/import-extension.ts';

const FILE = 'src/delegation/status-report-policy.ts';

describe('relativeImportStyle', () => {
  it('reads .js relative imports as the js style', () => {
    const text = "import { a } from './a.js';\nexport { b } from '../b.js';\nimport x from 'pkg';\n";
    expect(relativeImportStyle(FILE, text)).toBe('js');
  });

  it('reads .ts relative imports as the ts style', () => {
    expect(relativeImportStyle(FILE, "import { a } from './a.ts';\n")).toBe('ts');
  });

  it('is unknown without relative imports or with mixed spellings', () => {
    expect(relativeImportStyle(FILE, "import x from 'pkg';\n")).toBe('unknown');
    expect(relativeImportStyle(FILE, "import a from './a.js';\nimport b from './b.ts';\n")).toBe('unknown');
  });
});

describe('toRuntimeSpecifier', () => {
  it('maps TypeScript source extensions to their emitted extensions', () => {
    expect(toRuntimeSpecifier('./c.contract.ts')).toBe('./c.contract.js');
    expect(toRuntimeSpecifier('./c.contract.mts')).toBe('./c.contract.mjs');
    expect(toRuntimeSpecifier('./c.contract.cts')).toBe('./c.contract.cjs');
    expect(toRuntimeSpecifier('./c.contract.tsx')).toBe('./c.contract.js');
    expect(toRuntimeSpecifier('./c.contract.js')).toBe('./c.contract.js');
  });
});

describe('alignSpecifierExtension', () => {
  it('imports a .ts predicate module as .js when the file uses .js imports (TS5097 regression)', () => {
    const text = "import { policy } from './policy.js';\nexport const f = () => policy;\n";
    expect(alignSpecifierExtension(FILE, text, '../../contracts/C-1.contract.ts')).toBe(
      '../../contracts/C-1.contract.js',
    );
  });

  it('keeps the manifest spelling when the file uses .ts imports', () => {
    const text = "import { helper } from './helper.ts';\n";
    expect(alignSpecifierExtension(FILE, text, '../../contracts/C-1.contract.ts')).toBe(
      '../../contracts/C-1.contract.ts',
    );
  });

  it('keeps the manifest spelling without evidence', () => {
    expect(alignSpecifierExtension(FILE, 'export const f = 1;\n', './C-1.contract.ts')).toBe('./C-1.contract.ts');
  });
});
