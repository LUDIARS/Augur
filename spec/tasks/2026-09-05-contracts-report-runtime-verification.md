---
task: contracts-report-runtime-verification
project: Augur
kind: テスト
created: 2026-09-05
memory_links: []
---
# `augur contracts report` を実ランタイムの weaver JSONL で検証する

## 目的
C3 ([contracts-report-aggregation](./2026-09-05-contracts-report-aggregation.md)) の
集計は、委託プロンプトが提示した `WeaverEvent {level, msg, ctx}` の形を仕様として
実装し、フィクスチャでのみ検証している。Lapilli `@ludiars/log-weaver` の
`contract()` が実際に書き出す JSONL とは突き合わせていない (C3 の PR に
「前提未確定」として明記済み)。

`ctx` のキー名 (`contract` / `phase` / `reason` / `observed_at` / `where` / `id`)、
Vestigium writer が付ける時刻フィールド名、1 行の入れ子の深さのいずれかが実装の想定と
違えば、`normalizeContractEvents` は該当行を黙って `ignored` に落とし、
すべての契約が `uncovered` に見える。仕様どおりに動いているように見えて
判定材料が空になる、という壊れ方をするため、実物で 1 度確かめる。

[contract-wrap の自己適用](./2026-09-05-contract-wrap-dogfooding.md) は注入と
往復の検証が主題で、本タスクは**その注入で出た実イベントを report が読めるか**を
主題にする。両者は同じ実行で証跡を取れるので、まとめて実施してよい。

## 完了条件
- Lapilli `@ludiars/log-weaver` の `contract()` がマージ済みであることを確認する
- 注入済みの Augur を `LOG_WEAVER=1` で実行し、weaver JSONL を 1 本得る
- そのログに対して `augur contracts report --project . --all` を実行し、
  注入した契約が `covered` (または実際の違反どおり `violated`) になることを確認する。
  すべて `uncovered` かつ `diagnostics.matched` が 0 なら、`ctx` のキー名か時刻
  フィールド名が想定と違うので `src/contracts/events.ts` の正規化を実装に合わせて直す
- `diagnostics` の `ignored` 相当 (契約行以外) と `undated` が実ログでどうなるかを確認し、
  `undated > 0` になるなら `observed_at` を落としている経路を特定する
- `augur contracts report --acceptance --json --since <実行開始時刻>` が
  `[{criterion, met, note}]` を返し、`met` が実観測と一致する
- 実ログの 1 行を匿名化して `test/contracts/` のフィクスチャに追加し、
  以後この形が壊れたらテストで気づけるようにする (理由文字列に引数値・戻り値・
  機微情報を載せない、という §3.2 の制約を満たす行だけを使う)
- 想定と実物がずれていた場合は
  [設計書](../plan/2026-09-05-live-contract-testing.md) §4 のイベント形の記述を実装に合わせる

## スコープ (編集可ディレクトリ)
- src/contracts
- test/contracts
- spec/plan/2026-09-05-live-contract-testing.md
