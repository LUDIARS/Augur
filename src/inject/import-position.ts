// Where a marker-tagged import line goes in a file. Shared by the runtime-symbol
// import (apply.ts) and the per-contract predicate imports (contract-apply.ts)
// so both land in the same place: after the file's last import, or after the
// shebang when the file has none.

import ts from 'typescript';

export type ImportAnchor = {
  /** End offset of the last import declaration, or null when there is none. */
  readonly lastImportEnd: number | null;
  readonly shebangEnd: number;
};

export function importAnchor(sf: ts.SourceFile, text: string): ImportAnchor {
  let lastImportEnd: number | null = null;
  for (const statement of sf.statements) {
    if (ts.isImportDeclaration(statement)) lastImportEnd = statement.end;
  }
  return { lastImportEnd, shebangEnd: text.startsWith('#!') ? text.indexOf('\n') + 1 : 0 };
}
