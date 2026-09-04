#!/usr/bin/env python3
"""シート4台本 -> SRT / ASS / 編集タイムシート を生成する。

既定は 6.2 字/秒（channel.md の未較正の推定値）。
VOICEVOX の実尺が出たら --cps か --total で上書きすること。
"""
import argparse, csv, io, os, platform, re, subprocess, sys

SHOTS = [  # (開始行index, 終了行index, 必要な画)
    (0,  1,  "屋敷の玄関。エリスが扉を開けて入ってくる（腕に何かを抱えている）"),
    (2,  2,  "エリスの顔アップ。得意げ"),
    (3,  4,  "薄暗い地下室。奥に座り込む人影と首輪"),
    (5,  6,  "リニア（ボロ布・猫耳・うつむき）"),
    (7,  8,  "回想＝魔法大学の廊下。制服のリニア（不敵）"),
    (9,  10, "デドルディア族の村。族長の前に立つリニア"),
    (11, 13, "町の門を出ていく後ろ姿と荷馬車"),
    (14, 15, "帳簿と借用書。減っていく硬貨"),
    (16, 17, "商人の男が笑顔で近づく（顔は影）"),
    (18, 19, "商会バッジのアップ（偽物）"),
    (20, 21, "誰もいない空き店舗。借用書だけが残る"),
    (22, 23, "馬車と商品が運び出される／連れて行かれるリニア"),
    (24, 25, "奴隷市場の路地を逃げる／尻尾を掴まれる"),
    (26, 27, "路地の角からそれを見ているエリス"),
    (28, 29, "地下室のリニアへ戻る（3〜4カット目と同構図）"),
    (30, 30, "屋敷の外観。引きの絵"),
]

BLOCKS = [  # (開始行index, ブロック名, 素材メモ)
    (0,  "とある日＋事件",   "エリス（成人後）／扉を開けて入ってくる"),
    (3,  "引き＝謎の提示",   "地下室／首輪・ボロ姿のリニア"),
    (7,  "背景の最小説明",   "魔法大学のリニア → 村・族長 → 町を出る後ろ姿"),
    (14, "理由の提示",       "帳簿・借金／近づく商人"),
    (19, "2段目＝本命",      "偽バッジのアップ／消えた男／借用書"),
    (22, "回収",             "奴隷市場／逃走／尻尾／それを見るエリス"),
    (28, "未完了エンド",     "地下室のリニアへ戻る（冒頭の絵を再利用）"),
]

def ts(sec, comma=True):
    h, rem = divmod(sec, 3600); m, s = divmod(rem, 60)
    frac = f"{s:06.3f}".replace('.', ',' if comma else '.')
    return f"{int(h):02d}:{int(m):02d}:{frac}"

def ass_ts(sec):
    h, rem = divmod(sec, 3600); m, s = divmod(rem, 60)
    return f"{int(h):d}:{int(m):02d}:{s:05.2f}"

def block_of(i):
    name = mat = ""
    for start, n, m in BLOCKS:
        if i >= start: name, mat = n, m
    return name, mat

def probe(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                        "-of", "csv=p=0", path], capture_output=True, text=True)
    if r.returncode: sys.exit(f"読めません: {path}")
    return float(r.stdout.strip())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", default="sheet4_linia.csv")
    ap.add_argument("--cps", type=float, default=6.2, help="話速（字/秒）")
    ap.add_argument("--total", type=float, help="実測した総尺(秒)。指定すると cps を逆算する")
    ap.add_argument("--audio", help="書き出した音声1本。総尺を自動で読み取る")
    ap.add_argument("--wav-dir", help="VOICEVOXの1行ずつ書き出しフォルダ。"
                                     "行ごとの実尺を読んで字幕を完全に合わせる（最も正確）")
    ap.add_argument("--outdir", default="out")
    ap.add_argument("--font", default=None,
                    help="字幕フォント名。既定は Windows=Yu Gothic / その他=IPAGothic")
    a = ap.parse_args()

    lines = []
    with io.open(a.csv, encoding="utf-8") as f:
        for row in csv.reader(f):
            if len(row) >= 2 and row[1].strip():
                lines.append(row[1].strip())

    n = sum(len(t) for t in lines)
    os.makedirs(a.outdir, exist_ok=True)

    durs = None
    if a.wav_dir:
        # 001.wav のような連番だけを拾う（narration.wav などが混ざっても数を狂わせない）
        AUD = (".wav", ".mp3", ".m4a", ".flac")
        cand = [f for f in os.listdir(a.wav_dir) if f.lower().endswith(AUD)]
        numbered = [f for f in cand if re.match(r"^\d+\D", f) or os.path.splitext(f)[0].isdigit()]
        wavs = sorted(numbered or cand,
                      key=lambda f: (int(re.match(r"^(\d+)", f).group(1))
                                     if re.match(r"^(\d+)", f) else 0, f))
        if len(wavs) != len(lines):
            sys.exit(f"音声 {len(wavs)} 本 と 台本 {len(lines)} 行 が合いません。"
                     f"\nVOICEVOX から1行ずつ書き出したフォルダを指定してください。")
        durs = [probe(os.path.join(a.wav_dir, w)) for w in wavs]
    elif a.audio:
        a.total = probe(a.audio)

    cps = n / a.total if a.total else a.cps
    cues, t = [], 0.0
    for i, text in enumerate(lines):
        d = durs[i] if durs else len(text) / cps
        cues.append((i, t, t + d, text)); t += d
    total = t

    with io.open(f"{a.outdir}/sheet4_linia.srt", "w", encoding="utf-8") as f:
        for i, s, e, text in cues:
            f.write(f"{i+1}\n{ts(s)} --> {ts(e)}\n{text}\n\n")

    font = a.font or ("Yu Gothic" if platform.system() == "Windows" else "IPAGothic")
    head = """[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Base,{FONT},52,&H00FFFFFF,&H000000FF,&H00202020,&H80000000,-1,0,0,0,100,100,0,0,1,6,2,2,60,60,420,1
Style: Serifu,{FONT},56,&H0060E8FF,&H000000FF,&H00202020,&H80000000,-1,0,0,0,100,100,0,0,1,6,2,2,60,60,420,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    with io.open(f"{a.outdir}/sheet4_linia.ass", "w", encoding="utf-8") as f:
        f.write(head.replace("{FONT}", font))
        for i, s, e, text in cues:
            style = "Serifu" if "「" in text else "Base"
            f.write(f"Dialogue: 0,{ass_ts(s)},{ass_ts(e)},{style},,0,0,0,,{text}\n")

    with io.open(f"{a.outdir}/timesheet.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["No", "IN", "OUT", "秒数", "字数", "ブロック", "テキスト", "必要な画"])
        prev = None
        for i, s, e, text in cues:
            b, mat = block_of(i)
            w.writerow([i+1, ts(s, False), ts(e, False), f"{e-s:.2f}", len(text),
                        b, text, mat if b != prev else ""])
            prev = b

    print(f"字幕フォント: {font}")
    src = "行ごとの実測" if durs else ("総尺の実測" if a.audio or a.total else "推定")
    print(f"行数 {len(lines)} / 総文字数 {n} / 話速 {n/total:.2f} 字per秒"
          f" / 総尺 {total:.1f} 秒 ({src})")
    print(f"収益条件(60秒以上): {'OK' if total >= 60 else 'NG ← 保険行を足すこと'}")
    for i, s, e, text in cues:
        if "「" in text:
            print(f"初セリフ {s:.1f} 秒: {text}"); break
    nxt = 0
    for no, (s0, s1) in enumerate((x[0], x[1]) for x in SHOTS):
        if s0 != nxt:
            sys.exit(f"カット割りが不正です: S{no+1:02d} が行{s0}から始まっていますが、"
                     f"直前のカットは行{nxt-1}で終わっています（隙間か重なり）")
        nxt = s1 + 1
    if nxt != len(lines):
        sys.exit(f"カット割りが台本全{len(lines)}行を覆っていません（{nxt}行目まで）")

    with io.open(f"{a.outdir}/shots.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        f.write("# src に画像/動画のパス、in に動画の開始秒（画像なら0）を入れる。\n"
                "# start/end は触らない。空欄のカットは黒地で書き出される。\n")
        w.writerow(["start", "end", "shot", "src", "in", "内容"])
        for no, (s0, s1, desc) in enumerate(SHOTS, 1):
            w.writerow([f"{cues[s0][1]:.2f}", f"{cues[s1][2]:.2f}",
                        f"S{no:02d}", "", 0, desc])

    print("\nカット割り (shots.csv に出力):")
    for no, (s0, s1, desc) in enumerate(SHOTS, 1):
        print(f"  S{no:02d}  {cues[s0][1]:5.1f}-{cues[s1][2]:5.1f}s  {desc}")

main()
