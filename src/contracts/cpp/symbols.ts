// Resolve a contract's `file:symbol` in a C++ source (SPEC-CONTRACT-CPP-INJECT).
// Pure: (source text, symbol) -> site | problem | null.
//
// Symbol forms, matching the manifest's TypeScript convention:
//   `fn`            a free function named fn (any namespace), unique in the file
//   `ns::fn`        a function whose scope path ends with ns::fn
//   `Class.method`  Class::method defined out of line, or inside Class's body
// Overloads make a name ambiguous; an ambiguous name resolves to nothing.

import type { Node } from 'web-tree-sitter';
import { withCppTree } from './parser.ts';

/** Where the injector edits a C++ definition. */
export type CppFunctionSite = {
  /** 1-based line of the definition. */
  readonly line: number;
  /** Offset just after the body's opening `{`. */
  readonly bodyOpen: number;
  /** Offset of the body's closing `}`. */
  readonly bodyClose: number;
  /** Return type as the wrapping lambda must spell it (`const std::string&`). */
  readonly returnType: string;
  /** Parameter names, in order, forwarded to the predicates. */
  readonly parameters: readonly string[];
};

/** A named function that exists but cannot be wrapped; reported as unresolved with the reason. */
export type CppUnsupported = { readonly unsupported: string };

export type CppResolution = CppFunctionSite | CppUnsupported | null;

const SCOPES = new Set(['namespace_definition', 'class_specifier', 'struct_specifier']);
const COROUTINE = /\bco_(?:await|yield|return)\b/;

function functionDeclarator(definition: Node): Node | null {
  let current: Node | null = definition.childForFieldName('declarator');
  while (current !== null && current.type !== 'function_declarator') {
    current = current.childForFieldName('declarator') ?? current.namedChildren.find((child) => child !== null) ?? null;
  }
  return current;
}

/** `ns::Class::name` path of a definition: enclosing scopes plus any written qualifier. */
function qualifiedPath(definition: Node, declarator: Node): string[] {
  const written = (declarator.childForFieldName('declarator')?.text ?? '').split('::').map((part) => part.trim());
  const enclosing: string[] = [];
  for (let scope = definition.parent; scope !== null; scope = scope.parent) {
    if (SCOPES.has(scope.type)) {
      const name = scope.childForFieldName('name')?.text;
      if (name !== undefined) enclosing.unshift(name);
    }
  }
  return [...enclosing, ...written.filter((part) => part !== '')];
}

function wantedPath(symbol: string): string[] {
  const dot = symbol.indexOf('.');
  if (dot > 0) return [...symbol.slice(0, dot).split('::'), symbol.slice(dot + 1)];
  return symbol.split('::');
}

function endsWith(path: readonly string[], suffix: readonly string[]): boolean {
  if (suffix.length > path.length) return false;
  return suffix.every((part, index) => path[path.length - suffix.length + index] === part);
}

/**
 * A definition written inside a class body is a member. An out-of-line
 * `A::f` could be a member or a namespaced free function — the syntax cannot
 * tell — so it may match either form, and the path decides.
 */
function matchesForm(definition: Node, member: boolean): boolean {
  return member || definition.parent?.type !== 'field_declaration_list';
}

function returnType(definition: Node, declarator: Node): string | CppUnsupported {
  const type = definition.childForFieldName('type');
  if (type === null) return { unsupported: 'constructors and destructors have no return value to observe' };
  const trailing = declarator.namedChildren.find((child) => child?.type === 'trailing_return_type');
  if (type.type === 'placeholder_type_specifier') {
    const spelled = trailing?.namedChildren[0]?.text;
    return spelled ?? { unsupported: 'a deduced (auto) return type needs a trailing return type to be wrapped' };
  }
  const qualifiers = definition.namedChildren
    .filter((child) => child?.type === 'type_qualifier' && child.startIndex < type.startIndex)
    .map((child) => child!.text);
  // Pointer and reference declarators sit between the definition and its function_declarator.
  const indirections: string[] = [];
  for (let current = definition.childForFieldName('declarator'); current !== null && current.id !== declarator.id;) {
    if (current.type === 'pointer_declarator') indirections.push('*');
    else if (current.type === 'reference_declarator') indirections.push(current.child(0)?.text ?? '&');
    current = current.childForFieldName('declarator') ?? current.namedChildren.find((child) => child !== null) ?? null;
  }
  return [...qualifiers, type.text].join(' ') + indirections.join('');
}

function parameterNames(declarator: Node): string[] | CppUnsupported {
  const list = declarator.childForFieldName('parameters');
  if (list === null) return [];
  if (list.children.some((child) => child?.type === '...')) return { unsupported: 'variadic functions cannot be forwarded' };
  const names: string[] = [];
  for (const parameter of list.namedChildren) {
    if (parameter === null) continue;
    if (parameter.type === 'variadic_parameter_declaration') return { unsupported: 'parameter packs cannot be forwarded' };
    if (parameter.type !== 'parameter_declaration' && parameter.type !== 'optional_parameter_declaration') continue;
    // `void f(void)` declares no parameter.
    if (parameter.text.trim() === 'void') continue;
    let current: Node | null = parameter.childForFieldName('declarator');
    while (current !== null && current.type !== 'identifier') {
      current = current.childForFieldName('declarator') ?? current.namedChildren.find((child) => child?.type === 'identifier' || child?.type.endsWith('_declarator')) ?? null;
    }
    if (current === null) return { unsupported: 'an unnamed parameter cannot be handed to the predicates' };
    names.push(current.text);
  }
  return names;
}

function site(definition: Node, declarator: Node): CppFunctionSite | CppUnsupported {
  const body = definition.childForFieldName('body');
  if (body === null || body.type !== 'compound_statement') return { unsupported: 'only definitions with a body can be wrapped' };
  if (definition.children.some((child) => child?.type === 'constexpr' || child?.text === 'consteval' || child?.text === 'constexpr')) {
    return { unsupported: 'constexpr/consteval functions cannot record at runtime' };
  }
  if (COROUTINE.test(body.text)) return { unsupported: 'coroutines cannot be wrapped in a lambda' };
  const type = returnType(definition, declarator);
  if (typeof type !== 'string') return type;
  const parameters = parameterNames(declarator);
  if (!Array.isArray(parameters)) return parameters;
  return {
    line: definition.startPosition.row + 1,
    bodyOpen: body.startIndex + 1,
    bodyClose: body.endIndex - 1,
    returnType: type,
    parameters,
  };
}

/** Resolve `symbol` to the one definition it names in `text`. */
export function resolveCppSymbol(text: string, symbol: string): CppResolution {
  const wanted = wantedPath(symbol);
  const member = symbol.includes('.');
  return withCppTree(text, (tree) => {
    const matches: Node[] = [];
    const stack: Node[] = [tree.rootNode];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node.type === 'function_definition') {
        const declarator = functionDeclarator(node);
        if (declarator !== null && matchesForm(node, member) && endsWith(qualifiedPath(node, declarator), wanted)) {
          matches.push(node);
        }
      }
      for (const child of node.namedChildren) if (child !== null) stack.push(child);
    }
    if (matches.length !== 1) return null;
    const definition = matches[0]!;
    return site(definition, functionDeclarator(definition)!);
  });
}
