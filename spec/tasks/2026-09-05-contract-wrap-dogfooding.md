---
task: contract-wrap-dogfooding
project: Augur
kind: テスト
created: 2026-09-05
memory_links: []
---
# contract-wrap の自己適用 (C1 マージ後)

## 目的
[設計書](../plan/2026-09-05-live-contract-testing.md) §12 が C2 の証跡として求めている
dogfooding。`contract-wrap` を実装した Augur 自身の関数に契約を書いて注入し、
テスト実行で `covered` になることを確かめる。

C2 の実装 PR ではランタイム側 (C1: Lapilli `@ludiars/log-weaver` の `contract()`) が
未マージで、注入したコードが import する対象が存在しないため実施できなかった。
注入テキストの生成自体は文字列なので依存なしに検証済み — 残るのは実際に動かす部分だけ。

## 完了条件
- `@ludiars/log-weaver` が `contract()` を export している (C1 マージ済み) ことを確認する
- Augur 自身の 2〜3 関数に `augur.contracts.json` と `contracts/*.contract.ts` を置く。
  対象は `contract-wrap` 経路を実際に通る関数 (`computeApply` / `computeRemove` /
  `checkSource` など) とし、述語は §3.2 のとおり純粋で、理由文字列に引数値や戻り値を載せない
- `augur inject apply --rule contract-wrap --include-existing` が 3 形いずれかを注入する
- `LOG_WEAVER=1 npm test` の実行で weaver JSONL に `contract observed` が出る
  (C3 の `augur contracts report` が未実装の間はイベント行の存在で代替してよい)
- `augur inject remove --rule contract-wrap` で `git diff` が空に戻る
- `augur contracts lint --project .` が findings 0 を返す
- 上記の出力を証跡として残す

## スコープ (編集可ディレクトリ)
- augur.contracts.json
- contracts
- src/inject
- src/contracts
- spec/plan/2026-09-05-live-contract-testing.md
