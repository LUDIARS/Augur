---
title: Praeforma テスト evidence 連携
type: interface
service: augur
domain: test-lifecycle
status: planned
---

# Praeforma evidence

`augur tests evidence <runId>` は対象リポジトリの `.augur/praeforma.json` を明示的に読み、
`uxRefs` を scenario または use case へ解決する。設定が無い場合は推測せず exit 2 とする。

各 POST は `Origin: <baseUrl>` を必ず送る。先に workspace を GET して得た現在の scenario / use
case revision を `expectedScenarioRevision` / `expectedUseCaseRevision` に入れ、Praeforma 側はその版と
異なる evidence を stale として扱う。本文・asset は送らず、run/test ID、名前、bundle、結果、時間、
失敗メッセージだけを payload とする。

同じ `(runId, testId, targetId)` は run cache の `evidence` に残し再登録しない。未解決 `uxRefs` は
警告と report の evidence 節へ残すが、解決できた対象の登録は続行する。Praeforma の到達不能・4xx・
5xx は失敗であり、結果を成功へ読み替えない。`--dry-run` は workspace の確認と送信予定の表示だけを行い
POST も cache 更新もしない。
