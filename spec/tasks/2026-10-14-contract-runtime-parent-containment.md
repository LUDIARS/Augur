# Runtime sync の親ディレクトリ包含検証

Specification ID: SPEC-CONTRACT-RUNTIME-PARENT-CONTAINMENT
Actio: actio:35db60bb-03b8-436d-8a42-6f853ee234b8
Issue: VULN-20261014-Au-01

## 変更の目的と範囲

未作成 runtime の字句パスはプロジェクト内でも、既存の親 junction / symlink が外部を指すと同期が外部へ書き込めた。writeRuntimeCopy は mkdir / write の前に最も近い既存祖先の realpath を調べ、プロジェクト root の realpath 内であることを確認する。外部なら既存と同じ Error と contract path leaves project メッセージで拒否する。
既存ファイルの実体検証は existingProjectPath を維持し、包含判定は assertContained を共有する。依存追加・他コマンドの機能変更・リファクタは行わない。同時にリンクを差し替える競合への対策は本修正の範囲外。

## 受け入れ契約

C-2 writeRuntimeCopy(projectDir, runtimeFile, text): 成功した書き込みの実体はプロジェクト内にあり要求本文と一致する。外部を指す親リンクは書き込み前に拒否する

述語は成功時の実体パスと保存本文を検証する。拒否時の例外と副作用の不在は対の CLI 回帰テストで検証する。

## テスト計画

augur plan --kind security で得た入力検証・権限制約・悪用ケースを、ファイル境界の以下のケースへ具体化する。認証やレート制限はこのローカルコマンドの変更範囲外。

- manifest.runtimeFile と --path の双方で、外部親リンク直下と未作成の深い子孫を拒否する。外部にファイルも親ディレクトリも作らない。
- 既存の外部 runtime を拒否し、元の内容を保持する。
- 通常の未作成の深いディレクトリを作成し、その後 runtime check が成功する。
- 内部を指す親リンク経由の新規作成は成功する。
- link 作成の権限不足・未対応だけを skip とし、その他のセットアップエラーは失敗にする。

## 作業分解

- [x] 契約と述語を実装より先に定義する。
- [x] 既存の包含検証を再利用し、mkdir / write 前に既存祖先を検証する。
- [x] 拒否と正常系の回帰テストを追加する。
- [x] 回帰テスト39件、型検査、変更箇所 lint を確認する（最終テスト修正後の runtime CLI 9件も成功、skip 0）。
- [x] 最終ソースの6契約が covered、違反0であることを確認する。
- [ ] Concordia へコミット依頼し Revisor local PR を提出する。

## 契約観測の設定と再利用

既存 manifest は未導入の log-weaver package を参照し、inject 設定も無かった。依存を追加せず、既存の自己完結した templates/contract-runtime/contract-runtime.ts を再利用する。既存5契約と新規C-2へ観測フラグメントを挿入する。既存関数の処理本体は変更せず、集計対象の契約を削除しない。

既存の assertContained を共有してエラー文言・例外型を維持する。CLI とテンプレート生成はそのまま使い、新しい書き込み API は作らない。

## 検証と制限

- 対象7ファイル39テストが成功。リンクの回帰テストも skip 0。
- TypeScript 型検査、ビルド、変更箇所の ESLint、git diff --check が成功。
- 契約集計は6件すべて covered、違反0。
- DELEGATION_STARTED_AT が実行環境に無かったため、Cc が保持するこの委託セッションの started_at を集計の下限に使用。
- 変更前後ともビルドは dist/src/cli/main.js を出力する。変更前の src・scripts と設定を隔離コピーして実測し、既存の src/cli/main.ts による scripts import が原因であることを確認。本修正では既存の CLI 配置問題に範囲を広げない。
- サービスの起動・再起動は行わない。リンク差し替え競合（TOCTOU）への対策は範囲外。
