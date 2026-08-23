---
title: Tests API — HTTP (augur serve) と MCP (augur mcp)
type: interface
service: augur
domain: test-lifecycle
status: planned
tags:
  - test-lifecycle
  - http-api
  - mcp
updated: 2026-08-23
---

# Tests API (HTTP / MCP)

「各サービスの機能にどのようなテストがあるか」を問い、「テストの実行」を API で行える
ようにする。どちらも `src/operations/tests.ts` (CLI と共有) を呼ぶ薄皮で、独自の状態を
持たない ([plan/test-management.md](../plan/test-management.md) §1.2)。

## 1. operations 層

```ts
interface TestOperations {
  listTests(q: { repoPath: string; domain?: string; kind?: string; status?: string }): Promise<TestRecord[]>;
  getTest(q: { repoPath: string; testId: string }): Promise<{ test: TestRecord; recentRuns: RunRecord[] }>;
  catalog(q: { repoPath: string }): Promise<ServiceCatalog>;       // §2.1 の形
  register(q: RegisterInput): Promise<TestRecord>;
  registerFromPlan(q: { repoPath: string; planId: string }): Promise<TestRecord[]>;
  lint(q: { repoPath: string }): Promise<LintResult>;
  plan(q: PlanInput): Promise<TestPlan>;
  author(q: { planId: string; repoPath: string; author: "session" | "claude-cli"; bus?: string }): Promise<AuthorResult>;
  run(q: RunInput): Promise<RunRecord>;
  report(runId: string): Promise<Report>;
  verdict(runId: string, v: Verdict): Promise<RunRecord>;
  flag(runId: string, target: { pullRequestId: string }): Promise<FlagResult>;
  listRuns(q: RunQuery): Promise<RunRecord[]>;
  sweep(q: { repoPath: string; now?: string; apply?: boolean }): Promise<SweepResult>;
  revive(q: { repoPath: string; testId: string }): Promise<TestRecord>;
  prune(q: { repoPath: string; apply?: boolean }): Promise<PruneResult>;
}
```

CLI の各 verb はこの 1 メソッドを呼ぶだけにする (引数の解釈と出力整形だけが CLI の仕事)。
[tests-cli.md](./tests-cli.md) の verb と 1:1 で、取りこぼしが無いこと
(`show` → `getTest`、`register --from-plan` → `registerFromPlan`)。HTTP / MCP は
このうち公開すると決めたものだけを出す (`lint` / `sweep` / `revive` / `prune` は
台帳を持つ worktree での作業なので CLI だけ)。逆に **CLI に無い操作は作らない**。

### 1.1 リポの解決

API / MCP は `repoPath` の代わりに `repository` ("LUDIARS/Augur") でも指定できる。
解決表は `augur.config.json` → `repositories: { "<name>": "<絶対パス>" }`。未登録なら 404。
worktree (使い捨て) を指すときは `repoPath` を直接渡す。

## 2. HTTP (`augur serve`)

既存 Hono シェル (`src/app.ts`) に載せる。loopback 固定、ポートは Excubitor catalog が正
(Augur の `augur.config.json` はその写し)。`GET /v1/health` は既存のまま。

| Method | Path | 内容 |
|---|---|---|
| GET | `/v1/tests?repository=&domain=&kind=&status=` | 台帳一覧 |
| GET | `/v1/tests/catalog?repository=` | §2.1 サービス機能 × テスト一覧 |
| GET | `/v1/tests/:testId?repository=` | 1 件 + 直近 run |
| POST | `/v1/tests/plans` | body = `PlanInput` (`{ repository\|repoPath, source: { type: "pr", analysis?: PrDiffReview, base? } \| { type: "incident", file } }`) → `TestPlan` |
| GET | `/v1/tests/plans/:planId` | 計画取得 |
| POST | `/v1/tests/plans/:planId/author` | body `{ author: "session"\|"claude-cli", bus? }` → `AuthorResult` (session なら briefs) |
| POST | `/v1/tests/runs` | body = `RunInput` (`{ repository\|repoPath, bundle, head?, bus?, cached? }`) → `RunRecord`。同期。長い場合は `?async=1` で `202 { runId }` を返し `GET /v1/tests/runs/:runId` で追う |
| GET | `/v1/tests/runs?repository=&head=&since=&status=` | キャッシュ一覧 |
| GET | `/v1/tests/runs/:runId` | `RunRecord` |
| GET | `/v1/tests/runs/:runId/report?format=json\|markdown` | 報告 |
| POST | `/v1/tests/runs/:runId/verdict` | body = `Verdict` |
| POST | `/v1/tests/runs/:runId/flag` | body `{ pullRequestId }` → `FlagResult` |

- 登録順は上表のとおり。`/v1/tests/:testId` は**最後**に登録する (先に置くと
  `catalog` / `plans` / `runs` を testId として飲み込む)。
- エラー形は既存 [http-api.md](./http-api.md) の `{ error: { code, message, details? } }`。
- 書き込み系 (`plans` / `author` / `runs` / `verdict` / `flag`) は loopback 以外を 403。
  これは既存のホストポリシーをそのまま使う。
- `serve` は同時実行を 1 run に絞る (同じ worktree で並列実行すると runner が衝突する)。
  2 本目は `409 { code: "run_in_progress", runId }`。

### 2.1 サービス機能 × テスト (catalog)

「各サービスの機能にどのようなテストがあるか」への答え。ビジネスドメイン = 機能。

```ts
interface ServiceCatalog {
  repository: string;
  generatedAt: string;
  domains: Array<{
    business: string | "(unowned)";
    description?: string;                 // spec/domains/<name>.domain.json の description
    quota: { max: number; active: number; probation: number; retired: number };
    programDomains: string[];             // このビジネスドメインに対応するプログラムドメイン
    tests: Array<Pick<TestRecord, "id" | "name" | "kind" | "status" | "runtime" | "always" | "file" | "lastRunAt" | "lastFailedAt" | "passStreak">>;
    lastRun?: { runId: string; at: string; status: RunRecord["status"] };  // このドメインを含む直近 run
  }>;
}
```

ビジネスドメインの description は対象リポの `spec/domains/*.domain.json` から読む
(Anatomia と同じ正本。Augur は `name` / `description` 以外を解釈しない)。

## 3. MCP (`augur mcp`)

stdio transport。クライアント設定例 (Claude Code):

```json
{ "mcpServers": { "augur": { "command": "node", "args": ["E:/path/to/Augur/bin/augur.mjs", "mcp"] } } }
```

依存は `@modelcontextprotocol/sdk` (Anatomia と同じ)。tool 名は operations と 1:1。

| tool | 入力 | 出力 |
|---|---|---|
| `augur_tests_catalog` | `{ repository \| repoPath }` | `ServiceCatalog` |
| `augur_tests_list` | `{ repository \| repoPath, domain?, kind?, status? }` | `TestRecord[]` |
| `augur_tests_plan` | `PlanInput` | `TestPlan` (briefs 込み。セッションはこれを読んでテストを書く) |
| `augur_tests_register_from_plan` | `{ planId, repoPath }` | 登録結果 |
| `augur_tests_author` | `{ planId, repoPath, author, bus? }` | `AuthorResult` |
| `augur_tests_run` | `RunInput` | `RunRecord` |
| `augur_tests_report` | `{ runId, format? }` | 報告 (markdown 既定。LLM が読む前提) |
| `augur_tests_verdict` | `{ runId, decision, by, note? }` | `RunRecord` |
| `augur_tests_flag` | `{ runId, pullRequestId }` | `FlagResult` |
| `augur_tests_runs` | `RunQuery` | `RunRecord[]` |

MCP resource: `augur://tests/<repository>/catalog` (= catalog の JSON)。

セッション側の標準手順 (6 ステップの 3〜6) は
`augur_tests_plan` → (書く) → `augur_tests_register_from_plan` → `augur_tests_run` →
`augur_tests_report` → (判断) → `augur_tests_verdict` → `augur_tests_flag`。

## 4. Concordia / Excubitor との接続

- Excubitor catalog: `augur` を `autostart: false`、`provides: AUGUR_URL` で再登録
  (Excubitor #1「catalog から augur 削除」は取り下げ)。
- Concordia の実装テンプレには MCP 経由の 6 ステップを seed に足せる (別リポ、本計画外)。

## 関連

- [tests-cli.md](./tests-cli.md)
- [http-api.md](./http-api.md) — 既存の `/v1/plans` / `/v1/health`
- [../feature/test-lifecycle.md](../feature/test-lifecycle.md)
