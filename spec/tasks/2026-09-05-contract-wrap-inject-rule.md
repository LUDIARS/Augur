---
task: contract-wrap-inject-rule
project: Augur
kind: 実装
created: 2026-09-05
---
# C2 契約ファイルと注入 rule `contract-wrap`

## 目的
[設計書](../plan/2026-09-05-live-contract-testing.md) §3 / §5 の C2。
`augur.contracts.json` (zod schema) と `augur contracts lint`、
log-injection の新 rule `contract-wrap` (apply / check / remove) を実装し、Anatomia の
`diff.functions.added` と照合して新規関数だけを注入対象にする。

## 完了条件
- `augur.contracts.json` の schema (version / contractsDir / importFrom / contracts[id, criterion,
  symbol, file, module, mode, sample]) と `augur contracts lint` (id 重複、file:symbol 実在、
  述語 default export の形)
- `contract-wrap` の 3 形 (const 初期化子の wrap、関数宣言直後の `f = contract(f, …)` +
  `@ts-expect-error augur-inject`、クラスメソッドの差し替え) を apply。インスタンスメソッドは
  prototype、static メソッドはクラス自体を差し替え、private メソッドは対象外。import はマーカー
  付き行で `contract` と述語モジュール (注入先ファイルからの相対 specifier に正規化)
- `check` に `unresolved` / `stale-module` を追加、`--strict` で非 0
- `augur inject apply --rule contract-wrap --diff-base <ref>` / `--analysis <file>` /
  `--include-existing`。Anatomia 未導入で `--diff-base` も無い場合は、契約ファイルが指名した関数を
  全て対象にする
- `remove` が apply 前と byte-identical に戻る往復 golden テスト (test/safety)
- 設計書 §12 の C2-1 〜 C2-3。`src/contracts/` を新ドメイン `contract-observation` として
  `spec/domains/` に追加し、Anatomia verify を通す
- 実装した関数自身に `augur.contracts.json` を書き、`LOG_WEAVER=1` のテスト実行で covered になる
  ことを PR の証跡にする (C3 が無い間はイベント JSONL の存在で代替)

## スコープ (編集可ディレクトリ)
- src/inject
- src/contracts
- src/cli
- bin
- test
- spec/domains
- spec/interface/inject-cli.md
- spec/feature/log-injection.md
