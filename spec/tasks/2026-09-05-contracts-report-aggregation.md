---
task: contracts-report-aggregation
project: Augur
kind: 実装
created: 2026-09-05
---
# C3 `augur contracts report` 集計と verdict / 保証フラグへの合流

## 目的
[設計書](../plan/2026-09-05-live-contract-testing.md) §6 の C3。
weaver JSONL を現行 marker id + 契約 id ごとに集計し、
`covered / violated / uncovered` を返す。`--acceptance` で Concordia の
`acceptance_report` 形に整形し、`augur tests report` と `flag` の summary に合流させる。

## 完了条件
- `augur contracts report --project <dir> [--logs <dir>] (--since <iso> | --all) [--json|--markdown]`。
  `--since` / `--all` のいずれか一方が必須、`--acceptance` では `--all` 不可
- `check` が現行ソースから解決した `rule:contract-wrap` + marker id と一致するイベントだけ読む
- `covered` = observed ≥ 1 かつ violated / predicate threw 0、`violated` = どちらか ≥ 1
  (phase 別件数 + 最新 3 件の理由)、`uncovered` = 両方 0 (注入無し / 未呼び出しを区別表示)
- `--acceptance --json` は `[{criterion, met, note}]`。`met` は covered のみ true。
  対象契約の `sample` が全て 1 でなければ usage error。時刻を読めないイベントは診断件数には
  数えるが acceptance 集計から除外して警告
- 同じ入力から byte-identical な出力 (golden)
- `augur tests report <runId>` に `contracts` 節 (run の [startedAt, finishedAt] 内の集計)、
  `augur tests flag` の summary に `contracts: {covered, violated, uncovered}`
- 設計書 §12 の C3-1 〜 C3-3。`spec/interface/tests-cli.md` と `revisor-verification.md` を追補

## スコープ (編集可ディレクトリ)
- src/contracts
- src/cli
- src/tests
- src/operations
- test
- spec/interface
