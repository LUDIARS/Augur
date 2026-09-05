---
task: contract-import-source-unification
project: Augur
kind: 実装
created: 2026-09-05
status: completed
memory_links: []
---
# `contract` の import 元を契約ファイル側に一本化する

## 目的
[設計書](../plan/2026-09-05-live-contract-testing.md) §3.1 は `augur.contracts.json` に
`importFrom` を持たせているが、C2 の初期実装では `contract-wrap` が注入する
`import { contract } from '…'` の specifier は既存 `computeImportEdit` 経由で
`augur.inject.json` の `importFrom` から来ており、契約ファイルの `importFrom` は
schema に存在するだけで注入に効かなかった。

実装では契約ラッパーだけ `augur.contracts.json#importFrom` を使い、既存 4 rule は
`augur.inject.json#importFrom` を使う責務分担にした。値が異なる場合は source ごとに
marker 付き import を生成し、同じ場合は従来どおり 1 本へ union する。

## 完了条件
- 注入される `contract` の import 元が、契約ファイルの `importFrom` から決まる。
  `augur.contracts.json` が無い (= `contract-wrap` の対象が無い) プロジェクトでは
  既存 4 rule の import 生成が現在と 1 バイトも変わらないこと
- 契約ファイルと `augur.inject.json` の `importFrom` が食い違う場合の扱いを決めて実装する。
  契約側を優先するなら、同じファイルに両方の import が並ぶ場合の `computeImportEdit` の
  union 書き換えが壊れないこと。lint で不一致を報告する道を採るなら
  `augur contracts lint` に findings コードを 1 つ足す
- 既存 golden と `test/safety` の往復テストが無変更で通る
- [inject-cli.md](../interface/inject-cli.md) と
  [log-injection.md](../feature/log-injection.md) の「二つの `importFrom` は一致させる」
  という但し書きを、実装した挙動の記述に置き換える

## スコープ (編集可ディレクトリ)
- src/inject
- src/contracts
- test
- spec/feature/log-injection.md
- spec/interface/inject-cli.md
