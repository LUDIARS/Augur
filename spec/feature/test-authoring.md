---
title: Test authoring — Anatomia 二層ドメインと影響範囲からのテスト計画・作成
type: feature
service: augur
domain: test-lifecycle
status: planned
tags:
  - test-lifecycle
  - anatomia-dual-layer
  - regression
  - assurance
  - incident
updated: 2026-08-23
---

# feature: テスト計画・作成 (ドメイン駆動)

## 目的

実装 (PR) に対して Anatomia が出す**二層ドメイン (ビジネス / プログラム) と影響範囲**を
入力に、その機能の**回帰テスト**と**動作保証テスト**を、ドメインごとに適切な量だけ作る。
運用上発生した問題 (incident) からも同じ経路で回帰テストを強化する。

「どこに・何を・いくつ」は決定的に決め (§2〜§3)、テスト本文の生成だけを生成器に
任せる (§5)。[plan/test-management.md](../plan/test-management.md) §1.3。

## 1. 入力

### 1.1 PR からの入力 (`augur tests plan --pr`)

| データ | 取得 | 使い方 |
|---|---|---|
| `PrDiffReview` | `anatomia pr-review --repo <wt> [--base <ref>] --json` を Augur が spawn (`--analyze`)、または Revisor が gate で得た JSON を `--analysis <file>` で渡す | `diff.anchors.{added,changed}` = 直接対象。`domain.dualLayer.unclassifiedAnchors` = ブロッカー。`domain.targetDomains` = ビジネスドメイン所属。`architecture.changedViolations` / `quality.changedFunctions` (cyclomatic / fanIn / fanOut) = 優先度 |
| プログラムドメイン所属 | `anatomia domains program --repo <wt> --json` | 変更 anchor → program domain id |
| 影響範囲 | 変更 anchor ごとに `anatomia callers <name> --repo <wt> --json` を `impact.callerDepth` 段 (既定 2) | `impacted` 集合。assurance の対象拡張と、バンドル選択 |
| 入口距離 | `PrDiffReview` / ContextBundle の `nearestEntries` (あれば) | entry point に近い変更ほど `runtime: true` を付ける |

Anatomia CLI の場所は既存の逆方向設定 (`ANATOMIA_AUGUR_DIR`) と対称に
`AUGUR_ANATOMIA_DIR` (既定 `../Anatomia`)、`node <dir>/bin/anatomia.mjs` を shell 無しで spawn。
見つからなければ exit 2 (設定不備。ダウンロードも推測もしない)。

### 1.2 incident からの入力 (`augur tests plan --incident <file>`)

`file` は次のいずれか。形式は先頭で判別する。

| 形式 | 内容 |
|---|---|
| 問題ログ (`spec/plan/problem_logs/*.md`) | frontmatter の `symptoms` / `affected` / `root_cause` と本文。`affected` のファイル / シンボルを anchor へ解決 (`anatomia where` / `find`) |
| Vestigium JSONL (log-injection のマーカー出力) | `marker` / `site` (file:line) を anchor へ解決。同じ site の連続発生は 1 件に畳む |
| 失敗した `RunRecord` (`--incident run:<runId>`) | failed テストの `anchors` をそのまま対象に。既存テストが捉えたのに直っていない = 回帰の強化 (境界条件の追加) |

incident 由来の target は `kind: "regression"`、`priority: "critical"` 固定、
`brief.incident` に失敗の事実 (ログ抜粋・期待する修正後の振る舞い) を入れる。

### 1.3 experience goal からの入力

既存の [experience-driven-constraints](./experience-driven-constraints.md) の guardrail
テスト提案を `kind: "guardrail"` の target として同じ `TestPlan` に流す。計画ロジックは
既存 engine (`createPlan`) を呼ぶだけで、本 spec では新設しない。

## 2. 計画 (決定的)

`src/tests/plan/` (`plan.ts` / `targets.ts` / `priority.ts` / `quota.ts` / `briefs.ts`)。

### 2.1 ドメイン確認 (ステップ 2 の受け取り)

- `domain.dualLayer.unclassifiedAnchors` が 1 件でもあれば `status: "blocked_by_domain"`、
  `blockers` にその anchor を列挙し、targets は空。理由: テストは**プログラムドメインに
  必ず紐づけて**台帳に載せる (`domains.program` 必須) ので、置き先の決まらない変更には
  テストを作れない。解消は PR 側 (`.anatomia/layers.json` / 配置の是正) であって Augur 側
  ではない。
- ビジネスドメインの紐づけ無しは**許容** (Anatomia の契約どおり)。`domains.business` は空、
  quota は `(unowned)` で計算。
- `--analysis` で渡された JSON が `temporary: true` でない / `diff.available: false` なら
  exit 1 (入力が契約外)。

### 2.2 対象 (targets) の導出

変更 anchor ごとに、次の順で target を作る。

1. **assurance**: 変更された関数 1 つにつき 1 target (`anchors = [a]`,
   `impacted = callers(a, depth)`)。既に `active` テストが `anchors` に `a` を含んでいれば
   `dropped: covered` (そのテストは PR バンドルで走るので、新設しない)。
2. **regression**: `origin.type = pr` の場合、PR が bug 修正である証拠
   (PR title / body の `fix` / `bug` / 問題ログ参照、または `--incident` 併用) があるときだけ
   変更 anchor に 1 target。無ければ作らない (回帰テストは失敗事例に 1:1)。
3. **guardrail**: §1.3。

target の `domains` は anchor のプログラムドメイン id (必須) とビジネスドメイン名 (任意)。
複数 anchor にまたがる target は作らない (1 target = 1 守る対象。テストの粒度を揃える)。

### 2.3 優先度

決定的に 4 段階へ。加点して閾値で切る (≥ 60 critical / ≥ 40 high / ≥ 20 medium / それ未満 low)。

| 要因 | 点 |
|---|---|
| incident 由来 | 60 (= critical 固定) |
| `fanIn` (callers 数) ≥ 5 / ≥ 2 | 25 / 10 |
| `nearestEntries` が 1 段以内 | 20 |
| `cyclomatic` ≥ 10 / ≥ 5 | 15 / 8 |
| severity=error の architecture violation に触れる | 15 |
| ビジネスドメインの quota 設定 `priority` が critical / high | 15 / 8 |
| 変更種別 added (新規関数) | 5 |

`runtime` は `nearestEntries` 1 段以内 **または** assurance で `fanIn ≥ 5` のとき true。

### 2.4 置き先 (file) と runner

- 同じプログラムドメインの既存テストファイル (台帳 + リポ内 `*.test.*` / `__tests__/`) のうち、
  対象 anchor の実装ファイルに最も近いもの (パス共通接頭辞最長) を `file` にする。無ければ
  リポの慣習 (`test/unit/<module>.test.ts` 等、`tests.config.json` → `layout` で指定、既定は
  実装ファイルと同階層の `<name>.test.<ext>`) で新規パスを決める。
- runner はリポ設定 `runners` の先頭 (通常 `vitest`)。拡張子で決める (`.rs` → cargo 等)。

## 3. 量の上限 (quota) と入れ替え

ビジネスドメインごとに `max` ([data/test-registry.md](../data/test-registry.md) §3)。

1. ドメインの `active + probation` 件数 + 本計画の planned 件数が `max` 以下なら全採用。
2. 超えるなら、planned を priority 降順 → key 昇順で並べ、入り切らない分は:
   - 同ドメインの `probation` テストがあれば、最も古い `lastFailedAt` (無ければ
     `createdAt`) のものを `replaces` に指定して採用 (作成時にそれを `retired`, reason `quota`)。
   - 無ければ `dropped: quota`。
3. incident 由来 (critical) は quota を**超えても採用**し、その代わり同ドメインの
   `probation` から 1 件退役させる (無ければ超過のまま。超過は `quota` 出力で見える)。

上限は「そのドメインに何件あるべきか」の表明であって、CI 時間の制御ではない。
CI 時間はバンドル選択 (影響集合) が抑える。

## 4. incident → 回帰テストの流れ

```text
問題ログ / Vestigium / 失敗 run
  → augur tests plan --incident <file> --repo <wt>        (anchor 解決、critical target)
  → augur tests author --plan <planId> [--author claude-cli]
  → 生成テストを「修正前の状態」で 1 回実行 → failed であること (回帰を捉えている)
  → 修正コミット後に 1 回実行 → passed であること
  → 両方満たしたものだけ active 化、満たさなければ candidate のまま報告
```

「修正前に落ちる」確認は `--before <sha>` で別 worktree を切って実行する
(`git worktree add --detach` を Augur が作り、終了時に消す)。`--before` を省略したら
修正後の pass だけで受け入れ、`note` に「pre-fix failure unverified」を残す。

## 5. 作成 (`augur tests author`)

`src/tests/author/` (`author.ts` / `session.ts` / `claude-cli.ts` / `write.ts`)。

### 5.1 生成器 `session` (既定)

テストを**書かない**。`TestPlan.targets[].brief` を、呼び出し元 (セッション LLM) が
そのまま実装できる形で返す。MCP tool `augur.tests.plan` / HTTP `POST /v1/tests/plans` の
主経路。セッションが書いたファイルは `augur tests register --from-plan <planId>` で台帳に
載せ、初回実行で `active` 化する。

### 5.2 生成器 `claude-cli`

`claude -p --model <augur.config.json の authoring.model> --output-format json` を spawn し、
brief + 対象関数のソース抜粋 + exemplar テスト 1 本を渡して**テストファイル 1 本分の本文**
だけを返させる。

- モデルは設定で固定する (既定任せにしない。上限切れの巻き添えで即 exit するため)。
- 1 target 1 呼び出し。タイムアウト 120 秒。失敗した target は `dropped: author_failed`
  として残し、他の target は続ける。
- 返った本文は書き込む前に検査する: 指定 `file` 以外への言及禁止、`mustNot` の語
  (ネットワーク / 実 DB 接続 / `sleep`) を含まない、runner が解釈できる (vitest なら
  `describe` / `it` / `test` がある)。検査に落ちたら書かない。
- 書き込み後、`augur tests run --bundle ids:<新規 id>` を 1 回走らせ、pass したものだけ
  `active`、落ちたものは `candidate` のまま (ファイルは残す。人が直すか捨てる)。

API キーは持たない。`claude` CLI が無ければ exit 2。

### 5.3 書き込み規則

- 既存ファイルへ追記するときは末尾に `describe("<brief.title>", …)` ブロックを足すだけ。
  既存内容は変えない。
- 生成テストの先頭コメントに `@augur test:<id> plan:<planId>` を置く。台帳と突き合わせる印。
- `.augur/tests.jsonl` に `status: candidate` で upsert。

## 6. 出力

`augur tests plan` は `TestPlan` を plan ストア (既存 [persistence.md](../data/persistence.md)
の `PlanStore` と同じ配置、`kind: "test-plan"`) に保存し、`planId` を返す。
`augur tests author --plan <planId>` がそれを読む。`--json` で `TestPlan` 全体。

## 7. 制約

- 計画は Anatomia の事実 (anchor / ドメイン / callers / metrics) と台帳だけから決める。
  Augur がソースを解析しない。ソース抜粋を読むのは `claude-cli` 生成器への材料としてだけ。
- `blocked_by_domain` を迂回する既定ドメインを作らない。
- 生成器がテストを通せなかった事実を隠さない (`candidate` と `dropped` に必ず出る)。
- 同じ入力 (analysis + 台帳 + 設定) から同じ `TestPlan` (`planId` を除く)。

## 関連

- [test-lifecycle.md](./test-lifecycle.md)
- [focused-testing.md](./focused-testing.md) — 既存のドメイン優先度入力 (`focusedTesting`)。
  本 spec の §2.3 はこれの `priority` を quota 設定経由で引き継ぐ
- [experience-driven-constraints.md](./experience-driven-constraints.md)
- [log-injection.md](./log-injection.md) — incident 入力の Vestigium JSONL
- Anatomia `spec/feature/domain-dual-layer.md` / `pr-diff-review.md` / `entrypoint-trace-graph.md`
