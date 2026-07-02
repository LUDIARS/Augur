# Media Tool Implementation Guide — augur-lens (実装資料)

本書は、[Media-Based Testing](./feature/media-based-testing.md) が前提とする外部ツール
**augur-lens**(ゲームのスクリーンショット/動画をキャプチャ・解析し、Augur へ渡す
`media_analysis` シグナルを生成するツール)の実装資料である。

**想定読者は AI 実装者(GPT-5.5 等)である。** どのモデルが実装しても同じ成果物に
収束するよう、選択の余地を残さない形で記述する。本書の規定と実装が食い違う場合、
本書が正である。

## 0. 実装者への指示(最初に読むこと)

1. 本書のキーワード MUST / MUST NOT / SHOULD / MAY は RFC 2119 の意味で用いる。
2. 本書に明記されていない設計判断が必要になった場合、**§12 デフォルト表**に従うこと。
   表にもない場合は、実装せず `TODO(spec):` コメントを残して人間に確認する。
   **推測で仕様を補ってはならない。**
3. 依存ライブラリは §3 の表にあるものだけを使う。追加 MUST NOT。
4. 閾値・定数はすべて §5〜§8 の表の値をそのまま使う。「妥当な値に調整」は禁止。
5. 乱数・現在時刻・環境依存値を解析結果に混入させない(§10 決定性要件)。
6. 実装順序は §11 のマイルストーン順を厳守する。各マイルストーンの受け入れ基準を
   満たしてから次に進む。

## 1. 背景 — これまでの設計(Augur 側)

Augur はテストを実行しない計画サービスである。ゲームのグラフィック品質と
レーティング適合(CERO 等)は、次の分業で扱う:

```text
ゲームビルド --(スクリプト再生)--> キャプチャハーネス --(フレーム)--> アナライザ --(数値)--> 呼び出し元 --(CreatePlanRequest)--> Augur
```

Augur 側には以下が実装済みである:

| 要素 | 場所 | 内容 |
| --- | --- | --- |
| 品質 `visual_fidelity` (EG-G11) | [Experience Goal Catalog](./data/experience-goal-catalog.md) | golden_image_diff ≤ 2% / render_artifact_count = 0 / hud_legibility_failures = 0 |
| 品質 `content_rating_compliance` (EG-G12) | 同上 | rating_violation_count = 0 / prohibited_expression_count = 0 / regional_variant_mismatch_count = 0 |
| シグナル型 `media_analysis` | [Core Data Schema](./data/core-schema.md) | アナライザの数値結果を運ぶ `RuntimeSignal` |
| 契約とふるまい | [Media-Based Testing](./feature/media-based-testing.md) | name=メトリクス名、scope=シーン名、source=ハーネス+アナライザ識別 |

augur-lens の責務は「フレームを数値にする」ことまでであり、予算判定・計画立案は
Augur が行う。**augur-lens は合否を判断しない**(数値と参考情報のみ出力する)。

## 2. スコープ

### やること

- スクリーンショット群(PNG)と動画(MP4/H.264)を入力に取る。
- 4 種のアナライザを実行する: 知覚差分 / アーティファクト検出 / HUD 判読性 / 内容分類。
- 結果を Augur の `media_analysis` シグナル JSON として出力する。

### やらないこと(MUST NOT)

- ゲームプロセスの起動・操作(キャプチャ自体はゲーム側ハーネスの責務。
  augur-lens はキャプチャ「済み」メディアの解析ツールである)。
- Augur API の呼び出し(出力 JSON を呼び出し元が `runtimeSignals` に載せる)。
- 合否判定・レーティングの認定(分類結果の出力まで。確定は人間レビュー)。
- 画像・動画のネットワーク送信(§8 の VLM 分類を除く。VLM 利用時も送信対象は
  サンプリングされたフレームのみ)。

## 3. 技術スタックと依存(固定)

| 項目 | 選定 | 備考 |
| --- | --- | --- |
| 言語 | TypeScript (strict) | Augur 本体と揃える |
| ランタイム | Node.js 20 LTS | |
| CLI | `commander@^12` | |
| 画像処理 | `sharp@^0.33` | デコード、リサイズ、生ピクセル取得 |
| 動画フレーム抽出 | `ffmpeg`(外部コマンド、パスは `LENS_FFMPEG_PATH`) | `-vf fps=<rate>` で抽出 |
| OCR | `tesseract.js@^5` | 言語データは `eng`+`jpn` 固定 |
| スキーマ検証 | `zod@^3` | 入出力とも zod が単一の真実 |
| テスト | `vitest@^3` | |
| VLM クライアント | `openai@^4`(公式 SDK) | §8 のみで使用。抽象化必須 |

上記以外の実行時依存を追加してはならない。SSIM・アーティファクト検出は
**自前実装**する(§5, §6 にアルゴリズムを完全指定する。外部 SSIM ライブラリは
実装差が出るため使用禁止)。

## 4. パッケージ構成(固定)

```text
augur-lens/
  package.json            # name: "augur-lens", type: "module"
  src/
    cli.ts                # コマンド定義のみ。ロジックを書かない
    config.ts             # zod スキーマ: LensConfig, RatingProfile, HudManifest
    media/
      frames.ts           # 動画->フレーム抽出 (ffmpeg)、PNG 読み込み (sharp)
      pixels.ts           # RGBA 取得、グレースケール変換、リサイズ
    analyzers/
      goldenDiff.ts       # §5
      artifacts.ts        # §6
      hud.ts              # §7
      rating.ts           # §8
    vlm/
      provider.ts         # interface VlmProvider { classify(imagesBase64, prompt): Promise<string> }
      openai.ts           # 実プロバイダ (temperature 0)
      fake.ts             # テスト用: 固定応答を返す
    signals.ts            # 解析結果 -> media_analysis シグナル JSON (§9)
  test/
    fixtures/             # 合成画像はテスト内で生成し、ここには置かない
    unit/                 # アナライザごと 1 ファイル
    golden/               # 入力フィクスチャ -> 期待シグナル JSON
```

依存方向は一方通行: `cli` → `analyzers`/`signals` → `media`/`config`。
`analyzers` は互いに import しない。

## 5. アナライザ 1: 知覚差分 `golden_image_diff`

候補ビルドのショットを承認済みゴールデン参照と比較する。

アルゴリズム(この通りに実装する。改変 MUST NOT):

1. 両画像を sharp で **幅 960px**(高さはアスペクト維持、`fit: 'inside'`,
   `kernel: 'lanczos3'`)にリサイズし、8bit グレースケール化する
   (`gray = round(0.299*R + 0.587*G + 0.114*B)`)。
2. 寸法が一致しない場合はエラー(値 100 を返さない。§9 の `error` 出力)。
3. **8×8 ピクセルの非重複ウィンドウ**ごとに SSIM を計算する:
   `SSIM = ((2*μx*μy + C1)*(2*σxy + C2)) / ((μx²+μy²+C1)*(σx²+σy²+C2))`,
   `C1 = (0.01*255)²`, `C2 = (0.03*255)²`。端数ウィンドウ(8px に満たない右端・下端)は捨てる。
4. `mssim = 全ウィンドウの SSIM の算術平均`。
5. `golden_image_diff = round((1 - mssim) * 100 * 100) / 100`(% 単位、小数 2 桁丸め、
   丸めは half-up)。

ショットごとに 1 シグナルを出力する。`scope` はショット ID(ファイル名から拡張子を
除いたもの)。マスク・除外領域機能は実装しない(除外は Augur 側の exemption で扱う)。

## 6. アナライザ 2: アーティファクト検出 `render_artifact_count`

動画(`fps=4` で抽出したフレーム列)または画像列を検査し、検出数の合計を 1 シグナルで
出力する。検出器は次の 3 つ**のみ**:

| 検出器 | 規則(1 フレーム単位で判定) |
| --- | --- |
| placeholder_texture | RGB が `R≥240, G≤15, B≥240`(マゼンタ)の画素が全画素の **1.0%** を超える |
| solid_corruption | 完全同色(全画素の RGB が一致)のフレーム。ただし輝度 `gray ≤ 8`(暗転)と `gray ≥ 247`(ホワイトアウト)は除外 |
| flicker | 隣接フレームとの平均輝度差 `|meanY[i] - meanY[i-1]| ≥ 48` が **3 フレーム連続**で符号反転しながら発生 |

- 同一検出器が連続フレームで発火し続ける場合、**連続区間 1 つで 1 カウント**とする
  (フレームごとに数えない)。
- カウント合計を `render_artifact_count`(unit: `count`)として出力する。
- 各検出はログ(stderr)に `detector, frame index, timestamp` を 1 行ずつ出す。

## 7. アナライザ 3: HUD 判読性 `hud_legibility_failures`

入力: スクリーンショット + **HUD マニフェスト**(呼び出し元が用意する JSON)。

```json
{
  "elements": [
    { "id": "hp-bar-label", "text": "HP", "region": { "x": 0.02, "y": 0.05, "w": 0.10, "h": 0.06 } }
  ]
}
```

- `region` は左上原点の相対座標(0〜1)。判定はスクリーンショットごと・要素ごと:
  region を切り出し、幅 480px に拡大してから tesseract で OCR し、`text` が
  **正規化後に含まれれば合格**。正規化 = NFKC、空白除去、大文字化。
- 不合格要素 1 つにつき 1 カウント。合計を `hud_legibility_failures` として、
  スクリーンショット(解像度)ごとに 1 シグナル出力する(`scope` は
  `"<マニフェスト名> @ <幅>x<高さ>"`)。
- OCR の confidence は使用しない(含有一致のみ。モデル・バージョン差の影響を減らすため)。

## 8. アナライザ 4: 内容分類 `rating_violation_count` / `prohibited_expression_count`

レーティング記述子(暴力・出血など)に対するフレーム分類。**モデル差異を抑える設計が
最重要**であり、以下を固定する。

### 8.1 レーティングプロファイル(設定ファイル、ツールに埋め込まない)

```json
{
  "profileId": "cero-b-jp",
  "body": "CERO",
  "tier": "B",
  "descriptors": [
    { "id": "violence",      "maxLevel": 2 },
    { "id": "blood",         "maxLevel": 1 },
    { "id": "sexual",        "maxLevel": 1 },
    { "id": "language",      "maxLevel": 2 }
  ],
  "prohibited": ["dismemberment_with_cruelty", "explicit_sexual_organ"]
}
```

- `descriptors[].id` と `prohibited[]` の語彙は上の 6 語 +
  `horror`, `gambling`, `crime`, `drugs` の計 10 語に固定する(zod enum)。
- レベルは **0〜4 の整数**(0=なし, 1=軽微, 2=中程度, 3=強い, 4=極端)。
- **注意: CERO の詳細な審査基準は非公開である。プロファイルの数値はスタジオ内部の
  近似ルーブリックであり、ツールは「プロファイルとの照合」だけを行う。CERO 準拠の
  最終判断は審査機関にある。** この注意書きをツールの README にも記載すること。

### 8.2 フレームサンプリングと分類手順

1. 動画から `fps=2` でフレームを抽出する(スクリーンショット入力はそのまま)。
2. 各フレームを幅 768px にリサイズし、VLM に **1 フレームずつ**送る(バッチ禁止。
   文脈の混入で判定が揺れるため)。
3. VLM 呼び出しは `temperature: 0`、`response_format: json_schema`(§8.3 のスキーマを
   そのまま渡す)。リトライは同一入力で最大 2 回、指数バックオフ。
4. 判定: フレームの `levels[descriptor] > maxLevel` なら **violation 候補**。
   `prohibited` のいずれかが `true` なら **prohibited 候補**。
5. 連続フレームの同一記述子違反は 1 区間 = 1 カウント(§6 と同じ規則)。
6. 出力は 2 シグナル: `rating_violation_count`, `prohibited_expression_count`
   (いずれも unit: `count`)。加えて候補フレームの一覧(フレーム index、タイムスタンプ、
   記述子、レベル)を `review/<scope>.json` に書き出す。**このファイルが人間レビューの
   入力であり、シグナルの `source` に `"pending human review"` を必ず含める**(レビュー
   済みの確定値を出す場合は CLI の `--reviewed <file>` で確定一覧を渡し、その件数だけを
   カウントし `source` から pending を外す)。

### 8.3 VLM プロンプト(逐語。翻訳・言い換え MUST NOT)

system:

```text
You are a frame classifier for video game content rating pre-checks.
Classify ONLY what is visibly rendered in the supplied frame.
Do not infer events outside the frame. Do not consider artistic intent.
Respond ONLY with JSON matching the provided schema.
Levels: 0=absent, 1=mild, 2=moderate, 3=strong, 4=extreme.
Rules of thumb:
- blood: 1=small stains, 2=visible pooling or sprays, 3=large amounts on bodies/environment, 4=gore focus.
- violence: 1=cartoon impact, 2=realistic strikes without injury detail, 3=injury detail, 4=cruelty focus.
If unsure between two levels, choose the HIGHER one.
```

user(フレームごと):

```text
Classify this frame. descriptors: violence, blood, sexual, language, horror, gambling, crime, drugs.
prohibited flags: dismemberment_with_cruelty, explicit_sexual_organ.
```

JSON スキーマ(response_format 用):

```json
{
  "type": "object",
  "properties": {
    "levels": {
      "type": "object",
      "properties": {
        "violence": {"type": "integer", "minimum": 0, "maximum": 4},
        "blood": {"type": "integer", "minimum": 0, "maximum": 4},
        "sexual": {"type": "integer", "minimum": 0, "maximum": 4},
        "language": {"type": "integer", "minimum": 0, "maximum": 4},
        "horror": {"type": "integer", "minimum": 0, "maximum": 4},
        "gambling": {"type": "integer", "minimum": 0, "maximum": 4},
        "crime": {"type": "integer", "minimum": 0, "maximum": 4},
        "drugs": {"type": "integer", "minimum": 0, "maximum": 4}
      },
      "required": ["violence", "blood", "sexual", "language", "horror", "gambling", "crime", "drugs"],
      "additionalProperties": false
    },
    "prohibited": {
      "type": "object",
      "properties": {
        "dismemberment_with_cruelty": {"type": "boolean"},
        "explicit_sexual_organ": {"type": "boolean"}
      },
      "required": ["dismemberment_with_cruelty", "explicit_sexual_organ"],
      "additionalProperties": false
    }
  },
  "required": ["levels", "prohibited"],
  "additionalProperties": false
}
```

「迷ったら高い方」を規定しているのは、モデル間のぶれを**安全側(過検出)に倒す**ためで
ある。過検出は人間レビューで落ちるが、見逃しは落ちない。

## 9. 出力契約(Augur との接続点)

CLI は解析結果を次の JSON で stdout に出力する(これをそのまま
`CreatePlanRequest.runtimeSignals` に連結できる):

```json
{
  "signals": [
    {
      "type": "media_analysis",
      "name": "golden_image_diff",
      "value": 7.5,
      "unit": "%",
      "scope": "chapter3-vista",
      "source": "augur-lens 1.0.0 / golden-diff ssim-8x8"
    }
  ],
  "errors": [
    { "analyzer": "golden_diff", "scope": "shot-12", "message": "dimension mismatch: 1920x1080 vs 1280x720" }
  ]
}
```

- `source` は必ず `"augur-lens <version> / <analyzer id> <algorithm id>"` 形式。
  §8 は `... / rating-classifier <model id>, pending human review` 形式。
- 解析不能は `errors[]` に入れ、シグナルを捏造しない。exit code は
  0=全解析成功、1=一部解析失敗(errors あり)、2=入力不正。

CLI コマンド(固定):

```text
lens golden-diff --candidate <dir> --reference <dir>
lens artifacts   --video <file> | --frames <dir>
lens hud         --shots <dir> --manifest <file>
lens rating      --video <file> --profile <file> [--reviewed <file>] [--scope <name>]
lens all         --config <lens.config.json>
```

## 10. 決定性要件

- §5〜§7 は純関数として実装する: 同一入力バイト列 → 同一出力(浮動小数は
  上記の丸め規定で吸収)。`Date.now()` / `Math.random()` を解析経路で使用 MUST NOT
  (Augur 本体と同じ ESLint 規則を設定する)。
- §8 のみ非決定性が残る。緩和策: temperature 0、response_format 固定、1 フレーム
  1 呼び出し、「迷ったら高い方」規定、人間レビューによる確定。CI では `vlm/fake.ts`
  を使い、実 VLM をテスト経路に入れない。
- 出力 JSON のキー順・配列順は入力ファイル名の辞書順で安定させる。

## 11. 実装マイルストーン(順守)

| # | 内容 | 受け入れ基準 |
| --- | --- | --- |
| M1 | 雛形 + `media/` + `config.ts` | `npm run build && npm run lint && npm run test` が空実装で緑 |
| M2 | §5 golden-diff | 合成画像ユニットテスト: 同一画像→0.00、反転画像→90 以上、既知ペアの期待値一致 |
| M3 | §6 artifacts | 合成フレーム列テスト: マゼンタ 2% 注入→1、暗転→0、フリッカ 3 連→1 |
| M4 | §7 hud | 合成テキスト画像で合格/不合格の両方を検証 |
| M5 | §8 rating (fake provider) | fake 応答での区間カウント・review ファイル・--reviewed 経路を検証 |
| M6 | §9 CLI 統合 + golden テスト | フィクスチャ入力→期待シグナル JSON の完全一致テスト |
| M7 | openai provider 結線 | 環境変数 `LENS_VLM_API_KEY` 無しでも §5〜§7 が動く(rating のみ要求時エラー) |

各マイルストーンのテストは合成画像(単色・ノイズ・図形を sharp で生成)を用い、
バイナリフィクスチャをリポジトリにコミットしない。

## 12. デフォルト表(未規定事項はここに従う)

| 事項 | デフォルト |
| --- | --- |
| 対応入力形式 | PNG(画像)、MP4/H.264(動画)。それ以外は exit 2 |
| カラープロファイル | 無視(sRGB とみなす) |
| 動画の音声 | 使用しない |
| 並列度 | フレーム解析は逐次(並列化しない。順序安定のため) |
| ログ | stderr にプレーンテキスト、stdout は §9 の JSON のみ |
| 設定ファイル探索 | しない(パスは常に引数で受ける) |
| i18n | ツールのメッセージは英語 |

## 13. 関連仕様

- [Media-Based Testing](./feature/media-based-testing.md) — 本ツールが従う契約
- [Core Data Schema](./data/core-schema.md) — `RuntimeSignal` / `media_analysis`
- [Experience Goal Catalog](./data/experience-goal-catalog.md) — EG-G11 / EG-G12
- [Implementation Design](./implementation-design.md) — Augur 本体の設計(参照実装のスタイル)
