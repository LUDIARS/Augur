// Shape check for a C++ predicate header (SPEC-CONTRACT-CPP-INJECT) — the C++
// counterpart of a TypeScript module's `export default { pre, post }`.
//
// The header must declare exactly one predicate set:
//   inline const auto parse_input = augur::predicates(pre, post);
// (or `augur::pre_only(pre)` / `augur::post_only(post)`), at namespace scope.
// Its qualified name (`contracts::parse_input`) is what the injected wrapper
// passes to `augur::invoke_observed`. Pure: (source text) -> state and name.

import type { Node } from 'web-tree-sitter';
import { withCppTree } from './parser.ts';

const FACTORIES = new Set(['predicates', 'pre_only', 'post_only']);

export type CppPredicateShape =
  | { readonly state: 'ok'; readonly name: string }
  | { readonly state: 'invalid-default' };

function isFactoryCall(value: Node | null): boolean {
  if (value?.type !== 'call_expression') return false;
  const callee = value.childForFieldName('function');
  if (callee?.type !== 'qualified_identifier') return false;
  const parts = callee.text.replace(/^::/, '').split('::');
  return parts.length === 2 && parts[0] === 'augur' && FACTORIES.has(parts[1]!);
}

function namespacePath(node: Node): string[] {
  const path: string[] = [];
  for (let scope = node.parent; scope !== null; scope = scope.parent) {
    if (scope.type === 'namespace_definition') {
      const name = scope.childForFieldName('name')?.text;
      if (name !== undefined) path.unshift(name);
    }
    // A set declared inside a function or class is not reachable by the wrapper.
    if (scope.type === 'function_definition' || scope.type === 'field_declaration_list') return ['<unreachable>'];
  }
  return path;
}

export function classifyCppPredicate(text: string): CppPredicateShape {
  return withCppTree(text, (tree) => {
    const names: string[] = [];
    const stack: Node[] = [tree.rootNode];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node.type === 'init_declarator' && isFactoryCall(node.childForFieldName('value'))) {
        const name = node.childForFieldName('declarator');
        const path = namespacePath(node);
        if (name?.type === 'identifier' && !path.includes('<unreachable>')) names.push([...path, name.text].join('::'));
      }
      for (const child of node.namedChildren) if (child !== null) stack.push(child);
    }
    return names.length === 1 ? { state: 'ok', name: names[0]! } : { state: 'invalid-default' };
  });
}
