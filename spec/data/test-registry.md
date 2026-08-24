---
title: Test registry, run cache and bus configuration
type: data
service: augur
domain: test-lifecycle
status: planned
tags:
  - test-lifecycle
  - schema
  - persistence
updated: 2026-08-23
---

# テスト台帳・実行キャッシュ・バス設定 (データ)

[plan/test-management.md](../plan/test-management.md) の状態はすべてここで定義する
ファイルにある。プロセス固有の状態は無い (CLI / MCP / HTTP のどの入口から見ても同じ)。

## 1. 置き場所

| データ | 場所 | git | 理由 |
|---|---|---|---|
| テスト台帳 `tests.jsonl` | **対象リポ** `<repo>/.augur/tests.jsonl` | 追跡する | テストファイルと同じブランチで動く。Revisor の使い捨て worktree でもそのブランチの台帳が読める |
| リポ設定 `tests.config.json` | `<repo>/.augur/tests.config.json` | 追跡する | quota / runner / 既定バス名はリポの性質 |
| 実行キャッシュ `runs.sqlite` (または `runs.jsonl`) | `AUGUR_DATA_DIR` (既定 `<augurFolder>/.augur-data/`) | 追跡しない | worktree は使い捨て。結果はマシン側に残す |
| 判断 / フラグ | 実行キャッシュ内 (run に紐づく) | 追跡しない | 同上 |
| バス定義 | `<augurFolder>/augur.config.json` の `buses` (リポ設定で同名上書き可) | Augur 側は追跡 | 実行環境はマシン固有。リポは**名前**だけ参照する |

`.augur/` は Anatomia の `.anatomia/` と衝突しない別ディレクトリ。`tests.jsonl` は
1 行 1 `TestRecord`、id 昇順で書き直す (差分が読める・決定的)。

実行キャッシュの置き先は `AUGUR_DATA_DIR` (環境変数) → `augur.config.json` の `dataDir` →
既定 `<augurFolder>/.augur-data/` の順で決める (環境変数が最優先。既存の
`AUGUR_LOG_LEVEL` と同じ流儀)。相対パスは `<augurFolder>` 起点。キャッシュには
テスト出力と worktree の絶対パスが入るので **git 追跡しない** (`.gitignore` 済み)。

## 2. `TestRecord`

```ts
interface TestRecord {
  /** 決定的 id: `t-` + sha1(repository + "\n" + file + "\n" + name).slice(0, 12) */
  id: string;
  repository: string;            // "LUDIARS/Augur"
  name: string;                  // 人が読む名前 (runner の selector と一致させる)
  file: string;                  // repo-relative、POSIX 区切り
  selector?: string;             // runner 固有の絞り込み (vitest -t / cargo test <name> / gtest --gtest_filter)
  runner: "vitest" | "cargo" | "gtest" | "unity" | "command";
  command?: string[];            // runner=command のとき必須。argv 配列、shell 無し
  kind: "regression" | "assurance" | "guardrail";
  domains: {
    business: string[];          // Anatomia ビジネスドメイン名 (spec/domains の name)。空 = 紐づけなし (正当)
    program: string[];           // プログラムドメインキー `<layer>:<moduleId>` (例 "shared:test/golden")。**1 件以上必須**
  };
  anchors: string[];             // このテストが守る Anatomia AnchorId (変更検知・バンドル選択に使う)
  origin: {
    type: "pr" | "incident" | "experience" | "manual";
    ref: string;                 // PR 番号 / 問題ログ path / experience goal id / 空
    planId?: string;             // 生成元 TestPlan
    authoredBy?: "session" | "claude-cli" | "human";
  };
  runtime: boolean;              // true = 動作保証テスト (Revisor の runtime: true と同義)
  always: boolean;               // true = どのバンドルにも常に含める
  status: "candidate" | "active" | "probation" | "retired";
  createdAt: string;             // ISO 8601
  lastRunAt?: string;
  lastFailedAt?: string;
  passStreak: number;            // 連続 pass 数 (失敗で 0)
  runs: number;                  // 総実行数
  retiredAt?: string;
  retiredReason?: string;
  tags?: string[];
  note?: string;
}
```

`domains.program` のキーは Anatomia の**プログラムドメイン entity id ではなく** `<layer>:<moduleId>`
(`anatomia domains program --repo . --json` の `modules[].layer` と `modules[].moduleId`) で書く。
entity id はモジュールの畳み方が変わるたびに変わる不透明ハッシュで、追跡ファイルのキーに
向かない。layer と module の組は人が読めて決定的に再導出できる (T2 の計画も同じキーを出す)。

`kind` の意味:

| kind | 何を守るか | 生成契機 |
|---|---|---|
| `regression` | 「直したものが再び壊れない」。失敗事例に 1:1 | incident / PR で修正した bug |
| `assurance` | 「この機能はこう動く」。変更関数とその影響範囲の振る舞い | PR の変更 anchor + 到達範囲 |
| `guardrail` | 予算・制約 (experience goal / 性能 / 内容レーティング)。既存 [experience-driven-constraints](../feature/experience-driven-constraints.md) の出口 | experience goal |

`status` の遷移は [feature/test-lifecycle.md](../feature/test-lifecycle.md) §4。

### 2.1 台帳は「対象リポの内容」であって信頼済み入力ではない

`tests.jsonl` は対象リポで追跡されるファイルなので、**PR のブランチが書き換えられる**。
Augur はそれを読んでプロセスを起動し、ファイルを消す。よって読み込み時に必ず検証し、
落ちた行は無視せず `lint` / `run` のエラーにする (黙って握り潰さない)。

- `file` と、`prune` が消す対象は repo-relative かつ POSIX 区切り。絶対パス・
  ドライブレター・`..` 成分・repo 外へ出る symlink は拒否する (`prune --apply` は
  worktree 外を絶対に触らない)。
- `command` (runner=`command`) は argv 配列のみ。文字列 1 本や shell 経由は受け付けない。
  実行は必ずバス越し ([feature/test-lifecycle.md](../feature/test-lifecycle.md) §3.1)。
- 信頼境界: `augur tests run` が対象リポの argv を起動するのは、その worktree の
  テストランナーを起動するのと同じ権限で、**リポの内容を信頼する操作**である。
  Revisor など第三者ブランチを審査する呼び出し元は、隔離した worktree と
  バス (`wrapper`) の外に出さない前提で使う。この事実を仕様として明示しておく。
- `runner` / `kind` / `status` / `origin.type` は列挙値。未知の値は拒否 (前方互換のために
  黙って通さない。台帳の版上げは `tests.config.json` の `version` で行う)。

## 3. `tests.config.json` (リポ設定)

```jsonc
{
  "version": 1,
  "repository": "LUDIARS/Augur",
  "defaultBus": "local",
  "runners": {
    "vitest": { "command": ["node", "node_modules/vitest/vitest.mjs", "run"], "selectorFlag": "-t", "reporter": "json" },
    "command": {}
  },
  "quota": {
    "default": { "max": 12 },
    "byPriority": { "critical": 24, "high": 16, "medium": 10, "low": 6 },
    "domains": {
      "test-planning-engine": { "priority": "critical" },
      "service-runtime": { "max": 8 }
    }
  },
  "retirement": {
    "probationAfterDays": 90,
    "probationAfterPasses": 30,
    "retireAfterDays": 180,
    "incidentHorizonDays": 365,
    "exemptKinds": ["guardrail"],
    "exemptAlways": true
  },
  "impact": { "callerDepth": 2 },
  "layout": { "newTestPath": "test/unit/{module}.test.ts" },
  "timeoutMs": 600000
}
```

- `quota` はビジネスドメイン単位。`domains.<name>.max` が無ければ `byPriority[priority]`、
  priority も無ければ `default.max`。**プログラムドメインには quota を置かない** (構造の
  まとまりであって「機能」ではないため。量の判断は機能 = ビジネスドメインで行う)。
  ビジネスドメイン紐づけが無いテストは仮想ドメイン `"(unowned)"` の quota に入る
  (既定 `default.max`)。
- `retirement` の意味は feature/test-lifecycle.md §4。
- `impact.callerDepth` は Anatomia `callers` を何段辿って影響範囲とするか。
- `layout.newTestPath` は新規テストの置き先テンプレート ([feature/test-authoring.md](../feature/test-authoring.md) §2.4)。
  省略時の既定は実装ファイルと同階層の `<name>.test.<ext>`。`{module}` は対象実装ファイルの
  拡張子を除いた repo-relative パス。

## 4. バス定義 (`augur.config.json` → `buses`)

```jsonc
{
  "buses": {
    "local": { "type": "local" },
    "docker-node22": {
      "type": "wrapper",
      "command": ["docker", "run", "--rm", "-v", "{cwd}:/work", "-w", "/work", "node:22", "sh", "-lc", "{cmd}"],
      "env": ["CI", "NODE_OPTIONS"]
    },
    "wsl": {
      "type": "wrapper",
      "command": ["wsl", "-e", "bash", "-lc", "cd {cwd_posix} && {cmd}"]
    }
  },
  "dataDir": ".augur-data"
}
```

| type | 動作 |
|---|---|
| `local` | 対象 worktree を cwd に、runner の argv を `spawn` (shell 無し) |
| `wrapper` | `command` の argv をテンプレート展開して spawn。`{cmd}` = runner argv を POSIX shell-quote した 1 文字列、`{cwd}` = direct argv 用の worktree 絶対パス、`{cwd_posix}` = shell 文字列用に POSIX quote した `/mnt/e/...` 形式、`{env}` は使わず `env` 配列に列挙した変数だけを子プロセスへ通す |

runner コマンドに `npx` を書かない: バスは shell 無しで spawn し、Windows の `npx` は
`.cmd` シムなので ENOENT になる。既定の vitest 起動はリポローカルの
`node node_modules/vitest/vitest.mjs` (vitest runner は `npx vitest` 前置を同形へ書き換える)。

バス型は 2 つで始める。docker / ssh / WSL / Excubitor 配下の環境はすべて `wrapper` で
表現できる (Augur は個別環境を知らない)。

## 5. `RunRecord` (実行キャッシュ)

```ts
interface RunRecord {
  runId: string;                 // "r-" + 時刻順 id (ULID 相当)
  repository: string;
  repoPath: string;              // 実行した worktree の絶対パス
  headSha: string;
  branch: string | null;
  bundle: {
    kind: "pr" | "domain" | "all" | "ids";
    selector: string | null;     // pr: base ref / domain: ドメイン名 / ids: カンマ区切り
    testIds: string[];           // 実際に選ばれた id (順序固定)
    reason: Record<string, string>; // testId → 選ばれた理由 ("anchor:…" / "always" / "domain:…")
  };
  bus: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  results: Array<{
    testId: string;
    status: "passed" | "failed" | "skipped" | "error";
    durationMs: number;
    failureMessage?: string;     // 先頭 2000 文字
    outputTail?: string;         // stdout+stderr 末尾 4000 文字
  }>;
  summary: { total: number; passed: number; failed: number; skipped: number; error: number };
  status: "passed" | "failed" | "error";   // error = ランナー自体が動かなかった
  verdict?: Verdict;
  flag?: FlagResult;
}

interface Verdict {
  decision: "accept" | "reject";
  by: string;                    // "neco" / "session:<id>" / "claude-cli"
  at: string;
  note?: string;
}

interface FlagResult {
  target: "revisor";
  pullRequestId: string;
  at: string;
  outcome: "ok" | "not_supported" | "rejected" | "error";
  detail?: string;
}
```

`status` は `results` から導出する。上から順に最初に当たった行を採る (全入力を尽くす)。

| 条件 | `status` |
|---|---|
| `failed` が 1 件以上 | `failed` |
| `error` が 1 件以上 | `error` |
| `passed` が 1 件以上 | `passed` |
| それ以外 (`results` が空、または `skipped` のみ) | `error` |

最後の行が `passed` ではなく `error` なのは、0 件実行 / 全 skip を「通った」と読ませないため
(「走っていない」は成功ではない)。バンドルがそもそも空の場合は `RunRecord` を作らず
`augur tests run` が exit 3 で終わる ([feature/test-lifecycle.md](../feature/test-lifecycle.md) §3.3)。

### 保持

`augur.config.json`:

```jsonc
{ "runCache": { "retentionDays": 30, "maxRunsPerRepository": 200 } }
```

書き込みのたびに期限切れを落とす。`verdict` か `flag` が付いた run は
`retentionDays` の 3 倍まで残す (判断の証跡)。

## 6. `TestPlan` (計画、作成側の出力)

[feature/test-authoring.md](../feature/test-authoring.md) が生成し、`augur tests author` が消費する。
既存の `PlanResponse` ([core-schema.md](./core-schema.md)) とは別物だが、`planId` の付け方は
[persistence.md](./persistence.md) と同じ。

```ts
interface TestPlan {
  planId: string;
  repository: string;
  headSha: string;
  source: { type: "pr" | "incident" | "experience"; ref: string; analysis?: string };
  status: "ready" | "blocked_by_domain" | "empty";
  blockers: string[];            // unclassified anchor 等
  targets: TestTarget[];
  dropped: Array<{ target: TestTarget; reason: "quota" | "covered" | "retired_equivalent" }>;
  quota: Record<string, { max: number; active: number; planned: number }>; // ビジネスドメイン別
}

interface TestTarget {
  key: string;                   // 決定的: kind + ":" + anchor (or incident ref)
  kind: "regression" | "assurance" | "guardrail";
  priority: "critical" | "high" | "medium" | "low";
  domains: { business: string[]; program: string[] };
  anchors: string[];             // 直接対象
  impacted: string[];            // 影響範囲 (callers)
  file: string;                  // 置き先 (既存テストファイルか新規)
  runner: TestRecord["runner"];
  brief: AuthoringBrief;
  replaces?: string;             // quota 入れ替えで退役させる既存 testId
}

interface AuthoringBrief {
  title: string;
  purpose: string;               // 何を守るか (1〜3 文、決定的テンプレートから生成)
  subject: { symbol: string; file: string; line: number; signature?: string };
  risks: string[];               // focused-testing と同じ語彙
  exemplars: Array<{ file: string; name: string }>; // 同ドメインの既存テスト (文体の手本)
  mustAssert: string[];          // 決定的に列挙できる確認点 (入力境界 / 例外 / 状態遷移)
  mustNot: string[];             // 禁止 (ネットワーク / 実 DB / sleep 依存 …)
  incident?: { log: string; failure: string; expectedAfterFix: string };
}
```

## 7. 関連

- [feature/test-lifecycle.md](../feature/test-lifecycle.md)
- [feature/test-authoring.md](../feature/test-authoring.md)
- [interface/tests-cli.md](../interface/tests-cli.md)
- [persistence.md](./persistence.md) — 既存の plan 永続化 (`PlanStore`) と同じ配置規則
