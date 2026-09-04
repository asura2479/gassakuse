# ショート動画 制作パイプライン

VOICEVOX の台本CSVから、ナレーション・字幕・カット割りを作り、本編を書き出すまでの一式。
`.claude/skills/short-script` で書いた台本を、そのまま動画にするための道具。

## 必要なもの

- Python 3
- ffmpeg（`winget install Gyan.FFmpeg` / `apt install ffmpeg`）
- VOICEVOX（音声を作るときのみ。起動しておくこと）

## 使い方

作業フォルダに移動する。

    cd tools/short-video

### 1. ナレーションを書き出す

VOICEVOX を起動した状態で:

    python render_voice.py --csv scripts/sheet4_linia.csv

`wavs/001.wav`〜 と、繋いだ `wavs/narration.wav` が出る。

    python render_voice.py --list           # 話者一覧
    python render_voice.py --speed 0.95     # 60秒を割ったとき少し遅くする

既定は四国めたん（ノーマル）。60秒未満なら警告と対処法が出る。

### 2. 実尺で字幕とカット割りを組む

    python make_timing.py --csv scripts/sheet4_linia.csv --wav-dir wavs

行ごとの実尺を読んで、`out/` に以下を書き出す。

| ファイル | 中身 |
|---|---|
| `sheet4_linia.srt` | 字幕（編集ソフト取り込み用） |
| `sheet4_linia.ass` | 字幕（焼き込み用・縦1080x1920） |
| `timesheet.csv` | 全行の IN/OUT・字数・ブロック |
| `shots.csv` | 16カットの素材割り当て表 |

音声がまだ無いときは推定で組める。

    python make_timing.py --csv scripts/sheet4_linia.csv              # 6.2字/秒で推定
    python make_timing.py --csv scripts/sheet4_linia.csv --total 63.5 # 総尺だけ分かっている
    python make_timing.py --csv scripts/sheet4_linia.csv --audio narration.wav

字幕フォントは Windows なら游ゴシック、それ以外は IPAGothic を既定で使う。
`--font "Meiryo"` のように上書きできる。

### 3. 素材を割り当てる

`out/shots.csv` の `src` にファイルのパス、`in` に動画の開始秒（静止画なら0）を入れる。
`start` / `end` は触らない。空欄のカットは黒地で書き出されるので、抜けが一目で分かる。

静止画にはゆっくり寄る/引く動きが自動で付く（カットごとに交互）。

### 4. 書き出す

    python build_short.py --narration wavs/narration.wav --out final.mp4
    python build_short.py --narration wavs/narration.wav --bgm bgm.mp3 --bgm-db -22 --out final.mp4

1080x1920 / 30fps。素材はセンタークロップされ、字幕が焼き込まれる。

## 台本CSVの形式

`話者,テキスト` の2列。1行1セリフ。`scripts/` に置く。

    四国めたん,とある日。
    四国めたん,エリスが、拾いものをして帰ってきた。

## 尺について

TikTok の収益条件が1分以上なので、**60秒を割ってはいけない**。
話速は TTS 設定でぶれるため、必ず実尺を測ってから確定すること。
足りないときは台本に「保険行」を足す（`short-script` スキルの format.md を参照）。
