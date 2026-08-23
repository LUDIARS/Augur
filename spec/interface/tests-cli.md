---
title: augur tests — テスト管理サブコマンド
type: interface
service: augur
domain: test-lifecycle
status: planned
tags:
  - test-lifecycle
  - cli
updated: 2026-08-23
---

# `augur tests …` (CLI)

テスト管理の**正本の操作面**。MCP / HTTP ([tests-api.md](./tests-api.md)) は同じ
operations 層 (`src/operations/tests.ts`) を呼ぶ薄皮で、CLI に無い機能は持たない。

既存 [cli.md](./cli.md) の流儀に揃える: `node <augurFolder>/bin/augur.mjs tests <verb>`、
shell 不要、`--json` で機械可読、exit code は下表。

## コマンド

| verb | 役割 | 台帳書込 |
|---|---|---|
| `list [--repo <wt>] [--domain <name>] [--kind k] [--status s] [--business\|--program]` | 台帳一覧。`--domain` はビジネス / プログラムどちらにも一致 | − |
| `show <testId>` | 1 件 + 直近 run 履歴 | − |
| `register --repo <wt> --file <f> --name <n> --runner r [--selector] [--kind k] [--program <id>…] [--business <name>…] [--anchor <id>…] [--runtime] [--always]` | 既存 (手書き) テストを台帳へ | ○ |
| `register --from-plan <planId> --repo <wt>` | セッションが書いたテストを計画の target と突き合わせて一括登録 (`@augur test:` コメントか `file`+`title` で照合) | ○ |
| `lint --repo <wt>` | 台帳の整合検査 ([test-lifecycle.md](../feature/test-lifecycle.md) §1) | − |
| `plan --repo <wt> (--analyze [--base <ref>] \| --analysis <file>) [--pr <n>] [--json]` | PR からの計画 ([test-authoring.md](../feature/test-authoring.md)) | − (plan ストアへ) |
| `plan --repo <wt> --incident <file\|run:<runId>> [--json]` | incident からの計画 | − |
| `author --plan <planId> --repo <wt> [--author session\|claude-cli] [--before <sha>] [--bus <name>]` | 計画の target を作成。`session` は brief を出すだけ | ○ (`claude-cli` 時) |
| `run --repo <wt> --bundle pr[:<base>]\|domain:<name>\|all\|ids:<id,…> [--head <sha>] [--bus <name>] [--cached] [--no-promote] [--for-revisor] [--json]` | バンドル実行 → `runId` | ○ (`--for-revisor` 時は×) |
| `report <runId> [--json\|--markdown]` | 判断者向け報告 | − |
| `verdict <runId> --accept\|--reject --by <who> [--note <text>]` | 判断を記録 | − (キャッシュへ) |
| `flag <runId> --pr <revisorPrId> [--revisor-url <u>]` | Revisor へ保証フラグ ([revisor-verification.md](./revisor-verification.md)) | − |
| `runs [--repo] [--head <sha>] [--since <iso>] [--status s] [--json]` | キャッシュ一覧 | − |
| `sweep --repo <wt> [--now <iso>] [--apply]` | 退役判定。既定は提案表示、`--apply` で台帳更新 | ○ (`--apply`) |
| `revive <testId> --repo <wt>` | `retired` → `active` | ○ |
| `prune --repo <wt> [--apply]` | `retired` テストのファイル削除提案 / 実施 | ○ (`--apply`) |

`--repo` 省略時は cwd。worktree を渡すのが通常 (Revisor / セッションとも)。

## `plan` の入力の決め方

- `--analyze`: Augur が `AUGUR_ANATOMIA_DIR` の Anatomia CLI を spawn し `pr-review` /
  `domains program` / `callers` を取る。Anatomia が無ければ exit 2。
- `--analysis <file>`: Revisor など、既に `PrDiffReview` JSON を持つ呼び出し元が渡す。
  `callers` / `domains program` は `--analyze` と同様に Augur が補完する
  (`--no-impact` で補完を止め、影響範囲 = 変更 anchor のみ)。

## 出力 (text)

`run` の text 出力は既存 cli.md の Text Output Format に倣い、見出し → ドメイン別 →
1 テスト 1 行 (`✔ / ✘ / – / !`、id、name、duration)。末尾に `run: <runId>`。

## Exit codes

| code | 意味 |
|---|---|
| 0 | 成功 (`run` は結果が passed / failed どちらでも 0。結果は出力で見る。ただし `--for-revisor` は failed で 1) |
| 1 | 使い方の誤り、入力契約違反、前提未達 (`flag` の verdict 無し等) |
| 2 | 内部エラー / 外部ツール不在 (Anatomia / claude CLI / バス起動失敗) |
| 3 | バンドルが空 (走っていない)。`--for-revisor` では使わない (下記) |
| 4 | `plan` が `blocked_by_domain` |

`run --head <sha>` は記録する SHA の上書きではなく、対象 worktree の実際の Git HEAD と
一致することを確認する事前条件。不一致なら実行前に exit 1 とし、別の head を保証した形の
`RunRecord` を作らない。

`--for-revisor` だけ failed → 1 にするのは、Revisor の登録テストは exit code で成否を
見るため。同じ理由で `--for-revisor` は**バンドルが空でも 0** を返す (docs-only PR で
`pr` バンドルが空になるのは正常で、「テストが落ちた」ではない)。`--for-revisor` が
非 0 になるのは failed (1) と内部エラー (2) だけ。

## 関連

- [cli.md](./cli.md)
- [tests-api.md](./tests-api.md)
- [../feature/test-lifecycle.md](../feature/test-lifecycle.md)
- [../feature/test-authoring.md](../feature/test-authoring.md)
