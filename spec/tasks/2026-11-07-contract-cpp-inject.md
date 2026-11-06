# C++ contract injection and lint (SPEC-CONTRACT-CPP-INJECT)

Specification ID: SPEC-CONTRACT-CPP-INJECT

Actio: b8691e30-ddd4-4b35-9677-5c238929e3ba. Human instruction (2026-11-07): 「Augur に C++ の自動注入と lint を追加」. Builds on the C++ runtime (SPEC-CONTRACT-RUNTIME-TEMPLATE, "C++ flavor").

## Scope

`augur.contracts.json` entries whose `file` is a C++ source or header (`.cc .cpp .cxx .c++ .h .hh .hpp .hxx .h++ .inl .ipp`) go through the C++ path of `augur contracts lint`, `augur inject scan|apply|check|remove` (rule `contract-wrap`) and the report's active-marker lookup. TypeScript / ESM contracts are unchanged. C++ sources never receive the JavaScript log rules (entry-runtime, silent-catch, spawn-watch, interval/listener guards).

Parsing uses tree-sitter-cpp through `web-tree-sitter` (WASM; `tree-sitter-wasms` ships the grammar — MIT / Unlicense, the same pair Anatomia uses). The grammar loads asynchronously; the CLI awaits `prepareCppParser()` before `inject`, `contracts` and `tests`, and the synchronous resolver throws if it was skipped (never a silent "unresolved").

## Manifest conventions for C++

- `importFrom` is the include path of the runtime header as the project's include directories see it, e.g. `"augur/contract_runtime.hpp"` (synced with `augur contracts runtime sync --path include/augur/contract_runtime.hpp`). A non-header `importFrom` on a C++ contract is lint `runtime-include` and inject `unresolved`.
- `module` is a predicate header that declares exactly one set at namespace scope:

  ```cpp
  #pragma once
  #include "augur/contract_runtime.hpp"
  namespace contracts {
  inline const auto area_checks = augur::predicates(
      [](int w, int h) { return w >= 0 && h >= 0; },
      [](int result, int, int) { return result >= 0 ? augur::pass() : augur::fail("negative area"); });
  }
  ```

  `augur::pre_only(pre)` / `augur::post_only(post)` declare one side. Anything else (none, several, inside a function or class) is `stale-module`.
- `symbol`: `fn` (unique free function in any namespace), `ns::fn` (scope path suffix) or `Class.method` (out-of-line `Class::method` or defined inside `Class`). Overloads make a name ambiguous and unresolved.

## Wrapping

C++ cannot rebind a function the way `f = contract(f, spec)` does, so the body is wrapped in place with inserts only:

```cpp
int area(int width, int height) { return ::augur::invoke_observed(::augur::ContractSpec{"C-1", "<id>", "src/geo/shape.cpp:4"}, contracts::area_checks, [&]() -> int { /* augur-inject:contract-wrap:<id> */
  return width * height;
}, width, height); /* augur-inject:contract-end:<id> */ }
```

plus `#include "<importFrom>" /* augur-inject:import:<id> */` and `#include "<path to module from file>" /* augur-inject:contract-predicate:<id> */` after the last `#include` (else after `#pragma once`, else at the top). A file that already includes the runtime header gets no second include. CRLF files stay CRLF.

- The lambda's return type is the definition's (qualifiers, pointers and references kept: `const std::string&`), or its trailing return type when declared `auto`. `return` statements inside the body return from the lambda, so the function's behaviour is unchanged; `invoke_observed` returns the result unchanged (references stay references, move-only values move).
- Parameters are handed to the predicates as lvalues, in order.
- Not wrappable, reported `unresolved` with the reason by lint: constructors/destructors, `auto` without a trailing return type, unnamed parameters, C variadics and parameter packs, `constexpr`/`consteval`, coroutines, declarations without a body.
- `contract-end` is a bookkeeping marker (like `import`): it belongs to the opening `contract-wrap` marker's point and is never orphaned on its own.
- `remove` deletes exactly the inserted text (the opening fragment from ` return ::augur::invoke_observed(` to its marker, the closing `}, args); <marker> `, and the two include lines), restoring the original bytes.

## Verification

- `test/unit/inject/contract-wrap-cpp.test.ts`: symbol forms, unsupported reasons, predicate headers, lint findings, apply/check/remove round trip (LF and CRLF), problem states, no JS rules on C++.
- `test/contracts/runtime-cpp-inject.test.ts`: injects into a real file, compiles it with the synced runtime (warnings as errors; g++/clang++/MSVC), runs it and reads `contracts.jsonl` (observed / pre violated / post violated), then removes the injection and compiles the byte-identical original. Skips with the reason when no compiler exists.

## Limits

Template functions are wrapped textually and compile only when the return type text is valid inside the body; overload sets need distinct names to be addressed. Declarations in headers without a body (pure virtuals, prototypes) are not wrappable — the contract names the definition.
