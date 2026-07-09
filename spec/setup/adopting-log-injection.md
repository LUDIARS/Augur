# Log Injection 導入ガイド (LUDIARS 各プロジェクト向け)

対象読者: LUDIARS のサービス/ツールを保守していて、自分のプロジェクトに
**安定稼働ログの外部注入**を導入したい人。設計の正本は
[Log Injection Framework](../feature/log-injection.md)、CLI の正本は
[Inject CLI](../interface/inject-cli.md)。この文書は手順だけをまとめた導入資料。

## 何が得られるか

運用中にだけ出る「細かい停止バグ」— 未処理 rejection での即死、error リスナー無し
spawn の親巻き込みクラッシュ、async listener / interval が一度の例外で静かに死ぬ、
握り潰された catch — を、**コードを手で書き換えずに**観測可能にする。

```
あなたのプロジェクト --(scan/apply)-- Augur inject CLI
        |
        | 注入された probe (@ludiars/log-weaver)
        v
  logs/*.jsonl (Vg 互換 JSONL)
        |
        v
  Concordia observability (file tail → error task → auto-fix)
```

ログが残る = AI に「何がどこで死んだか」の再現可能なシグナルが渡る = 停止バグの
自動修正が回り始める、が狙い。検出ルールの根拠は Concordia
`spec/plan/problems/stability-checklist.md`。

## 前提

- ESM の TypeScript / JavaScript プロジェクト (CJS は v1 非対応)
- Augur の checkout が隣にあること (ツールは Augur から実行する。対象側に
  ツール依存は入らない)

## Step 1: manifest を置く

対象プロジェクトのルートに `augur.inject.json` を作る:

```json
{
  "service": "myservice",
  "include": ["src/**/*.ts"],
  "exclude": ["**/*.test.ts", "dist/**"],
  "runtime": {
    "autoImport": true,
    "entrypoints": ["src/main.ts"]
  }
}
```

| フィールド | 決め方 |
|-----------|--------|
| `service` | Vg の serviceCode と揃える |
| `include` / `exclude` | 本体コードのみ。テスト・生成物・vendored コードは除外 |
| `runtime.autoImport` | 自前の `process.on('unhandledRejection')` を既に持つなら `false` (Concordia がこのパターン)。無いなら `true` + `entrypoints` にプロセス起動ファイルを列挙 |
| `rules` | 省略 = 全 rule on。特定 rule を切るときだけ `{ "silent-catch": false }` のように書く |
| `importFrom` | 省略 = `@ludiars/log-weaver`。ローカル shim を使うときだけ変更 |

## Step 2: scan で現状を見る (read-only・依存不要)

```bash
cd ../Augur
npm run inject -- scan --project ../MyProject
```

出力は 1 行 1 候補 (`pending silent-catch src/db/repo.ts:141 catch in flushQueue`)。
ここで「観測不要」と判断した catch には**コメントを書く** — コメント付き catch は
「人間の判断済み」として以後 scan 対象から外れる。これが opt-out の正規手段
(manifest の rule off は rule ごと全部切る場合のみ)。

## Step 3: runtime 依存を入れる

apply する場合のみ必要 (scan / check だけなら不要):

```bash
# .npmrc に GitHub Packages を向ける (未設定なら)
echo '@ludiars:registry=https://npm.pkg.github.com' >> .npmrc
npm install @ludiars/log-weaver
```

Concordia 方式 (`lib/` への vendor) でも可。

## Step 4: sink を決める

| 状況 | やること |
|------|----------|
| Vg (`@ludiars/vestigium`) を既に install している | bootstrap で `bindSink((e) => vg.writer.write({ ...e }))` を 1 行。既存の JSONL に合流する |
| Vg 依存が無い | 何もしない。`runtime.autoImport: true` なら `/auto` が vestigium を自動検出し、無ければ `${VESTIGIUM_LOGS_DIR \|\| cwd/logs}/weaver.jsonl` にフォールバック (Concordia の file tail からは同様に見える) |

env: `LOG_WEAVER_SERVICE=<serviceCode>` を起動環境に足す。`LOG_WEAVER=0` で全停止。
test 環境 (`NODE_ENV=test` / `VITEST`) では自動で無効になるのでテストは汚れない。

## Step 5: apply して差分をレビュー

```bash
npm run inject -- apply --project ../MyProject --dry-run   # まず出力確認
npm run inject -- apply --project ../MyProject
```

挿入されるのは marker 付き fragment のみ:

```ts
} catch { weaverLog('warn', 'swallowed error', { where: 'src/db/repo.ts:141', rule: 'silent-catch', id: '9410e44f' }); /* augur-inject:silent-catch:9410e44f */}
```

- 差分は挿入行だけ (周辺コードは byte 単位で不変)。普通の PR としてレビューする
- `guardAsync` ラップは例外を「記録して飲む」= listener/interval を延命する。
  これはチェックリスト §1 の処方どおりだが、**挙動変更**なのでレビューで認識すること
- marker 付き fragment を手で編集しない。要らなくなったら `remove`、
  部分的に外したい場合はその anchor にコメントを書いて `remove` → `apply`

## Step 6: CI にドリフト検査を足す + fleet 登録

対象プロジェクトの CI に (Augur checkout がある環境で):

```bash
npm run inject -- check --project ../MyProject --strict   # pending/orphaned で exit 1
```

- `pending` = 観測されていない新しい危険 seam が増えた → apply するかコメントで判断を記録
- `orphaned` = リファクタで anchor が消えたのに fragment が残っている → `remove` → `apply` で貼り直し

複数プロジェクトの一括管理は fleet ファイル:

```json
{ "projects": ["../Concordia", "../Lictor", "../MyProject"] }
```

```bash
npm run inject -- check --fleet fleet.json --strict
```

## 導入チェックリスト

- [ ] `augur.inject.json` をルートに置いた (service / include / exclude / runtime)
- [ ] `scan` を実行し、意図的に観測しない catch にはコメントを書いた
- [ ] (apply する場合) `@ludiars/log-weaver` を依存に追加した
- [ ] (Vg 併用時) bootstrap で `bindSink` して JSONL を合流させた
- [ ] `LOG_WEAVER_SERVICE` を起動環境に設定した
- [ ] `apply` の差分を PR でレビューした (guardAsync の延命挙動を含めて)
- [ ] CI に `check --strict` を足した
- [ ] fleet ファイルに登録した

## トラブルシュート

| 症状 | 原因と対処 |
|------|-----------|
| イベントが 1 件も出ない | test 環境判定 (`NODE_ENV=test` / `VITEST`) か `LOG_WEAVER=0`。起動 env を確認 |
| `weaver.jsonl` に出るが Vg に合流しない | `bindSink` が呼ばれていない。bootstrap の Vg install 直後に 1 行足す |
| `check --strict` が CI で落ち続ける | pending: apply するかコメントで opt-out。orphaned: `remove` → `apply` |
| apply 後に lint が落ちる | 挿入行は 1 行が長い。lint 設定で `augur-inject` marker 行を ignore するか、max-len 系 rule の対象から外す |
| 機微情報がログに乗らないか不安 | fragment が載せるのは rule / where / id とエラーメッセージのみ。アプリ側データは一切拾わない (Vg の ctx ルール準拠) |
