#!/usr/bin/env python3
"""shots.csv の割り当て + ナレーション + 字幕 から ショート本編を書き出す。

素材は動画でも静止画でもよい。静止画はゆっくり寄る/引く動きが自動で付く。

  python3 build_short.py --narration narration.wav --out final.mp4

各素材は 1080x1920 にセンタークロップされ、start/end の尺どおりに繋がれる。
src が空のブロックは黒地で埋まる（未割り当てが一目で分かる）。
"""
import argparse, csv, io, os, subprocess, sys

W, H = 1080, 1920
STILL = (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff")

def read_shots(p):
    out = []
    with io.open(p, encoding="utf-8") as f:
        for row in csv.DictReader(l for l in f if not l.startswith("#")):
            out.append(row)
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shots", default="out/shots.csv")
    ap.add_argument("--subs", default="out/sheet4_linia.ass")
    ap.add_argument("--narration", help="VOICEVOX で書き出した音声。省略すると無音")
    ap.add_argument("--bgm"); ap.add_argument("--bgm-db", type=float, default=-22.0)
    ap.add_argument("--out", default="out/final.mp4")
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--zoom", type=float, default=0.12, help="静止画のズーム量")
    a = ap.parse_args()

    shots = read_shots(a.shots)
    inputs, filters, segs, missing = [], [], [], []

    for i, s in enumerate(shots):
        dur = float(s["end"]) - float(s["start"])
        src, seek = (s.get("src") or "").strip(), float(s.get("in") or 0)
        still = src.lower().endswith(STILL)
        idx = len(segs)

        if src and os.path.exists(src):
            if still: inputs += ["-loop", "1", "-t", f"{dur:.3f}", "-i", src]
            else:     inputs += ["-ss", str(seek), "-t", f"{dur:.3f}", "-i", src]
        else:
            if src: print(f"  !! 見つからない: {src}", file=sys.stderr)
            missing.append(s["shot"])
            still = False
            inputs += ["-f", "lavfi", "-t", f"{dur:.3f}", "-i", f"color=c=black:s={W}x{H}:r={a.fps}"]

        if still:
            # 静止画は止めて置くと死ぬので、ゆっくり寄る/引く。カットごとに向きを変える。
            n_fr = max(2, round(dur * a.fps))
            z = (f"min(1+{a.zoom/n_fr:.6f}*on,{1+a.zoom})" if idx % 2 == 0
                 else f"max({1+a.zoom}-{a.zoom/n_fr:.6f}*on,1)")
            filters.append(
                f"[{idx}:v]scale={W*2}:{H*2}:force_original_aspect_ratio=increase,"
                f"crop={W*2}:{H*2},"
                f"zoompan=z='{z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
                f":d={n_fr}:s={W}x{H}:fps={a.fps},"
                f"setsar=1,trim=duration={dur:.3f},setpts=PTS-STARTPTS[v{idx}]")
        else:
            filters.append(
                f"[{idx}:v]scale={W}:{H}:force_original_aspect_ratio=increase,"
                f"crop={W}:{H},setsar=1,fps={a.fps},"
                f"trim=duration={dur:.3f},setpts=PTS-STARTPTS[v{idx}]")
        segs.append(f"[v{idx}]")

    # ffmpeg のフィルタ引数はバックスラッシュを解釈するので / に直し、
    # ドライブレターのコロン（C:）だけをエスケープする
    subs = os.path.abspath(a.subs).replace("\\", "/").replace(":", r"\:")
    ass = f"ass={subs}"
    fdir = "/usr/share/fonts/opentype/ipafont-gothic"
    if os.path.isdir(fdir):
        ass += f":fontsdir={fdir}"
    chain = "".join(segs) + f"concat=n={len(segs)}:v=1:a=0[cat];[cat]{ass}[vout]"
    fc = ";".join(filters) + ";" + chain

    cmd = ["ffmpeg", "-y", "-hide_banner"] + inputs
    amap, n = [], len(segs)
    if a.narration: cmd += ["-i", a.narration]; amap.append(f"[{n}:a]"); n += 1
    if a.bgm: cmd += ["-stream_loop", "-1", "-i", a.bgm]; amap.append(f"[{n}:a]"); n += 1

    if len(amap) == 2:
        fc += f";{amap[1]}volume={a.bgm_db}dB[bg];{amap[0]}[bg]amix=inputs=2:duration=first:dropout_transition=0[aout]"
        acodec = ["-map", "[aout]", "-c:a", "aac", "-b:a", "192k"]
    elif len(amap) == 1:
        acodec = ["-map", amap[0].strip("[]"), "-c:a", "aac", "-b:a", "192k"]
    else:
        acodec = ["-an"]

    cmd += ["-filter_complex", fc, "-map", "[vout]"] + acodec + [
        "-c:v", "libx264", "-preset", "medium", "-crf", "20",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-shortest", a.out]

    print(" ".join(cmd[:6]), "...")
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        print(r.stderr[-3000:], file=sys.stderr); sys.exit(1)
    print(f"\n書き出し完了: {a.out}")
    if missing:
        print(f"未割り当て（黒地のまま）{len(missing)}カット: {', '.join(missing)}")

main()
