---
title: Test lifecycle — 台帳、バンドル実行、結果キャッシュ、段階的退役
type: feature
service: augur
domain: test-lifecycle
status: planned
tags:
  - test-lifecycle
  - bus
  - run-cache
  - retirement
updated: 2026-08-23
---

# feature: テストライフサイクル (台帳・実行・キャッシュ・退役)

## 目的

作成したテスト群を Augur が**束ねて実行し**、結果を**しばらく保持し**、**長期間問題の無い
テストを徐々に外す**。テストの中身は対象リポのファイルだが、「どのテストが何を守って
いて、最近どう振る舞ったか」は Augur の台帳 ([data/test-registry.md](../data/test-registry.md))
が持つ。

## 1. 台帳 (registry)

`src/tests/registry.ts`。`<repo>/.augur/tests.jsonl` の読み書き。

- `load(repoPath)` / `save(repoPath, records)` — id 昇順で全行書き直し。
- `upsert` は id で突き合わせ、`createdAt` / `runs` / `passStreak` 等の履歴フィールドを
  保存済みの値で保護する (author の再実行で履歴が消えない)。
- `augur tests register` で**既存の手書きテスト**も台帳に載せられる (origin.type = manual)。
  台帳に無いテストは Augur のバンドルに入らない。既存のリポ全体テスト (`npm test`) は
  Revisor の登録テストが引き続き担い、Augur はそれを置き換えない。
- 台帳の整合検査 `augur tests lint`: `file` が存在しない / `file` が repo 外を指す
  (絶対パス・`..`・repo 外への symlink) / `domains.program` が空 / 同一 (file, name) の重複 /
  runner=command で command 無し / 列挙値が未知 → exit 1
  ([data/test-registry.md](../data/test-registry.md) §2.1)。Revisor の登録テストに
  `augur tests lint` を入れれば台帳の腐敗を PR で止められる。

## 2. バンドル (どのテストを走らせるか)

`src/tests/bundle.ts`。決定的 (入力が同じなら同じ id 集合・同じ順序)。

| kind | 選択 |
|---|---|
| `pr` | `anatomia pr-review` の変更 anchor 集合 A と、その callers (`impact.callerDepth` 段) を合わせた影響集合 I を取り、`anchors ∩ I ≠ ∅` の `active` / `probation` テスト ∪ `always` テスト。A が空 (docs-only 等) なら `always` のみ |
| `domain` | `domains.business` または `domains.program` に指定名を含む `active` / `probation` テスト |
| `all` | `active` / `probation` 全部 |
| `ids` | 指定 id (status を問わない。`candidate` の初回実行と `retired` の再確認に使う) |

`reason` に「なぜ選ばれたか」を testId ごとに残す (`anchor:<id>` / `always` / `domain:<name>`)。
`probation` を含めるのは、退役判定のためにも実行履歴が要るから。

## 3. 実行 (bus × runner)

### 3.1 バス

`src/bus/` — `Bus` インターフェースと `local` / `wrapper` の 2 実装
([data/test-registry.md](../data/test-registry.md) §4)。

```ts
interface Bus {
  name: string;
  exec(input: { cwd: string; argv: string[]; env: Record<string, string>; timeoutMs: number }):
    Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }>;
}
```

- shell は使わない (`spawn(argv[0], argv.slice(1))`)。`wrapper` だけはテンプレートの
  都合で `sh -lc "{cmd}"` のような要素を持ちうるが、`{cmd}` の組み立ては Augur が
  POSIX quote する (runner argv に含まれる空白・引用符を壊さない)。
- `timeoutMs` 超過で子プロセスツリーを kill し `timedOut: true`。結果は `error`。
- 環境変数は allow-list (`env` 配列) だけ通す。`AUGUR_*` は常に落とす (再帰防止)。

### 3.2 ランナー

`src/tests/runners/` — `Runner` インターフェース。

```ts
interface Runner {
  id: TestRecord["runner"];
  /** 1 バンドルを最小回数の起動にまとめる (vitest はファイル群を 1 回で) */
  buildInvocations(tests: TestRecord[], config: RunnerConfig): Invocation[];
  /** 起動結果を testId ごとの status に分解する */
  parse(invocation: Invocation, output: BusOutput): Array<RunRecord["results"][number]>;
}
```

| runner | 起動 | 解析 |
|---|---|---|
| `vitest` | `npx vitest run <files…> --reporter=json` (selector があれば `-t`) | JSON reporter の `testResults[].assertionResults[]` を (file, fullName) で台帳へ突き合わせ。見つからない台帳テストは `error` ("not found in reporter output") |
| `command` | `TestRecord.command` をそのまま | exit 0 → passed、それ以外 failed、起動失敗 → error |
| `cargo` / `gtest` / `unity` | T1 では `command` のプリセット (argv を組むだけ) | exit code 解析のみ。構造化解析は後続 |

ランナーは**対象リポの依存**で動く (Augur は vitest を同梱しない)。

### 3.3 実行手順 (`augur tests run`)

1. 台帳とリポ設定を読む。`--bus` 未指定なら `defaultBus`。
2. バンドルを決める (§2)。0 件なら `status: "passed"` にせず exit 3 (「走っていない」)。
   ただし `--for-revisor` は exit 0 (§3.3 末尾)。
3. runner ごとに invocations を組み、バス越しに順次実行 (並列は T1 ではしない)。
4. `RunRecord` を組み立て、台帳の `lastRunAt` / `lastFailedAt` / `passStreak` / `runs` を更新し、
   `candidate` で pass したテストを `active` へ昇格する (`--promote` 既定 on)。
5. `RunRecord` を実行キャッシュへ保存し、`runId` を stdout へ (JSON または text)。

`--for-revisor` (Revisor 登録テストから呼ばれる形): 台帳更新をしない (使い捨て worktree
の `.augur/tests.jsonl` を書き換えても意味が無く、diff を汚す)。キャッシュには保存する。
**バンドルが空でも exit 0** で終える (`RunRecord` は作らず、その旨を出力する)。Revisor は
登録テストの exit code だけを見るので、docs-only PR で `pr` バンドルが空になったときに
exit 3 を返すと「守るテストが無い」が「テストが落ちた」として扱われてしまう。
`--for-revisor` が非 0 で終わるのは **failed が出たとき (1) と内部エラー (2) だけ**。

## 4. 段階的退役 (retirement)

`src/tests/retirement.ts`。`augur tests sweep` と `run` 後に評価。設定は
`tests.config.json` → `retirement`。

```text
active ──(probationAfterDays 以上 失敗無し かつ passStreak ≥ probationAfterPasses)──▶ probation
probation ──(retireAfterDays 以上 失敗無し)──▶ retired
probation ──(失敗)──▶ active   (passStreak = 0)
retired ──(augur tests revive <id> / incident が同 anchor を指す)──▶ active
```

- 「失敗無し」の起点は `lastFailedAt` (無ければ `createdAt`)。
- `origin.type = incident` のテストは `incidentHorizonDays` (既定 365) を経るまで
  `probation` に入らない。事故由来は記憶を長く持つ。
- `exemptKinds` (既定 `guardrail`) と `always` は退役しない (予算・常時項目は時間で価値が
  減らない)。
- `retired` はバンドルから外れるが台帳には残る (`retiredAt` / `retiredReason`)。ファイルの
  削除は `augur tests prune --apply` が行い、既定は提案のみ (diff を出す)。削除は人間か
  セッションが PR にする。
- 量の上限 (quota) 超過による入れ替えは作成側 ([test-authoring.md](./test-authoring.md) §3)
  が `replaces` で指示し、作成時に対象を `retired` (reason `quota`) にする。

sweep は決定的: 同じ台帳 + 同じ `--now` で同じ結果。`--now` 未指定は現在時刻。

## 5. 結果キャッシュ

`src/tests/run-store.ts`。`RunStore` インターフェース (`put` / `get` / `list` / `sweep`) と
SQLite (`node:sqlite`) または JSONL 実装。[data/test-registry.md](../data/test-registry.md) §5 の
保持規則。

- `list` のフィルタ: repository / headSha / bundle.kind / since / status。
- 同一 (repository, headSha, bundle.testIds, bus) の run が `retentionDays` 内にあれば
  `augur tests run --cached` はそれを返して実行しない (Revisor の再審査で同じ head を
  何度も叩くケース)。既定は実行する。

## 6. 報告

`augur tests report <runId>`: 結果 + 台帳情報 (kind / domains / origin) を結合して、
判断者 (セッション LLM / 人間) が読む 1 文書にする。

- text: ドメイン別に failed → error → passed の順、failed は `failureMessage` 付き。
- `--json`: `RunRecord` + `tests: Record<testId, TestRecord>`。
- `--markdown`: Discord / PR コメントへ貼る形。

## 7. 判断とフラグ

- `augur tests verdict <runId> --accept|--reject --by <who> [--note]` → `Verdict` を run に付ける。
  `reject` は run を失敗扱いにはしない (事実は結果、判断は判断)。
- `augur tests flag <runId> --pr <revisorPrId>` → [interface/revisor-verification.md](../interface/revisor-verification.md)。
  前提: `verdict.decision = accept` かつ `status = passed`。満たさないなら exit 1 で送らない。

## 8. 制約

- 台帳にはテストの**所在と履歴**だけを置き、テスト本文を複製しない。
- 実行は常にバス越し。`local` でも shell を経由しない。
- `.augur/tests.jsonl` の書き換えは `register` / `author` / `run` (非 `--for-revisor`) /
  `sweep --apply` / `revive` / `prune --apply` だけ。読み取り系コマンドは書かない。
- 決定性: バンドル選択・退役判定・id 付与は入力 (+ `--now`) の関数。時刻は `run` の
  `startedAt` 等の記録にだけ使う。

## 関連

- [data/test-registry.md](../data/test-registry.md)
- [test-authoring.md](./test-authoring.md)
- [../interface/tests-cli.md](../interface/tests-cli.md)
- [../interface/tests-api.md](../interface/tests-api.md)
