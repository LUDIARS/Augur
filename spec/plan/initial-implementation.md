# 実装統合計画 — 二重実装の一本化 (旧: 初回実装計画)

## 経緯 — 旧計画の不備と本改訂

本ファイルの旧版は「仕様は確定済みだが**実装は未着手**」を前提に、フルセット
初回実装のタスク分解を定義していた。この前提は誤りだった:

1. **Phases 0–2 は実装・マージ済み** (commit `a186580`,
   [roadmap.md](../roadmap.md) L7)。`POST /v1/plans` と全テスト種別
   (build / unit / API / golden / safety) は旧計画の時点で既に main に存在した。
2. **レイアウトの正本が二重化**していた。旧計画は `src/planning/` 系の
   レイアウトを指示したが、既存実装は
   [implementation-design.md](../implementation-design.md) の
   `src/schema` / `src/engine` / `src/http` 系に従っており、両文書は相互参照が無い。
3. その結果、旧計画に従った**並行実装 (未追跡)** が working tree に生成された。
   このスキーマは `experienceGoals` / `project.domain` / `media_analysis` /
   `security` を欠く旧世代で、そのまま採用すると flagship 機能
   (experience-driven constraints / media-based testing) が退行する。
4. 「準備フェーズで完了済み」とした **PROJECT-CODES.md への `Ag` 登録は未実施**
   (Excubitor catalog への採番 port 4210 は実施済み)。

本改訂は計画を「初回実装」から「**二系統の統合・一本化**」に差し替える。
設計宣言 [spec/design.md](../design.md) (第 I 部 3 点) は引き続き有効。
本ファイルは作業ドキュメント (FORMAT_SPEC §5)。統合完了後は陳腐化してよい。

## 現状 (2026-07-12 時点)

| | 系統A (コミット済み) | 系統B (未追跡) |
|---|---|---|
| 構成 | `src/engine` + `src/http` + `src/schema` + `src/catalog` + `src/inject` | `src/planning` + `src/routes` + `src/config` + `src/app.ts` + `src/server.ts` |
| HTTP | Fastify / port 3000 / `0.0.0.0` bind | Hono + pino / port 4210 / loopback bind |
| スキーマ | spec 準拠 (experienceGoals / media_analysis / security 含む) | 旧世代 (上記を欠く)。strict tsconfig で型エラー |
| 配線 | package.json `dev`/`start`・CI・safety テストが参照 | どの script からも未参照 |

付随する破損:

- `node_modules` が移行中断状態: `fastify` が削除済み・`hono` /
  `@hono/node-server` が **package.json 未宣言のまま**インストール済み。
  ローカルでは build / api テスト / 起動がすべて失敗する。
- `test/golden/golden.test.ts` L10 / `test/safety/safety.test.ts` L30 が
  `new URL(...).pathname` を使い、Windows でドライブ文字が二重化して落ちる
  (`fileURLToPath` にすべき。系統B `src/config/config.ts` は正しい書き方)。
- `planResponseSchema` に `planId?` / `createdAt?` が無く
  [core-schema.md](../data/core-schema.md) L152–159 / roadmap Phase 5 の
  前提と不整合。

## ゴール

実装を一本化し、ローカル/CI とも build・全テスト種別 green、
Excubitor catalog (port 4210 / tier personal) と整合する起動経路を回復する。

**方針: engine は系統A を正、HTTP/bootstrap/config は系統B の形を正とする。**

- 系統A の `src/schema` / `src/engine` / `src/catalog` / `src/inject` は
  機能完全かつ spec 準拠なので保持する (機能退行ゼロ)。
- HTTP シェルは design.md I-1/I-3 のとおり Hono + pino + loopback +
  `augur.config.json` loader に置き換える (org 標準構成、catalog 正の port 4210)。
- 系統B の `src/planning/` (旧世代スキーマ含む) は**破棄**する。

## 非ゴール

- Phases 3–5 (CLI / LLM assistance / persistence) — roadmap のまま別 PR。
- Anatomia ドメイン連携シグナルの新設 — 末尾のメモ参照 (別計画)。
- フロントエンド — Corpus の責務。

## 実装ステップ (統合 PR)

### Step 1 — 依存整理

1. package.json: `hono` / `@hono/node-server` / `pino` を宣言、`fastify` を除去。
   `npm install` で lockfile を再生成し node_modules の中断状態を解消。

### Step 2 — HTTP 層の置換

2. 系統B の `src/server.ts` / `src/app.ts` / `src/routes/` / `src/config/` /
   `augur.config.json` を土台として採用 (loopback bind / port 4210 /
   `AUGUR_PORT` override / fatal fail-fast は実装済み)。
3. `src/routes/plans.ts` の import を `src/planning/planner` から
   **`src/engine/createPlan` + `src/schema`** へ付け替える
   (zod 検証 → createPlan → PlanResponse、400/500 整形は
   [http-api.md](../interface/http-api.md) の形を維持)。
4. `src/http/` (Fastify) と `src/planning/` (旧世代) を削除。
   package.json `dev` / `start` を `src/server.ts` に向ける。

### Step 3 — スキーマ整合

5. `src/schema/index.ts` の `planResponseSchema` に `planId?` / `createdAt?` を
   追加 (core-schema.md と一致させる。値の発行は Phase 5)。

### Step 4 — テスト修復・追随

6. Windows パスバグ修正: golden / safety テストの `.pathname` を
   `fileURLToPath(new URL(...))` に統一。
7. api テストを Hono に追随 (`app.fetch` ベース)。golden はエンジン直呼びの
   ため無変更で green を維持することを確認 (決定性の担保)。
8. safety テストの走査対象に `src/routes` / `src/config` / `src/app.ts` /
   `src/server.ts` を追加 (エンジン純粋性チェックの範囲を新シェルへ拡張)。

### Step 5 — 実経路裏取り・登録整合

9. 実経路裏取り: Excubitor 経由で起動 (事前に Concordia testing claim) →
   実 HTTP で `127.0.0.1:4210` の `/v1/health` / `/v1/plans` を確認
   (HARNESS §3.4)。
10. [local-development.md](../setup/local-development.md) を統合後の実態に同期。
11. LUDIARS/PROJECT-CODES.md へ `Ag` Augur を登録 (**別リポのため別 PR**。
    旧計画が完了済みと誤記していた項目)。

### Step 6 — 文書整合

12. [implementation-design.md](../implementation-design.md) の module layout を
    統合後の実態 (`src/engine/*.ts` 単一ファイル構成 + Hono シェル) に同期し、
    design.md I-3 と相互参照させる (正本の二重化の再発防止)。

## 影響範囲・ロールバック

- 影響は Augur リポ内に閉じる (Anatomia 側ブリッジは port 4210 を既定参照
  しており、統合で初めて整合する。統合前から不通なので破壊は無い)。
- ロールバックは PR revert のみで完了する (DB / migration 無し)。

## Anatomia 連携メモ (別計画の種)

Anatomia 側には既に `POST /v1/plans` ブリッジがある
(`src/adapters/web/routes/test-suggestions.ts`、既定 `127.0.0.1:4210`)。
ただし現状はカウント値のみでドメイン情報を送っていない。Anatomia の
domain-view / domain-review / readableSpecs は、現行スキーマのままでも
`change.changedFiles` (implementor のファイル群) / `constraints` (scope) /
`experienceGoals` (readableSpecs 由来) へ写像可能。ドメイン専用シグナルの
新設は Phase 3 (CLI) 以降で別計画として起こす。
なお `project.domain` (web/game/service/other) は Anatomia のドメイン概念とは
別物 (名前衝突) であり、ここに流し込まないこと。

## 進め方

- branch → 1 PR 集約 → CI green → squash merge (HARNESS §3.3)。
- 同一実装 3 回失敗で方式から作り直す (three-out-rule)。
