# Augur 設計宣言 (RULE_CODE 第 I 部)

Augur は目的駆動のテスト計画 & 修正方針サービス。実装に入る前の宣言 3 点
(I-1 アーキ採用観点 / I-2 目的と重視点 / I-3 設計判断) を本ファイルに明文化する。
機能仕様は [spec/feature/](./feature/)、データ形状は
[spec/data/core-schema.md](./data/core-schema.md)、API 境界は
[spec/interface/http-api.md](./interface/http-api.md) が正本。

---

## I-1. アーキテクチャ・技術スタック

**既定に従う** ([`RULE_TECH_STACK.md`](../../AIFormat/RULE_TECH_STACK.md):
Web サービス = TypeScript)。

- **ランタイム**: Node.js >= 22 / TypeScript (ESM) / tsx watch
- **HTTP**: Hono + @hono/node-server — Excubitor / Ludellus-Server と同一の
  org 標準構成。プランニングは同期の request/response で完結するため
  WS / queue は持たない。
- **バリデーション**: zod — `CreatePlanRequest` は外部 (開発者 / AI エージェント /
  CI hook) から届く信頼できない入力のため、境界で必ずスキーマ検証する。
- **テスト**: Vitest (unit / API / golden / safety)
- **ログ**: pino (Excubitor と同系)。fatal は fail-fast、swallow 禁止
  (HARNESS §3.7 / RULE_CODE §7)。
- **DB: 持たない**。プランニングは入力シグナルのみから決定される純関数的な
  変換であり、永続状態を要しない。将来永続化する場合は
  [core-schema.md](./data/core-schema.md) を保存形式の正本とする。

## I-2. 目的と重視点

**目的**: 開発者と AI コーディングエージェントが「次に何をテストすべきか」
「どう直すべきか」を、目的 (objective) と証拠 (シグナル) に基づいて判断できる
ようにする。Augur はテストを実行せず、計画と方針だけを返す託宣 (oracle) である。

**重視点** (優先順):

1. **証拠に基づくこと (evidence-grounded)** — すべての提案は入力シグナル由来の
   evidence を参照する。入力に無い事実 (テストの成否等) を捏造しない。
   ST-004 で CI 担保。
2. **決定性 (determinism)** — 同じ入力には同じ計画を返す。golden test で
   挙動変化を検知できることが、利用者 (特に AI エージェント) の信頼の土台。
3. **安全性 (non-invasive)** — テストランナーを起動しない・コードを変更しない。
   safety test で CI 担保。
4. **部分入力への寛容 (graceful degradation)** — objective さえあれば部分的な
   計画を返す (ST-005)。ただしこれは「真の capability 劣化」であり、設定不備の
   無言フォールバック (RULE_CODE §7.1) とは区別する。

衝突時は上位を優先する (例: 決定性を上げるために evidence 参照を省略しない)。

## I-3. 設計判断

### レイヤー構成 (SRP / 依存一方向)

```
src/
├── server.ts          # entry: config 読み込み → serve (bootstrap のみ)
├── app.ts             # Hono app 組み立て (routes 登録のみ)
├── config/            # 設定 loader (augur.config.json + env override)
├── routes/            # interface 層: HTTP 境界 (zod 検証 / エラー整形)
├── schema/            # data 層: core-schema.md の zod スキーマ + 推論型 (正本)
├── engine/            # domain 層: プランニング本体 (HTTP 非依存)
│   ├── normalize.ts   #   シグナル正規化 (diff / failure / coverage / runtime)
│   ├── evidence.ts    #   evidence 抽出・採番
│   ├── experience.ts / experienceSuggestions.ts  # experience budget 解決・違反判定
│   ├── focusedTesting.ts # Anatomia の重点domain/variable facts → 決定的テスト候補
│   ├── rules/         #   objective mapping (8 kind) → TestSuggestion / FixPolicy
│   ├── scoring.ts     #   優先度・confidence 決定
│   └── assemble.ts    #   決定的アセンブリ
├── catalog/           # experience goal catalog (web / game / common)
└── inject/            # log injection framework (scan / apply / check / remove)
```

- 依存方向は routes → engine/schema の一方向。engine は HTTP / Hono を import
  しない (golden test を HTTP 抜きで回すため)。
- module layout の詳細は [implementation-design.md](./implementation-design.md)
  を正本とし、本節と齟齬が出たら両方を同時に更新する (正本二重化の禁止)。
- objective ごとの提案規則は [purpose-driven-test-plan.md](./feature/purpose-driven-test-plan.md) /
  [purpose-driven-fix-policy.md](./feature/purpose-driven-fix-policy.md) の
  mapping 表をデータ (宣言的なルール表) として持ち、分岐の散在を避ける。

### 決定的ルールエンジンを核とし、LLM は将来のオプション拡張

- **採用**: 計画生成の核は決定的なルールエンジン。理由は I-2 の決定性・
  golden test 可能性・証拠追跡可能性。
- **不採用 (現段階)**: LLM による計画生成。出力が非決定的で golden test と
  相性が悪く、evidence 捏造リスクがある。将来 `AUGUR_LLM_PROVIDER` 設定時のみ
  「ルールエンジン出力の敷衍 (rationale の自然文化等)」に限定して導入する。
  その際も **設定があるのにキーが無い等の不備は fail-fast** とし、無言で
  ルールエンジンのみへ degrade しない (RULE_CODE §7.1)。

### 設定とポート

- 統合設定は `augur.config.json` (コミット可・非シークレット) を単一 loader で
  読み、env (`AUGUR_PORT` / `AUGUR_LOG_LEVEL`) の override を許容する
  (HARNESS §1: 既定値はファイル)。
- **ポートの正本は Excubitor catalog (`Excubitor/catalog/services.yaml`)**。
  本リポの設定ファイルの値は正本の写しであり、齟齬時は catalog に従う。
  プロセスの起動・停止は Excubitor 経由 (セッションから直接 spawn しない)。

### 認証境界

- tier は **personal** (本人 PC 専用の開発支援オラクル。Anatomia / Custos と
  同族)。loopback bind とし、現段階で Cernere 認証は持たない。
  外部公開 (saas 化) する場合は Cernere 集約 (RULE §1) を必須とする。
