---
task: tests-api-contracts-section
project: Augur
kind: 仕様
created: 2026-09-05
memory_links: []
---
# `contracts` 節を tests-api.md (HTTP / MCP) 側にも追補する

## 目的
C3 ([contracts-report-aggregation](./2026-09-05-contracts-report-aggregation.md)) で
`operations.report(runId)` の戻り (`Report`) に `contracts` 節を足した。HTTP の
`GET /v1/tests/runs/:runId/report` (`src/routes/tests.ts`) と MCP の
`augur_tests_report` (`src/mcp/server.ts`) は同じ `Report` をそのまま返す薄皮なので、
実装としては既に `contracts` が出ている。

一方で追補したのは [tests-cli.md](../interface/tests-cli.md) と
[revisor-verification.md](../interface/revisor-verification.md) だけで、
[tests-api.md](../interface/tests-api.md) には書いていない。
tests-api.md は「CLI に無い機能は持たない」薄皮であることを宣言している文書なので、
CLI 側にだけ節がある状態は、API 利用者から見ると未文書のフィールドが増えたことになる。

## 完了条件
- [tests-api.md](../interface/tests-api.md) の `report` (HTTP `GET
  /v1/tests/runs/:runId/report`、MCP `augur_tests_report`) の記述に、
  `format=json` の応答が `contracts` 節を含みうることを書く。内容は
  [tests-cli.md](../interface/tests-cli.md) の「契約観測の合流」節を参照させ、
  定義を二重に書かない
- 対象リポジトリに `augur.contracts.json` が無い場合はキーごと現れないこと、
  `format=markdown` では `### Contracts` として出ることを明記する
- `TestOperations` の型記述 (tests-api.md 冒頭の interface 抜粋) が
  `Report` の変更と食い違っていないか確認し、必要なら合わせる
- 応答形を検証している既存テスト (`test/api/api.test.ts`) が、契約ファイルの無い
  リポジトリでは `contracts` を返さないことを引き続き担保していることを確認する

## スコープ (編集可ディレクトリ)
- spec/interface/tests-api.md
- test/api
