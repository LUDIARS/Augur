// C++ syntax for contracts (SPEC-CONTRACT-CPP-INJECT).
//
// tree-sitter-cpp through web-tree-sitter (WASM, no native build). Loading the
// grammar is asynchronous, but the contract scanner, lint and injector are
// synchronous `(path, text) -> data` functions, so the CLI prepares the parser
// once up front and the pure layer parses synchronously afterwards. Parsing a
// C++ file before preparation is an error, never a silent "unresolved".

import { createRequire } from 'node:module';
import { Language, Parser } from 'web-tree-sitter';
import type { Tree } from 'web-tree-sitter';

const require = createRequire(import.meta.url);

/** Sources and headers whose contracts go through the C++ path. */
const CPP_PATH = /\.(?:cc|cpp|cxx|c\+\+|h|hh|hpp|hxx|h\+\+|inl|ipp)$/i;
/** Headers a runtime include may name. */
const HEADER_PATH = /\.(?:h|hh|hpp|hxx|h\+\+)$/i;

let parser: Parser | null = null;
let preparing: Promise<void> | null = null;

export function isCppPath(path: string): boolean {
  return CPP_PATH.test(path);
}

export function isHeaderPath(path: string): boolean {
  return HEADER_PATH.test(path);
}

/** Load the tree-sitter runtime and the C++ grammar once per process. */
export function prepareCppParser(): Promise<void> {
  preparing ??= (async () => {
    await Parser.init({
      locateFile: (name: string) => require.resolve(`web-tree-sitter/${name}`),
    } as unknown as Parameters<typeof Parser.init>[0]);
    const language = await Language.load(require.resolve('tree-sitter-wasms/out/tree-sitter-cpp.wasm'));
    const ready = new Parser();
    ready.setLanguage(language);
    parser = ready;
  })();
  return preparing;
}

/**
 * Parse C++ text. The caller owns the tree and deletes it (it holds WASM memory).
 * @throws when prepareCppParser() has not completed
 */
export function parseCpp(text: string): Tree {
  if (parser === null) {
    throw new Error('C++ parser is not prepared: await prepareCppParser() before resolving C++ contracts');
  }
  const tree = parser.parse(text);
  if (tree === null) throw new Error('tree-sitter could not parse the C++ source');
  return tree;
}

/** Run `read` over a parsed tree and release the tree afterwards. */
export function withCppTree<T>(text: string, read: (tree: Tree) => T): T {
  const tree = parseCpp(text);
  try {
    return read(tree);
  } finally {
    tree.delete();
  }
}
