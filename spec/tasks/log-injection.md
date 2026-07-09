# Log Injection — 残タスク

- Date: 2026-07-09
- 対象: [Log Injection Framework](../feature/log-injection.md) の初期実装
  (Augur#5 / Lapilli#10 / Concordia#301, いずれも merged) 後に残っている作業
- 導入手順の正本: [導入ガイド](../setup/adopting-log-injection.md)

進捗はこのファイルのチェックボックスを更新する。完了した項目は消さず残す
(何をやったかの台帳を兼ねる)。

---

## 1. publish / 依存配線 (次にやる)

- [ ] **Lapilli**: `v*` タグ push で `@ludiars/log-weaver@0.1.0` を GitHub Packages へ publish
  (workflow は packages/* を自動で拾う。publish 後の可視性 **Internal** 化は UI 手動 — Lapilli CLAUDE.md)
- [ ] **Concordia**: `@ludiars/log-weaver` を依存に追加 (GitHub Packages。または memory / blackbox と
  同じ `lib/` vendor 方式)
- [ ] **Concordia**: bootstrap で `bindSink((e) => vg.writer.write({ ...e }))` を 1 行追加し、
  注入ログを既存 Vg JSONL に合流 (`src/shared/vestigium.ts` に隣接させる)

## 2. Concordia への apply (依存配線後、別 PR で段階導入)

scan 済みの 29 件 pending (silent-catch 23 / listener-guard 5 / spawn-watch 1) を rule 単位で分割適用:

- [ ] `--rule spawn-watch` (1 件: `src/api/register-core.ts:669`) — 最小で効果検証
- [ ] `--rule listener-guard` (5 件: slack/bot.ts の socket listener 4 + codex-worker の
  `child.on('close')`) — **guardAsync は例外を記録して飲む = 挙動変更**。listener 内の
  既存エラーハンドリングとの重複をレビューで確認
- [ ] `--rule silent-catch` (23 件) — 観測不要な箇所はコメント記入で opt-out してから apply
- [ ] apply 後、実運用で `logs/*.jsonl` に weaver イベントが出ること・error pipeline が
  拾うことを確認 (E2E の初回実証)

## 3. fleet 展開

- [ ] fleet ファイルの置き場所を決めて作成 (`{ "projects": [...] }`。ローカルパス依存なので
  リポ管理ではなく運用マシン側 or env 化を検討)
- [ ] Lictor など他の常駐系プロジェクトへ導入 ([導入ガイド](../setup/adopting-log-injection.md) の
  チェックリストに従う)
- [ ] 各対象リポの CI に `check --strict` を組み込む (Augur checkout の取得方法を CI 上で確立
  してから — checkout どうしの隣接前提を CI で満たす方法は要設計)

## 4. Augur planning との接続 (本来の目的の閉ループ)

- [ ] weaver JSONL → `RuntimeSignal[]` 変換 (`augur plan --signals` / HTTP API に食わせる
  アダプタ)。「運用ログ → 停止バグの再現シグナル → テスト計画 / fix policy」のループを繋ぐ
- [ ] Concordia error pipeline 側: weaver イベント (`source: "log-weaver"`) を error rule として
  認識させるか検討 (既定の file tail で拾える形にはなっている)

## 5. 将来拡張 (v1 スコープ外と決めたもの)

- [ ] CJS (`require`) プロジェクト対応 — 現状 ESM のみ (設計判断: 現 consumer が全部 ESM)
- [ ] 変数代入されない直呼び `spawn(...)` の検出 (`watchChild(spawn(...))` ラップ挿入)
- [ ] `orphaned` の自動修復 (`remove` → `apply` の一括ワンコマンド化)
- [ ] Vestigium (Vg) 本体の Lapilli 移行 (Lapilli CLAUDE.md 既記載の予定) に合わせて、
  log-weaver の `./auto` の vestigium 自動検出パスを再確認
