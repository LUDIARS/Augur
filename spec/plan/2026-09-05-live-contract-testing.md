---
title: 契約プログラミングによる委託受け入れとオンライブテスト
type: plan
service: augur
domain: plan-injection
status: planned
tags:
  - design-by-contract
  - log-injection
  - delegation-acceptance
  - concordia
  - revisor
  - lapilli
updated: 2026-09-05
---

# 契約プログラミングによる委託受け入れとオンライブテスト (neco 指示 2026-09-05)

委託 (Concordia delegation) の**受け入れ条件を契約 (事前条件・事後条件・不変条件) として
機械可読に書き**、新規実装した関数に**契約検査ラッパーを注入**して、実際に動いている間の
呼び出しが契約を満たしているかを**ログで判定する**。これを「オンライブテスト」と呼ぶ。

ラッパーは観測のみで関数の意味論を変えず、マーカー方式で副作用なく外せる。
既存の [Log Injection Framework](../feature/log-injection.md) (scan → apply → check → remove、
`@ludiars/log-weaver` ランタイム) の延長として作り、判定結果は
[テスト管理](./test-management.md) の verdict と [Revisor 保証フラグ](../interface/revisor-verification.md)
の材料にする。

---

## 1. 使い方 (UX)

### 1.1 委託する側 (neco / セッション LLM)

1. 委託テンプレの受け入れ条件を、文章ではなく**契約の見出し**で書く。

   ```
   受け入れ条件 (契約):
   - C-1 resolveBudget(goal): goal.kind が既知値なら budget.ms > 0 を返す
   - C-2 applyPlan(plan, registry): 戻りの registry.size >= 入力の size (登録は減らない)
   - C-3 flagRevisor(run): run.status !== "passed" なら throw し、Revisor を呼ばない
   ```

2. 受託 AI は**実装より先に**契約ファイルを書く (§3)。契約 id `C-1`… は Concordia の
   `acceptance_report[].criterion` の先頭トークンになる。
3. 完了報告を受けたら
   `augur contracts report --acceptance --json --since <delegation.startedAt>` を見る。
   `met` は受託 AI の自己申告ではなく、**注入ラッパーが記録した実呼び出しの集計**から出る。

### 1.2 受託する側 (委託 AI)

```text
# DELEGATION_STARTED_AT は Concordia が渡す委託開始時刻 (UTC ISO 8601)

# 1. 契約を書く (実装より先)
$EDITOR contracts/resolve-budget.contract.ts     # pre / post / invariant を関数で書く
$EDITOR augur.contracts.json                      # id / symbol / file / criterion

# 2. 実装する

# 3. 新規関数へラッパーを注入する (マーカー付き、Anatomia の diff から新規関数を特定)
augur inject apply --project . --rule contract-wrap --diff-base main

# 4. 委託開始時刻以後に動かす (オンライブ)。テストでも手動起動でも、呼ばれた分が weaver JSONL に溜まる
npm test / npm run dev / 実際の操作

# 5. 判定材料を見る
augur contracts report --project . --since "$DELEGATION_STARTED_AT"
#  covered   C-1 resolveBudget    calls 42  violations 0
#  violated  C-2 applyPlan        calls 7   violations 2  (post: registry shrank  src/tests/registry.ts:88)
#  uncovered C-3 flagRevisor      calls 0

# 6. 違反を直す → 4〜5 を繰り返す → 完了報告に acceptance_report を載せる
augur contracts report --project . --acceptance --json --since "$DELEGATION_STARTED_AT" # → そのまま報告 JSON へ
```

注入は PR に**含めたまま提出してよい** (マーカー付きで機械所有、レビュー時に読み飛ばせる)。
外すのは判断後 (§7)。

### 1.3 判断する側 (Revisor / neco)

- Revisor の local PR 画面に `contracts: covered 2 / violated 0 / uncovered 1` が出る
  (保証フラグの `summary` 拡張、§6.3)。
- `uncovered` が残る契約は「動かしていない = 受け入れ判断できない」なので、
  受け入れ条件未達として扱う。自己申告の `met: true` より集計を優先する
  (自己申告だけでは、実際に呼び出された経路を検証した証拠にならないため)。

---

## 2. 決定 (核)

### 2.1 受け入れ条件は契約として書く

受け入れ条件は「〜が動くこと」という文章では機械が判定できない。
契約プログラミングの 3 要素に落とす:

| 要素 | 意味 | 判定タイミング |
|---|---|---|
| **事前条件 (pre)** | 関数が正しく**呼ばれて**いるか。引数の形・範囲・状態 | 呼び出し直前 |
| **事後条件 (post)** | 関数が正しく**返して**いるか。戻り値と引数の関係、throw の有無 | 戻り/throw 直後 |
| **不変条件 (invariant)** | 呼び出し前後で保たれる性質。対象オブジェクトの整合 | 前後 2 回 |

事前条件違反は**呼び出し側のバグ** (受託 AI が配線を間違えた / 既存コードが想定外の値を渡す)、
事後条件違反は**実装のバグ**、と原因の帰属が分かれる。ログには必ず `phase: pre|post|invariant`
を載せ、判断者が「どちらを直すか」を読めるようにする。

### 2.2 ラッパーは観測のみ、意味論を変えない

`guardAsync` (例外を記録して飲む = 挙動を変える) ではなく、`aspect` (戻り値と throw を透過し、
観測だけ差し込む) の系統に置く。契約違反を検知しても**既定では throw しない**
(`mode: "observe"`)。理由:

- 委託中の稼働は「まず動かして観測する」段階で、契約側が間違っていることも多い。
  違反で止めると実装バグと契約バグの切り分けが遅れる。
- 運用 (§7 の窓 b) に置く場合、契約が本番を止めてはならない。

`mode: "enforce"` (違反で `ContractViolationError` を throw) は契約ファイル単位の opt-in で、
ユニットテスト実行時のみ使う想定。C1 では sink の環境変数優先順位も明文化し、
`LOG_WEAVER=0` は常に無効、`LOG_WEAVER=1` は test 環境でも明示的に有効、それ以外は
`NODE_ENV=test` / `VITEST` で no-op とする。したがって test 環境で observe のイベントを
集めるときは `LOG_WEAVER=1` が必要で、enforce だけなら sink は不要。

### 2.3 注入は log-injection の新 rule `contract-wrap`

新規に注入機構を作らない。[Log Injection Framework](../feature/log-injection.md) に rule を 1 つ足す。

- **対象の決め方**: `augur.contracts.json` に `symbol` + `file` が書かれている関数。
  「新規実装した関数」の特定は Anatomia `pr-review` の `diff.functions.added` を照合して行い
  (`--diff-base main`)、契約はあるが diff に無い関数 (既存関数への契約) は `--include-existing`
  を付けたときだけ対象にする。委託受け入れの既定は新規関数のみ。
- **マーカー**: `/* augur-inject:contract-wrap:<id8> */`。`apply` は既マーカーをスキップ、
  `check` は契約ファイルと突き合わせて `applied / pending / orphaned`、`remove` で元のバイト列に戻す。
  この 4 動作は既存と同じ。
- **既存ルールとの違い**: 既存 4 rule は「危険な継ぎ目」をスキャナが**発見**するが、
  `contract-wrap` は契約ファイルが**指名**した関数に置く。スキャナはコードを解釈しない。

### 2.4 オンライブテスト = 稼働中の実呼び出しを判定材料にする

テストケースを書いて入力を作るのではなく、**実際に動いた呼び出し**が契約を満たしたかを見る。
ラッパーが emit する `WeaverEvent` は既存の sink (Vestigium JSONL) に流れ、
`augur contracts report` がそれを契約 id ごとに集計する。

利点: 委託 AI が用意した入力ではなく、既存コードが実際に渡す値で検査される。
限界: 呼ばれない経路は判定できない (`uncovered`)。だからこそ `uncovered` を「未達」と扱う (§1.3)。

### 2.5 判定材料はあくまで材料

Augur は集計を返すだけで、受け入れ可否を決めない。決めるのは verdict
(`augur tests verdict`) を打つ人間かセッション LLM で、Revisor 保証フラグの
「判断の無い自動フラグは作らない」原則 ([revisor-verification.md](../interface/revisor-verification.md) §1)
をそのまま守る。

---

## 3. 契約の表現 (data)

### 3.1 2 ファイル構成

述語を JSON の式文字列で書いて `eval` する案は却下 (§11)。述語は**対象リポの TypeScript**、
メタ情報は JSON、の 2 層にする。

`augur.contracts.json` (対象リポ直下、`augur.inject.json` と並置):

```json
{
  "version": 1,
  "contractsDir": "contracts",
  "importFrom": "@ludiars/log-weaver",
  "contracts": [
    {
      "id": "C-1",
      "criterion": "C-1 resolveBudget(goal): goal.kind が既知値なら budget.ms > 0 を返す",
      "symbol": "resolveBudget",
      "file": "src/engine/budget.ts",
      "module": "./contracts/resolve-budget.contract.ts",
      "mode": "observe",
      "sample": 1
    }
  ]
}
```

| フィールド | 意味 |
|---|---|
| `id` | 契約 id。Concordia `acceptance_report[].criterion` の先頭トークンと一致させる (`C-1`) |
| `criterion` | id から始まる人間向けの受け入れ条件全文。report の見出しと `acceptance_report[].criterion` に byte-for-byte で出す |
| `symbol` / `file` | 注入先。Anatomia の anchor (`file:symbol`) と同じ粒度。クラスメソッドは `Class.method` |
| `module` | 述語モジュール (§3.2)。対象リポからの相対パス |
| `mode` | `observe` (既定) / `enforce` (§2.2) |
| `sample` | 0〜1。高頻度関数の運用観測を間引く。既定 1 (全件)。acceptance 判定では 1 必須 |

### 3.2 述語モジュール

```ts
// contracts/resolve-budget.contract.ts
import type { Contract } from '@ludiars/log-weaver';
import type { Goal, Budget } from '../src/engine/budget.ts';

const KNOWN = new Set(['instant', 'fast', 'normal']);

export default {
  pre: (goal: Goal) => KNOWN.has(goal.kind) || 'unknown goal.kind',
  post: (result: Budget, goal: Goal) => result.ms > 0 || 'budget.ms must be positive',
} satisfies Contract<[Goal], Budget>;
```

- 述語は `true` で合格、`false` か**文字列 (理由)** で違反。理由文字列がそのまま `ctx.reason` になる。
- `post` は `(result, ...args)`、throw した場合は `postThrow?: (err, ...args)` が呼ばれる
  (「throw することが契約」を書ける。§1.1 の C-3)。
- `invariant?: (self, ...args) => true | string` はメソッド契約用。前後 2 回呼ばれる。
- 述語は**純粋**であること。ログに載せる値は述語が返す文字列だけで、引数や戻り値そのものは
  自動では載せない。理由文字列にも token、PII、raw command / prompt、任意の引数値・戻り値を
  入れてはならない (Vg の機微情報ルールを継承)。理由は固定の分類文を既定とし、値が必要なら
  機微情報でないことを契約作者が確認した allow-list 済みの列挙値または集計値だけを載せる。
- 述語モジュールはテストと同じ扱いのリポ資産で、注入を外しても残す。ユニットテストから
  `contract.pre(...)` を直接呼んで契約自体をテストできる。

### 3.3 述語が throw したら

契約側のバグ。`emit('warn', 'contract predicate threw', …)` を出して**合格扱いにしない**
(`phase: "predicate"` の違反として数える)。`mode` にかかわらず predicate 自身の例外は
`ContractViolationError` に変換せず、対象関数の実行・戻り・throw を妨げない。

---

## 4. ランタイム (Lapilli `@ludiars/log-weaver`)

`aspect()` と並べて `contract()` を足す。

```ts
export interface ContractSpec<A extends unknown[], R> {
  contractId: string;
  pre?: (...args: A) => true | false | string;
  post?: (result: Awaited<R>, ...args: A) => true | false | string;
  postThrow?: (err: unknown, ...args: A) => true | false | string;
  invariant?: (self: unknown, ...args: A) => true | false | string;
  mode?: 'observe' | 'enforce';
  sample?: number;
}
export type Contract<A extends unknown[], R> = Omit<ContractSpec<A, R>, 'contractId'>;

export function contract<T, A extends unknown[], R>(
  fn: (this: T, ...args: A) => R,
  spec: ContractSpec<A, R> & Where,
): (this: T, ...args: A) => R;
```

- sync / async 両対応 (`aspect` と同じ Promise 判定)。`this` を透過する (メソッド用)。
- `contractId` は manifest の契約 id、`Where.id` は既存 log-injection の marker id として分ける。
  ランタイムは前者をイベントの `ctx.contract`、後者を `ctx.id` に出す。
- observe では同期値と同期 throw をそのまま伝播する。async では post / postThrow を settlement 後に
  評価するため Promise オブジェクトの同一性は保証せず、fulfillment 値と rejection reason を保つ。
  `enforce` のときだけ契約違反で `ContractViolationError` を throw / reject する
  (元の戻り値を捨てる。enforce はテスト専用)。
- enforce の pre / 呼び出し前 invariant 違反は元関数を呼ばずに throw し、post / 呼び出し後
  invariant 違反は戻り値を捨てて throw、postThrow 違反は元の rejection reason を置き換えて reject する。
- emit するイベント:

```json
{ "level": "error", "msg": "contract violated",
  "ctx": { "contract": "C-2", "phase": "post", "reason": "registry shrank 12→9",
           "where": "src/tests/registry.ts:88", "rule": "contract-wrap", "id": "3f9a12bc",
           "observed_at": "2026-09-05T00:00:00.000Z", "duration_ms": 3 } }
{ "level": "debug", "msg": "contract observed",
  "ctx": { "contract": "C-2", "phase": "ok", "where": "…", "rule": "contract-wrap", "id": "…",
           "observed_at": "2026-09-05T00:00:00.000Z" } }
```

  合格も `debug` で 1 行出す。これが無いと `covered` (呼ばれて違反 0) と `uncovered`
  (呼ばれていない) を区別できない。量が問題になる関数は `sample` で間引く。
- `observed_at` は UTC ISO 8601 でランタイムが付ける。集計は manifest の契約 id だけでなく、
  `check` が現行ソースから解決した `rule:contract-wrap` + marker `id` と一致するイベントだけを読む。
  これにより別リポジトリの同名契約や、再注入前の古い marker のイベントを混ぜない。
- §2.2 の優先順位で sink が no-op のときもコストは述語評価だけ。述語すら走らせたくなければ
  `remove` する。

---

## 5. 注入 (Augur `src/inject/` 新 rule `contract-wrap`)

### 5.1 対象の 3 形

対象リポは全て ESM / TypeScript。関数の宣言形ごとに注入の形が違う。いずれも
**挿入 (と最小の削除) だけ**で、周囲のバイト列は変えない (既存の設計判断「AST 再印字しない」)。

| 宣言形 | 注入 | 備考 |
|---|---|---|
| `export const f = (…) => {…}` / `= async function …` | 初期化子を `contract(` … `, spec) /*m*/` で包む | `interval-guard` と同じ wrap |
| `export function f(…) {…}` | `export ` を消して直後に `export const f = contract(f_, spec); /*m*/` を足す方式は**採らない**。代わりに宣言はそのまま残し、宣言の直後に `f = contract(f, spec); /*m*/` を置く | TS が関数宣言への代入を拒む (TS2630) ため、注入行を `// @ts-expect-error augur-inject` 付きにする。関数宣言の hoisting はそのまま保てる |
| クラスメソッド `m(…) {…}` | クラス宣言の直後に `C.prototype.m = contract(C.prototype.m, { …, invariant }); /*m*/` | `static` は `C.m = …`。private (`#m`) は対象外 |

`apply` は契約 1 件につき import (`contract` と述語モジュールの default import、ともにマーカー付き
行) と本体の 1〜2 編集を計算する。`remove` はマーカーから逆順に戻す。
述語モジュールへの import specifier は、manifest にある対象リポルート相対の `module` を
注入先ファイルからの相対 specifier に正規化する。生成する呼び出しは概念的に
`contract(original, { ...predicate, contractId: 'C-1', mode: 'observe', sample: 1,
where: 'src/…:line', rule: 'contract-wrap', id: '<marker-id>' })` とし、manifest が持つ実行設定と
既存 `Where` の位置情報を述語 object に合成する。
`file` / `module` / `contractsDir` はプロジェクト内に収まる相対 path に限定し、絶対 path・
traversal・制御文字・プロジェクト外へ解決する symlink は注入前に拒否する。
`contract` の import 元は `augur.contracts.json#importFrom`、既存 rule の import 元は
`augur.inject.json#importFrom` とし、異なる場合は別々の marker 付き import を生成する。

### 5.2 `check` の追加状態

既存の `applied / pending / orphaned` に加え、契約ファイル側との不整合を返す:

| 状態 | 意味 |
|---|---|
| `unresolved` | `augur.contracts.json` の `file:symbol` がソースに無い (関数名を変えた) |
| `stale-module` | 述語モジュールが無い / default export が `Contract` の形でない |

`check --strict` はこれらでも非 0。

### 5.3 Anatomia との照合 (`--diff-base`)

`anatomia pr-review --repo <wt> --base <base> --json` の `diff.functions.added` を読み、
契約の `file:symbol` が新規関数集合に含まれるものだけ `pending` にする。
Revisor が gate で作った `PrDiffReview` を `--analysis <file>` で渡せる経路も
`augur tests plan` と同じ形で持つ (Anatomia を二度回さない)。
Anatomia 未導入のリポでは `--diff-base` 無しで契約ファイルの指名を全て対象にする。

---

## 6. 集計と判定 (`augur contracts`)

### 6.1 サブコマンド

| コマンド | 内容 |
|---|---|
| `augur contracts lint --project <dir>` | `augur.contracts.json` と述語モジュールの整合検査 (id 重複、`file:symbol` 実在、default export の形) |
| `augur contracts report --project <dir> [--logs <dir>] [--since <iso>\|--all] [--json\|--markdown]` | weaver JSONL を現行 marker id + 契約 id ごとに集計 |
| `augur contracts report --acceptance --json --since <iso>` | Concordia の `acceptance_report` 形 `[{criterion, met, note}]` に整形 |

`--logs` の既定は log-weaver の解決規則と同じ (`VESTIGIUM_LOGS_DIR` → `<cwd>/logs`)。
古い違反を次の委託の判定へ混ぜないため、単独の `report` は `--since` または診断用の
`--all` のどちらかを必須とし、`--acceptance` では `--all` を許可しない。時刻を解釈できない
イベントは診断件数に数えるが acceptance 集計から除外し、警告を返す。
また、間引きで「呼ばれたが記録されなかった」を `uncovered` と誤認しないよう、`--acceptance` は
対象契約の `sample` がすべて 1 でなければ usage error にする。`sample < 1` は §7 (b) の
運用観測と診断用 `report` にだけ使う。

### 6.2 集計の状態

| 状態 | 条件 |
|---|---|
| `covered` | `contract observed` が 1 件以上、`contract violated` / `contract predicate threw` が 0 件 |
| `violated` | `contract violated` または `contract predicate threw` が 1 件以上 (phase 別に件数と最新 3 件の理由を添える) |
| `uncovered` | どちらも 0 件 (注入されていない、または呼ばれていない。`check` の結果で区別して表示) |

`--acceptance` の `met` は `covered` のときだけ `true`。`note` に `calls` / `violations` /
最新の理由を入れる。同じ入力 (JSONL + 契約ファイル) からは byte-identical な出力を返す。

### 6.3 verdict と Revisor 保証フラグへの合流

- `augur tests report <runId>` に `contracts` 節を足し、`observed_at` が run の
  `[startedAt, finishedAt]` に入る weaver イベントの集計を並べる。
  判断者は 1 画面でテスト結果と契約観測を見る。
- `augur tests flag` の Revisor 送信 `summary` に `contracts: { covered, violated, uncovered }` を足す
  (Revisor 側は表示のみの小変更、[revisor-verification.md](../interface/revisor-verification.md) の追補)。
- Revisor の disposition ロジックは変えない。`violated > 0` でもフラグは人間の verdict 次第。

---

## 7. 外し方と観測の窓

**外し方**: `augur inject remove --project <dir> --rule contract-wrap`。マーカー行と wrap を消し、
述語モジュールと `augur.contracts.json` は残す。残したファイルは import されないので実行時に
何も起きない。`remove` 後の `git diff` が注入前と一致することを `test/safety/` の往復テスト
(既存 rule と同じ golden) で保証する。

**観測の窓**は 2 つ。既定は (a)。

| 窓 | いつ | 誰が外す |
|---|---|---|
| (a) 委託中のローカル稼働 | 受託 AI が実装後にテスト・手動起動で動かす間 | 受託 AI は**外さずに提出**。判断者が verdict 後に `remove` を含む後始末 PR を出すか、マージ前の autofix で外す |
| (b) マージ後の運用 | neco が指定した契約だけ本番で観測を続ける | 観測期間終了後に `remove`。契約は退役テストと同じく台帳で管理 (将来) |

(b) は本設計では入口だけ用意し (JSON の `mode` と `sample` があれば運用に置ける)、
台帳連携 (test-lifecycle の退役ポリシーに載せる) は次段に回す。

---

## 8. Concordia 連携

契約プログラミングの本質は「受け入れ条件を実装より先に、検証可能な形で書く」こと。
Concordia 側では次の 3 点で成立させる。

1. **委託テンプレの受け入れ条件欄を契約書式にする** (`C-n <symbol>(…): <条件>`)。
   `implementation-inject.ts` の受け入れ条件セクションに、契約ファイルを先に書く手順と
   `augur inject apply --rule contract-wrap` /
   `augur contracts report --acceptance --json --since <delegation.startedAt>` を注入する。
   Codex 委託は Augur CLI の呼び方 (`node <Augur>/bin/augur.mjs …`) を明記する
   (対象 worktree からも実行ファイルを一意に解決できるようにするため)。
2. **完了報告の `acceptance_report` と Augur 集計の突合**。`completion-evidence.ts` に
   「契約付き委託なら worktree で
   `augur contracts report --acceptance --json --since <delegation.startedAt>` を走らせ、
   自己申告の `met` と一致しない項目を `unmet acceptance` として拒否する」検査を足す。
   契約ファイルが無い委託 (契約書式で書かれていない) は従来通り通す。
3. **Revisor local PR 画面の `contracts` 表示** (§6.3) で判断者が読む。

これらは Concordia / Revisor リポの変更で、本計画の委託 C4 / C5 (§9)。

---

## 9. 段階と委託分割

| 段階 | リポ | 内容 | 依存 |
|---|---|---|---|
| **C1 ランタイム** | Lapilli | `contract()` / `ContractSpec` / `ContractViolationError` を log-weaver に追加、sync/async/this 透過、observe/enforce、sample、`predicate threw` の扱い、単体テスト | 無し |
| **C2 契約ファイルと注入** | Augur | `augur.contracts.json` schema (zod)、`augur contracts lint`、inject rule `contract-wrap` (3 形の apply / remove / check 追加状態)、`--diff-base` / `--analysis` の Anatomia 照合、往復 golden テスト | C1 の型 (仮に `contract` 名だけあれば apply は書ける) |
| **C3 集計** | Augur | `augur contracts report` (集計・`--acceptance`・byte-identical)、`augur tests report` の `contracts` 節、`flag` の summary 拡張 | C2 |
| **C4 委託連携** | Concordia | テンプレ受け入れ条件の契約書式、`completion-evidence` の突合 | C3 |
| **C5 表示** | Revisor | `verification.summary.contracts` の受理と local PR 画面表示 | C3 |

C1 と C2 は並行可。C4 / C5 は小さいので 1 委託にまとめてもよい。
各段階の受け入れ条件は本設計の方式で書く (§12、dogfooding)。

新規コードのドメイン:
`src/inject/` 配下は既存 `plan-injection`、`src/contracts/` (集計・schema) は新ドメイン
`contract-observation` を `spec/domains/` に追加する。

---

## 10. 非目標

- 静的検証をしない。契約は実行時にしか評価されず、型検査や証明の代わりではない。
- TS / ESM 以外 (Rust / C++ / C# / Unity) の関数は v1 対象外。Pictor や Ludellus-Native は
  別の注入手段が要る (ログ形式は同じ `WeaverEvent` に寄せる)。
- 契約から入力を生成するプロパティテストはしない (それは `augur tests author` の仕事)。
- `enforce` を本番で使わない。

---

## 11. 却下した案

- **JSON 内の式文字列を `eval` する述語 DSL** — 安全性と型の両方を失う。TS モジュールなら
  述語自体をテストでき、IDE の補完も効く。
- **Proxy でモジュール全体を包む** — どの関数に契約があるか読めなくなり、`remove` も
  できない。マーカー方式の「機械所有・可視・可逆」を崩す。
- **呼び出し側 (call site) への注入** — 呼び出し箇所が増えるたびに注入点が増え、
  事前条件の帰属 (誰が間違って呼んだか) は取れるが事後条件・不変条件を一元化できない。
  定義側 1 箇所に置き、事前条件違反のスタックで呼び出し元を追う。
- **違反で throw を既定にする** — §2.2。観測段階で止めると切り分けが遅れ、運用で止めると事故。
- **契約を Augur 側 (`.augur/`) に置く** — 述語は対象リポの型に依存するので対象リポ内が正。
  Augur は指名と集計だけを持つ。
- **合格ログを出さない (違反だけ記録)** — `covered` と `uncovered` が区別できず、
  「違反 0」が「呼ばれていない」と同義になる。`sample` で量を抑える方を採る。

---

## 12. 本設計の受け入れ条件 (契約書式)

- C2-1 `computeApply(path, text, manifest, ['contract-wrap'])`: 契約に指名された 3 形の関数を
  すべて wrap し、それ以外のバイト列を変えない
- C2-2 `computeRemove(path, appliedText, rules?)`: 全 rule の remove は apply 前のテキストと
  byte-identical に戻し、rule 指定時は指定 fragment と不要になった import だけを戻す
- C2-3 `checkProject(dir)`: 契約の `file:symbol` がソースに無ければ `unresolved` を返し、
  `--strict` で非 0
- C3-1 `aggregateContracts(events, contracts)`: 同じ入力から byte-identical な集計、
  指定期間かつ現行 marker id の `observed` 0 件は `uncovered`、`violated` または
  `predicate threw` 1 件以上は `violated`
- C3-2 `toAcceptanceReport(summary)`: `covered` のみ `met: true`
- C3-3 `reportAcceptance(input)`: `since` 無し、時刻不明イベント、または `sample < 1` の契約を
  acceptance の合格証拠に使わない
- C1-1 `contract(fn, spec)(…args)`: observe では同期値 / throw、および async の fulfillment 値 /
  rejection reason が `fn` と同一で、違反時に `contract violated` を emit する
- C1-2 `contract(fn, {...spec, contractId:'C-1', mode:'enforce'})`: 違反で
  `ContractViolationError` を throw / reject する
- C1-3 `contract(fn, spec)`: `contractId` と marker `Where.id`、UTC `observed_at` を別々に記録し、
  `LOG_WEAVER=0` / `1` の明示指定を test 環境の自動判定より優先する

C2 の実装では、これらの関数自身に `augur.contracts.json` を書いて `contract-wrap` を注入し、
Augur のテスト実行 (`LOG_WEAVER=1`) で `covered` になることを PR の証跡にする。
