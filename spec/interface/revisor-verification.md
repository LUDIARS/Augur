---
title: Augur → Revisor 保証フラグ契約 (external verification)
type: interface
service: augur
domain: test-lifecycle
status: planned
tags:
  - test-lifecycle
  - revisor
  - verification
updated: 2026-08-23
---

# Augur → Revisor 保証フラグ (external verification)

ワークフローのステップ 6「テスト通過 → Revisor にフラグを立てる」の契約。Augur 側は
`augur tests flag` / `POST /v1/tests/runs/:runId/flag`、Revisor 側は本書の
エンドポイントを実装する (Revisor リポ、委託 Sol-C)。

## 1. 前提 (Augur 側で検査)

- run の `status = "passed"`
- `verdict.decision = "accept"` が付いている (人間またはセッション LLM の判断を経ている)
- run の `headSha` が、フラグを立てる PR の現在の head と一致する (Revisor 側でも検査)

満たさない場合 Augur は送らず exit 1。**判断の無い自動フラグは作らない** — Revisor の
「人間による動作確認が必要です」を機械が勝手に消さないため。

## 2. Revisor エンドポイント

```http
POST /api/local-prs/:id/verification
Content-Type: application/json

{
  "source": "augur",
  "headSha": "<40 hex>",
  "runId": "r-…",
  "decision": "accept",
  "by": "neco",
  "at": "2026-08-23T00:00:00.000Z",
  "summary": { "total": 12, "passed": 12, "failed": 0, "skipped": 0, "error": 0,
               "contracts": { "covered": 3, "violated": 0, "uncovered": 1 } },
  "bundle": { "kind": "pr", "testIds": ["t-…"] },
  "reportUrl": null,
  "note": "…"
}
```

`summary.contracts` は[オンライブ契約テスト](../plan/2026-09-05-live-contract-testing.md)
§6.3 の追補。対象リポジトリに `augur.contracts.json` がある場合だけ付き、run の
`[startedAt, finishedAt]` に入る契約観測の内訳 (`covered` / `violated` / `uncovered`) を
表す。Revisor 側は**表示のみ**で、disposition ロジックは変えない。`violated > 0` でも
フラグの可否は人間の verdict 次第で、「判断の無い自動フラグは作らない」原則 (§1) は
そのまま。契約ファイルが無いリポジトリからは従来通りこのキーの無い `summary` が届く。

`:id` は local PR の id (uuid)。`Rv#<number>` からの解決は Augur 側が
`GET /api/local-prs?view=summary&state=open` で行う (`--pr` は id でも `#番号` でもよい)。

| 応答 | 条件 |
|---|---|
| `200 { pullRequest }` | 記録した。`pullRequest.externalVerification` に本 body + `recordedAt` |
| `400` | body 不正 / `decision` が `accept` 以外 (reject は Revisor に送らない契約。送られたら拒否) |
| `404 { error: { code: "not_found" } }` | PR が無い → Augur は `not_supported` ではなく `rejected` |
| `409 { error, headSha }` | `headSha` が PR の現在 head と不一致 (古い head の結果) |
| `409` (status) | PR が `open` でない |
| `404` (route 未実装) | Revisor がまだ本契約を実装していない → Augur は `outcome: "not_supported"` で記録し exit 0。**エラーにしない** (T4 未反映の期間に CLI を壊さない) |

### 2.1 2 種類の 404 の見分け方

「PR が無い」と「route が無い」はどちらも 404 で返るので、**本文で見分ける**。
Revisor が本契約を実装していれば、PR が無いときの応答は既存のエラー形
(`{ error: { code: "not_found", … } }`) を JSON で返す。route 自体が未実装のときは
Hono の既定 404 (JSON のエラー形ではない) になる。Augur の判定:

1. `content-type` が JSON で、本文が `{ error: { code } }` に一致する → `rejected` (PR が無い)。
2. それ以外 (本文が JSON でない / `error.code` が無い) → `not_supported`。

route が実装済みかを別途確かめたい場合は `GET /api/local-prs/:id` が 200 を返すかで
補強してよい (任意。1〜2 の判定だけで契約は満たす)。

記録は上書き (最新 1 件)。head が進めば `externalVerification` は**無効**になる
(§3 の導出で head を比べる。消す必要は無い)。

## 3. Revisor 側の反映 (派生、保存しない)

Revisor の原則「人間が要るかは読むたびに導出」に合わせ、記録は事実だけ、効果は導出。

- `pr-disposition`: `runtimeVerification.required` によるブロッカー
  「人間による動作確認が必要です」は、`externalVerification` が
  `decision = accept` かつ `headSha === pullRequest.headSha` のとき**立てない**。
  代わりに `decision.externalVerification = { source, by, at, runId }` を出す (board の表示用)。
- `merge-risk` (`assessMergeRisk`): 要因「動作確認が必要 (20)」を同条件で 0 にする
  (内訳に `external_verification_cleared` を −表示で残す。0 に消すのではなく、何が効いたか
  見える形)。
- `assessRuntimeVerification` 自体 (審査時のスコア) は変えない。審査の事実と、後から来た
  外部保証は別の行。
- board / test workflow: `Open / Test OK` の行に「Augur 保証 (by …)」バッジ。head が進んで
  無効になった記録は灰色で「古い head」。
- `autoMergeRequiresRuntimeVerificationClear = true` の環境では、このフラグでオートマージの
  最後の条件が外れる。**それが本契約の狙い**: テストを通し、判断を記録した PR だけが
  自動で進む。

## 4. pull 経路 (補助、Revisor 変更不要)

Revisor の登録テストケースに次を `runtime: true` で足すと、審査中に Augur バンドルが走り、
既存の merge-risk 規則 (`runtime: true` の登録テスト通過 = −40) が効く。

```json
{ "name": "augur-bundle", "command": "node ../Augur/bin/augur.mjs tests run --bundle pr --for-revisor --json", "runtime": true }
```

`--for-revisor` は台帳を書かず、failed で exit 1 ([tests-cli.md](./tests-cli.md))。
push 経路 (本書 §2) と併用してよい。pull 経路は「テストが通った」までで、判断は含まない。

## 5. Revisor 側の受け入れ条件 (委託 Sol-C)

- `spec/feature/external-verification.md` を Revisor に追加 (本書の §2〜§3 を Revisor の
  言葉で。ドメインは `local-pr-lifecycle` + `review-gate`)。
- `POST /api/local-prs/:id/verification` の検証 (`local-contracts.mjs` に追加)、store への
  `externalVerification` 保存、`pr-disposition` / `merge-risk` / board の派生。
- 未知の `:id` には `404 { error: { code: "not_found" } }` を JSON で返す (§2.1 の見分けが
  成立する条件)。
- テスト: head 一致で blocker が消える / head 不一致で 409 / `reject` で 400 /
  `open` 以外で 409 / head が進んだ後は効果が消える / 未知 id で `error.code = "not_found"`。
- Revisor は常駐なので反映は再起動が要る (Excubitor 経由、neco 判断)。

## 関連

- [tests-cli.md](./tests-cli.md) / [tests-api.md](./tests-api.md)
- Revisor `spec/feature/merge-risk.md` / `pr-lifecycle.md` / `human-decision-board.md`
- [review-plan-cli.md](./review-plan-cli.md) — 逆方向 (Revisor → Augur) の既存契約
