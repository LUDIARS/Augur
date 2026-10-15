// Align an injected relative specifier with the importing file's own
// convention. A manifest names predicate modules by their source path
// (`x.contract.ts`), but a NodeNext/ESM project without
// allowImportingTsExtensions must import them as `.js`; writing `.ts` there
// breaks tsc (TS5097) and leaves a dangling import in the emitted JS.
// Pure — the caller supplies the file text.

import ts from 'typescript';

const TS_TO_JS: ReadonlyArray<readonly [string, string]> = [
  ['.d.ts', '.d.ts'],
  ['.tsx', '.js'],
  ['.mts', '.mjs'],
  ['.cts', '.cjs'],
  ['.ts', '.js'],
];

const TS_SOURCE = /\.(?:[mc]?ts|tsx)$/;
const JS_RUNTIME = /\.(?:[mc]?js|jsx)$/;

export type ImportExtensionStyle = 'ts' | 'js' | 'unknown';

/** How the file's existing relative imports spell their extensions. */
export function relativeImportStyle(relPath: string, text: string): ImportExtensionStyle {
  const sf = ts.createSourceFile(relPath, text, ts.ScriptTarget.Latest, false);
  let tsCount = 0;
  let jsCount = 0;
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier;
    if (specifier === undefined || !ts.isStringLiteral(specifier)) continue;
    const value = specifier.text;
    if (!value.startsWith('./') && !value.startsWith('../')) continue;
    if (TS_SOURCE.test(value) && !value.endsWith('.d.ts')) tsCount += 1;
    else if (JS_RUNTIME.test(value)) jsCount += 1;
  }
  if (jsCount > 0 && tsCount === 0) return 'js';
  if (tsCount > 0 && jsCount === 0) return 'ts';
  return 'unknown';
}

/** Rewrite a TypeScript source extension to its emitted runtime extension. */
export function toRuntimeSpecifier(specifier: string): string {
  for (const [from, to] of TS_TO_JS) {
    if (specifier.endsWith(from)) return `${specifier.slice(0, -from.length)}${to}`;
  }
  return specifier;
}

/**
 * Specifier to write into `text`: when the file already imports its relative
 * siblings as `.js`, a `.ts` predicate module is imported the same way. With
 * `.ts` imports or no evidence, the manifest's spelling is kept.
 */
export function alignSpecifierExtension(relPath: string, text: string, specifier: string): string {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return specifier;
  return relativeImportStyle(relPath, text) === 'js' ? toRuntimeSpecifier(specifier) : specifier;
}
