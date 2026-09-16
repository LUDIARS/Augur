---
title: Praeforma evidence 連携 (SPEC-PRAEFORMA-EVIDENCE)
type: task
domain: test-lifecycle
---

# Praeforma evidence 連携 (SPEC-PRAEFORMA-EVIDENCE)

## 目的

Augur の RunRecord が記録したテスト結果を、判断を加えず Praeforma の scenario / use case に
revision 付き evidence として残し、旧版の証拠を新版の検証済み表示に使わせない。

## 完了条件

- C-1 createReport(run, records): evidence を持つ run は登録件数と未解決 uxRef を報告へ保持し、証拠の無い run に evidence 節を作らない
- C-2 publishEvidence(run, records): Origin を付けて current revision を取得し、同一 run/test/target を二重登録しない
- C-3 registerCommand(context, operations): `--ux` と `@augur ux:` が TestRecord.uxRefs に決定的に保存される

## 検証

Hermetic fetch の単体テストで Origin、revision、重複抑止、未解決参照、403/500 を確認する。
