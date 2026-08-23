---
title: Augur test management — テストの自動作成・実行・管理
type: plan
service: augur
domain: test-lifecycle
status: planned
tags:
  - test-lifecycle
  - anatomia-dual-layer
  - revisor
  - workflow
updated: 2026-08-23
---

# Augur テスト管理計画 (neco 指示 2026-08-23)

Augur を「テスト計画を返す CLI」から「**ドメイン単位でテストを作り、束ねて実行し、
結果を保持し、Revisor へ保証フラグを立てる**テストライフサイクル管理ツール」へ拡張する。

設計の正本は次の 6 本。本書はそれらを束ねる決定・ワークフロー・段階・委託分割を持つ。

| 文書 | 内容 |
|---|---|
| [feature/test-authoring.md](../feature/test-authoring.md) | Anatomia 二層ドメイン + 影響範囲からのテスト計画・作成、運用障害からの回帰強化 |
| [feature/test-lifecycle.md](../feature/test-lifecycle.md) | テスト台帳、ドメイン別の量の上限、バンドル実行、結果キャッシュ、段階的退役 |
| [data/test-registry.md](../data/test-registry.md) | `TestRecord` / `RunRecord` / `Verdict` / バス設定のスキーマと置き場所 |
| [interface/tests-cli.md](../interface/tests-cli.md) | `augur tests …` サブコマンド群 (正本の操作面) |
| [interface/tests-api.md](../interface/tests-api.md) | HTTP API (`augur serve`) と MCP (`augur mcp`, stdio) |
| [interface/revisor-verification.md](../interface/revisor-verification.md) | Augur → Revisor の保証フラグ契約 (Revisor 側の実装は別リポ) |

## 1. 決定

### 1.1 Augur はテストを実行する (Non-Goal の撤回)

[roadmap.md](../roadmap.md) の Non-Goal「Executing tests or any shell command on behalf of
the caller」を撤回する。ただし Augur 自身はテストフレームワークではない。
**対象リポの既存ランナー** (vitest / cargo test / gtest / Unity Test Runner …) を、
設定された**バス** (実行環境) 越しに起動し、結果を正規化して保持するのが役割。
テストの中身 (assert) は対象リポのファイルとして存在し、Augur はそれを**台帳**で管理する。

### 1.2 「daemon-less」→「daemon-optional」

2026-07-30 の決定 ([daemonless-cli.md](./daemonless-cli.md)) は「状態を持たない純関数に
常駐プロセスは要らない」が根拠だった。本計画で Augur は**状態 (台帳・実行結果キャッシュ)**
を持つが、その状態は**すべてファイルストア** (`.augur/` 配下、→ data/test-registry.md) にある。
プロセスが状態を独占しない以上、常駐は依然として必須ではない。よって:

- **CLI が正本の操作面**。すべての機能は `augur tests …` で完結する。
- **MCP は stdio** (`augur mcp`)。クライアント (Claude Code / Concordia) が必要時に spawn する。
  ポート無し・常駐無し。
- **HTTP API は opt-in** (`augur serve`、loopback)。CLI と同じ operations 層を呼ぶだけで、
  サーバ固有の状態を持たない。Excubitor catalog には `autostart: false` で再登録する。
  止まっていても CLI / MCP は動く。

この結果、Phase 6「Daemon Removal」(A3、`chore/remove-daemon`) は**取り下げ**る。
既存の Hono シェル (`src/app.ts` / `src/routes/`) は `augur serve` の土台として残し、
`/v1/plans` もそのまま残す (Anatomia ブリッジは既に CLI 経由なので呼ばれないが、削る理由も無い)。
`npm start` は `augur serve` に付け替える。

### 1.3 テストの作成は「決定的計画 + 生成器」に分ける

Augur の原則 (engine は決定的、LLM は任意の付加) を保つ。

- **どこに・どの種類の・いくつ**テストを置くかは決定的に決める (= `augur tests plan`)。
  入力は Anatomia の `pr-review` (二層ドメイン + 変更 anchor) と `callers` (影響範囲)。
- **テストコードそのもの**は生成器が書く (= `augur tests author`)。生成器は 2 系統:
  - `session` (既定): 計画を**作成ブリーフ**として返し、呼び出し元のセッション LLM が書く。
    MCP / API 経由の主経路。
  - `claude-cli`: Augur が `claude -p --model <固定>` を spawn して書かせる。人手が無い経路
    (運用障害からの回帰追加、夜間バッチ) 用。API キーは持たない (`claude` CLI に委ねる)。
- 生成されたテストは**必ずバスで一度実行**し、通るものだけ台帳に `active` で載せる。
  (回帰テストが「直す前は落ち、直した後は通る」ことを確認する経路は
  feature/test-authoring.md §4)

### 1.4 量は「ドメインごとの上限」で抑え、古いものは退役させる

テストは増やすほど良いものではない。ドメインごとに上限 (quota) を持ち、上限に達したら
**既存の低価値テストと入れ替える**か、計画段階で落とす。長期間落ちていないテストは
`probation` → `retired` と段階的に外す。詳細は feature/test-lifecycle.md §4。

## 2. ワークフロー

neco 指示の 6 ステップを、担当・Augur の操作・受け渡すデータで固定する。

| # | ステップ | 担当 | Augur 操作 / データ |
|---|---|---|---|
| 1 | 実装作成 | セッション | worktree で実装。Augur は関与しない |
| 2 | ドメインチェック | Revisor または Augur | `anatomia pr-review --repo <wt> --json` → `PrDiffReview`。Revisor は自分の gate で実行済みの結果を `augur tests plan --analysis <file>` で渡せる。Augur 単独なら `augur tests plan --analyze` が Anatomia CLI を spawn する。`domain.dualLayer.unclassifiedAnchors` が残る場合、計画は `blocked_by_domain` で止まる (テストを置くドメインが決まらないため) |
| 3 | テスト計画・作成 | Augur | `augur tests plan` → `TestPlan` (targets + quota 判定)。`augur tests author` → テストファイル + 台帳エントリ (`candidate`)。生成後に 1 回実行して `active` 化 |
| 4 | テスト実行 | Augur | `augur tests run --bundle pr --head <sha> --bus <name>` → `RunRecord` (キャッシュ)。バンドル = PR 影響ドメインのテスト ∪ `always` テスト |
| 5 | 判断 | セッション LLM・人間 | `augur tests report <runId>` を読み、`augur tests verdict <runId> --accept\|--reject --by <who> [--note]`。判断は `Verdict` として run に紐づく |
| 6 | フラグ | Augur / Revisor | `augur tests flag <runId>` → Revisor `POST /api/local-prs/:id/verification` (→ interface/revisor-verification.md)。Revisor は `externalVerification` を記録し、動作確認要否スコアから差し引く |

運用障害からの強化 (neco 指示後半) は 2〜3 の別入口: `augur tests plan --incident <file>`
(→ feature/test-authoring.md §4)。入力は問題ログ / Vestigium JSONL / 失敗した RunRecord。

### 2.1 Revisor との二経路

- **push 経路 (本命)**: ステップ 6 の `augur tests flag`。人間 / セッションの判断を経てから立つ。
- **pull 経路 (補助)**: Revisor の登録テストケースに
  `node <augurFolder>/bin/augur.mjs tests run --bundle pr --json --for-revisor` を `runtime: true`
  で登録すると、Revisor が審査中に Augur バンドルを走らせ、既存の merge-risk 規則
  (`runtime: true` の登録テスト通過 = −40) がそのまま効く。Revisor 側の変更は不要。
  両経路は併用してよい。

## 3. 段階

依存順。各段階は 1 PR を想定し、段階内はフルセット (MVP で縮めない)。

| 段階 | 範囲 | 正本 |
|---|---|---|
| **T1 台帳・バス・実行・キャッシュ** | `src/tests/` (registry / store)、`src/bus/` (local + wrapper)、`augur tests list\|run\|report\|verdict\|sweep`、`.augur/` ストア、退役ポリシー | feature/test-lifecycle.md, data/test-registry.md, interface/tests-cli.md |
| **T2 計画・作成** | `augur tests plan\|author`、Anatomia `pr-review` / `callers` の取り込み、quota 判定、incident 入口、`session` / `claude-cli` 生成器 | feature/test-authoring.md |
| **T3 API / MCP** | `augur serve` (HTTP) と `augur mcp` (stdio)、operations 層の共有、Excubitor catalog 再登録 | interface/tests-api.md |
| **T4 Revisor フラグ** | Revisor リポ: `POST /api/local-prs/:id/verification`、`externalVerification` 記録、merge-risk / pr-disposition 反映、board 表示。Augur 側 `augur tests flag` は T1 の CLI に含む (Revisor 未対応時は 404 を `not_supported` として報告) | interface/revisor-verification.md |

T1 と T4 は独立 (並行可)。T2 / T3 は T1 の `src/tests/` に依存する。

## 4. 委託

neco 指示: 設計を詰め、必要な実装は **Codex-Sol の xhigh** に委託する。

| 委託 | リポ | 範囲 | 前提 |
|---|---|---|---|
| Sol-A | Augur | T1 + T3 (管理側一式: 台帳・バス・実行・キャッシュ・退役・CLI・API・MCP) | 本 spec ブランチ |
| Sol-B | Augur | T2 (作成側: plan / author / incident) | Sol-A の PR が open になってから (台帳モジュールに依存) |
| Sol-C | Revisor | T4 | Augur 側契約 (interface/revisor-verification.md) |

委託プロンプトには Anatomia の着地確認 (`where`) → ドメイン宣言 (spec/domains) →
`verify` の 3 行 (Concordia 実装テンプレ標準) を含める。新規ディレクトリは同 PR で
`spec/domains/test-lifecycle.domain.json` の membership に載せる (本ブランチで先に宣言済み)。

## 5. 既存文書への影響

- [roadmap.md](../roadmap.md): Phase 6 を「daemon-optional」に置換、Non-Goal から実行禁止を外す。
  新 Phase T1〜T4 を追記。
- [daemonless-cli.md](./daemonless-cli.md): §決定に本書への supersession 注記を足す (本文は
  履歴として残す)。
- [implementation-design.md](../implementation-design.md): Module Layout に `src/tests/`
  `src/bus/` `src/operations/` `src/mcp/` を追記 (委託 Sol-A の範囲)。
- README: 冒頭の「no resident process」の段落を daemon-optional に改める。

## 6. 決めていないこと (neco 判断待ちではなく、実装で決めてよいもの)

- `.augur/` ストアの形式: JSONL (台帳) + SQLite (run キャッシュ) を既定とするが、
  T1 実装時に `node:sqlite` の可用性 (Node 22.5+) を見て JSONL 一本でも可。
  インターフェース (`TestStore` / `RunStore`) を守れば差し替え自由。
- バス `wrapper` のテンプレート変数は `{cmd}` `{cwd}` `{cwd_posix}` の 3 つで始め、必要に
  なってから足す (環境変数はテンプレート展開せず、`env` allow-list で子プロセスへ渡す
  → [data/test-registry.md](../data/test-registry.md) §4)。
