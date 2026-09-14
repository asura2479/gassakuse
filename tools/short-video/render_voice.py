#!/usr/bin/env python3
"""起動中の VOICEVOX ENGINE に台本を投げて、1行ずつ音声を書き出す。

  python3 render_voice.py                       # 既定: 四国めたん(ノーマル)
  python3 render_voice.py --speed 0.95          # 60秒を割ったとき少し遅くする
  python3 render_voice.py --list                # 使える話者を一覧表示

VOICEVOX を起動したPCで実行すること（既定の接続先は http://127.0.0.1:50021）。
書き出し後は make_timing.py --wav-dir wavs/ で字幕を実尺に合わせる。
"""
import argparse, csv, io, json, os, sys, urllib.error, urllib.parse, urllib.request, wave

# localhost に proxy を通さない
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def call(base, path, params=None, body=None, timeout=120):
    url = base.rstrip("/") + path + ("?" + urllib.parse.urlencode(params) if params else "")
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method="GET" if data is None and not params else "POST")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with OPENER.open(req, timeout=timeout) as r:
            return r.read()
    except urllib.error.URLError as e:
        sys.exit(f"VOICEVOX に繋がりません ({url})\n  {e}\n"
                 f"  → エンジンが起動しているか、--host が合っているか確認してください。")


def find_speaker(base, name, style):
    speakers = json.loads(call(base, "/speakers"))
    for sp in speakers:
        if name in sp["name"]:
            for st in sp["styles"]:
                if st["name"] == style:
                    return st["id"], f'{sp["name"]}（{st["name"]}）'
            avail = "/ ".join(s["name"] for s in sp["styles"])
            sys.exit(f'{sp["name"]} に「{style}」がありません。使えるのは: {avail}')
    sys.exit(f"話者「{name}」が見つかりません。--list で一覧を確認してください。")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", default="sheet4_linia.csv")
    ap.add_argument("--host", default="http://127.0.0.1:50021")
    ap.add_argument("--speaker", default="四国めたん")
    ap.add_argument("--style", default="ノーマル")
    ap.add_argument("--speed", type=float, default=1.0, help="話速。60秒を割ったら 0.95 など")
    ap.add_argument("--outdir", default="wavs")
    ap.add_argument("--list", action="store_true", help="話者一覧を出して終了")
    a = ap.parse_args()

    if a.list:
        for sp in json.loads(call(a.host, "/speakers")):
            print(f'{sp["name"]}: ' + " / ".join(f'{s["name"]}={s["id"]}' for s in sp["styles"]))
        return

    sid, label = find_speaker(a.host, a.speaker, a.style)
    print(f"話者: {label} (id={sid}) / 話速 {a.speed}")

    lines = [r[1].strip() for r in csv.reader(io.open(a.csv, encoding="utf-8"))
             if len(r) >= 2 and r[1].strip()]
    os.makedirs(a.outdir, exist_ok=True)

    total = 0.0
    for i, text in enumerate(lines, 1):
        q = json.loads(call(a.host, "/audio_query", params={"text": text, "speaker": sid}))
        q["speedScale"] = a.speed
        wav = call(a.host, "/synthesis", params={"speaker": sid}, body=q)
        path = os.path.join(a.outdir, f"{i:03d}.wav")
        with open(path, "wb") as f:
            f.write(wav)
        with wave.open(path) as w:
            d = w.getnframes() / w.getframerate()
        total += d
        print(f"  {i:3d}/{len(lines)}  {d:5.2f}s  {text}")

    # build_short.py はナレーション1本を受け取るので、繋いだものも作っておく
    joined = os.path.join(a.outdir, "narration.wav")
    with wave.open(joined, "wb") as out:
        for i in range(1, len(lines) + 1):
            with wave.open(os.path.join(a.outdir, f"{i:03d}.wav")) as w:
                if i == 1: out.setparams(w.getparams())
                out.writeframes(w.readframes(w.getnframes()))
    print(f"\n繋いだナレーション: {joined}")

    print(f"{len(lines)}行 / 合計 {total:.1f} 秒 / 実測 {sum(len(t) for t in lines)/total:.2f} 字per秒")
    if total < 60:
        print("!! 60秒未満です。TikTokの収益条件を割ります。")
        print("   保険行を足すか、--speed 0.95 で書き出し直してください。")
        print("   保険行: 「教室の誰もが、道を空けた。」→『獣族の、族長の娘。』の直後")
        print("           「商会そのものが、なかった。」→『男は消えた。』の直後")
    else:
        print("OK。次の2つ:")
        print(f"  python3 make_timing.py --wav-dir {a.outdir}")
        print(f"  python3 build_short.py --narration {joined} --out final.mp4")


main()
