# qs の限定パッチ更新

Actio: `actio:62c92d6d-2ea5-4ea9-b5c5-0838e9cd5d22`

## 対象と受け入れ条件

`package-lock.json` の `node_modules/qs` を 6.16.0 から 6.16.2 へ更新する。
親は body-parser 2.3.0 (`^6.15.2`) と express 5.2.1 (`^6.14.0`)。
どちらも 6.16.2 を許容する。npm registry の 6.16.2 の依存先、Node 要件、
ライセンスは現行ロックと同じ。親・他パッケージ・package.json は変更しない。

C-3 verifyQsLock(candidate, baseline): qs の version・resolved・integrity だけが公開 registry の 6.16.2 と一致する変更を受理し、旧版・別パッケージ変更を拒否する

## 再利用と検証計画

既存の contract-wrap と契約集計を再利用する。アプリ側の処理変更は不要。
依存全体を再解決する npm update は不要な更新を避けるため採用しない。
`augur plan --kind security` の境界検証・abuse-case 案を、今回の変更境界である
lock のリリース値と差分限定の検証に絞る。サービスの入力境界は変更しない。

対の回帰テストは修正版、旧版、他パッケージ変更、整合性値の改変を扱う。
最小の静的検証で実 lock を契約へ渡して観測し、registry の tarball を SHA-512 で照合する。
単体・統合・起動テストとライフサイクルスクリプトは実行しない。
復旧はこのコミットの lock 差分を戻すことで行う。

## 通信と依存の確認

外向き通信は公開 npm registry へのリリース情報と配布 tarball の GET のみ。
リクエストはパッケージ名・版を指定し、認証情報、コード、環境変数を送信しない。
取得物は実行せず展開して確認し、SHA-512 を registry の integrity と照合した。
`qs` の lib/dist に通信・子プロセス・環境変数参照は見当たらず、起動時通信はない。
install/postinstall スクリプトはない。開発者向け posttest の npm audit は実行しない。

qs の lock エントリは1件で、body-parser と express の共用間接依存として必要。
実行時依存の es-define-property と side-channel は既存の要求・ロックを保持する。
URLSearchParams は平坦な形式であり、親が使う入れ子解析と互換でない。
解析の自作は保守負担と互換性リスクを増やすため採用せず、BSD-3-Clause の
既存パーサーの修正版を継続利用する。新規依存は追加しない。
