import json, subprocess, sys, re, os

S = os.path.dirname(os.path.abspath(__file__))
U = "/root/.claude/uploads/ef05d1e4-544a-50a6-8709-b5c46e6672f8"
OUT = sys.argv[1]
ONLY = sys.argv[2:]

W, H = 1080, 1920
END_DUR = 3.2

# Brand palette (ASS colours are &HBBGGRR)
CREAM = "&HECF6FF&"      # #FFF6EC
PLUM = "&H3D1B2B&"       # #2B1B3D
CORAL = "&H5B50E8&"      # #E8505B
GOLD = "&H3FD2FF&"       # #FFD23F

offsets = {}
for line in open(f"{S}/offsets.txt"):
    i, o, d = line.split()
    offsets[i] = (float(o), float(d))
allwords = [w for w in json.load(open(f"{S}/words.json"))["words"] if w.get("type", "word") == "word"]

FIX = {"הרירי": "ערירי", "אותכם": "אתכם", "במסך": "במסע", "לכבד.": "לחבק."}

VIDEOS = {
 "0a7cc8b3": dict(n=1, slug="hitkasharetem", src=(576, 1024), y0=0.0, y1=0.79,
     title=["התקשרתם כבר", "{להורים} שלכם?"], cut=0.5, keys=["אזעקה", "עזרה", "באהבה", "ערירי"]),
 "7c51067d": dict(n=2, slug="lo-tenatzhu", src=(576, 1024), special="landscape",
     title=["בגיל הזהב?", "{לא תנצחו} אותנו!"], cut=None, keys=["תנצחו"]),
 "8bf71bc4": dict(n=3, slug="neyar-toilet", src=(480, 848), y0=0.265, y1=1.0,
     title=["מה גליל {נייר טואלט}", "אומר על ההורים שלכם?"], cut=0.5, keys=["קיומי.", "רזרבה", "מלחיץ", "באהבה."]),
 "8f6b96e1": dict(n=4, slug="shaon-metzuka", src=(576, 1024), y0=0.215, y1=1.0,
     title=["שעון מצוקה מציל חיים", "{אבל איפה הוא?}"], cut=0.5, keys=["האחריות?", "מציל", "חיים.", "לחבק."]),
 "941e384e": dict(n=5, slug="mi-masia-oti", src=(480, 848), y0=0.27, y1=1.0,
     title=["״{מי מסיע אותי?}״", "הטיפ שירגיע את ההורים"], cut=0.35, keys=["לחוצים.", "ביומן", "מראש.", "שלווה,", "רוגע,", "באהבה."]),
 "a0a28a44": dict(n=6, slug="sadnat-haatzama", src=(480, 852), y0=0.225, y1=1.0,
     title=["סדנת העצמה", "לנשות {גיל הזהב}"], cut=0.7, keys=["לאהוב", "חיונית.", "מאושרות."]),
 "ac8fc7be": dict(n=7, slug="rigei-nachat", src=(480, 848), y0=0.262, y1=1.0,
     title=["אמא שלי בת {89}", "והיא התעקשה לבוא"], cut=0.5, keys=["נחת", "לוותר.", "באהבה.", "חיים."]),
}


def ts(t):
    t = max(0, t)
    h = int(t // 3600); m = int(t % 3600 // 60); s = t % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def words_for(vid):
    off, dur = offsets[vid]
    out = []
    for w in allwords:
        if off - 0.05 <= w["start"] <= off + dur:
            t = FIX.get(w["text"], w["text"])
            out.append(dict(t=t, s=w["start"] - off, e=min(w["end"] - off, dur)))
    return out, dur


def segments(words, dur, gap):
    """Keep-segments in source time: speech with long pauses trimmed (jump cuts)."""
    if gap is None:
        return [(0.0, dur)]
    segs = []
    a = max(0, words[0]["s"] - 0.3)
    for w0, w1 in zip(words, words[1:]):
        if w1["s"] - w0["e"] > gap:
            segs.append((a, w0["e"] + 0.18))
            a = w1["s"] - 0.1
    segs.append((a, min(dur, words[-1]["e"] + 0.6)))
    return segs


def remap(t, segs):
    acc = 0
    for a, b in segs:
        if t < a:
            return acc
        if t <= b:
            return acc + t - a
        acc += b - a
    return acc


def chunks(words):
    out, cur = [], []
    for w in words:
        cur.append(w)
        txt = " ".join(x["t"] for x in cur)
        if len(cur) >= 3 or len(txt) >= 14 or re.search(r"[.,?!:]\"?$", w["t"]):
            out.append(cur); cur = []
    if cur:
        out.append(cur)
    return out


def clean(t):
    t = t.replace('"', "")
    return re.sub(r"[.,:]+$", "", t)


def title_text(line, size, base_col, hi_col):
    def rep(m):
        return "{\\c" + hi_col + "}" + m.group(1) + "{\\c" + base_col + "}"
    return "{\\fs%d\\c%s}" % (size, base_col) + re.sub(r"\{(.+?)\}", rep, line)


HEART = "m 0 30 b 0 5 35 -5 50 20 b 65 -5 100 5 100 30 b 100 60 65 80 50 100 b 35 80 0 60 0 30"


def build_ass(vid, cfg, words, segs, band, total):
    L = []
    L.append(f"""[Script Info]
ScriptType: v4.00+
PlayResX: {W}
PlayResY: {H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Rubik 900,118,&H00FFFFFF,&H00FFFFFF,&H00141414,&H96000000,0,0,0,0,100,100,0,0,1,9,6,5,50,50,0,-1
Style: Title,Rubik 900,72,&H002B1B3D,&H00FFFFFF,&H00FFFFFF,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,40,40,0,-1
Style: Small,Heebo 800,62,&H005B50E8,&H00FFFFFF,&H00FFFFFF,&H00000000,0,0,0,0,100,100,1,0,1,0,0,5,40,40,0,-1
Style: Shape,Rubik 900,20,&H00ECF6FF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text""")
    ev = lambda layer, a, b, st, txt: L.append(f"Dialogue: {layer},{ts(a)},{ts(b)},{st},,0,0,0,,{txt}")
    end_t = total - END_DUR

    # --- Top brand band (also hides the old burned-in captions) ---
    ev(0, 0, end_t, "Shape", "{\\pos(0,0)\\p1\\c%s}m 0 0 l %d 0 l %d %d l 0 %d{\\p0}" % (CREAM, W, W, band, band))
    ev(1, 0, end_t, "Shape", "{\\pos(0,%d)\\p1\\c%s}m 0 0 l %d 0 l %d 12 l 0 12{\\p0}" % (band - 12, CORAL, W, W))
    # brand line
    ev(2, 0, end_t, "Small", "{\\pos(540,%d)}ליאת  •  עכשיו תורנו לחבק" % (band * 0.2 + 10))
    l1, l2 = cfg["title"]
    longest = max(len(re.sub(r"[{}]", "", l1)), len(re.sub(r"[{}]", "", l2)))
    fs = 150 if longest <= 13 else (132 if longest <= 17 else 116)
    cy = band * 0.2 + 10 + (band - 12 - (band * 0.2 + 10)) / 2 + 8
    gapy = fs * 0.36
    # hook pop-in
    anim = "\\fscx70\\fscy70\\t(0,220,\\fscx106\\fscy106)\\t(220,340,\\fscx100\\fscy100)"
    ev(3, 0, end_t, "Title", "{\\pos(540,%d)%s}" % (cy - gapy, anim) + title_text(l1, fs, PLUM, CORAL))
    ev(3, 0.12, end_t, "Title", "{\\pos(540,%d)%s}" % (cy + gapy, anim) + title_text(l2, fs, PLUM, CORAL))

    # --- Word-by-word captions ---
    cap_y = cfg.get("cap_y", 1390)
    cks = chunks(words)
    for ci, ck in enumerate(cks):
        nxt = cks[ci + 1][0]["s"] if ci + 1 < len(cks) else ck[-1]["e"] + 0.6
        c_end_src = min(nxt, ck[-1]["e"] + 0.7)
        for wi, w in enumerate(ck):
            a = remap(w["s"], segs)
            b = remap(ck[wi + 1]["s"], segs) if wi + 1 < len(ck) else remap(c_end_src, segs)
            if b - a < 0.04:
                continue
            parts = []
            for k, x in enumerate(ck):
                t = clean(x["t"])
                key = any(x["t"].startswith(kk.rstrip(".,?")) for kk in cfg["keys"])
                if k == wi:
                    parts.append("{\\c%s\\fscx112\\fscy112}%s{\\c&HFFFFFF&\\fscx100\\fscy100}" % (GOLD, t))
                elif key:
                    parts.append("{\\c%s}%s{\\c&HFFFFFF&}" % ("&H8C86FF&", t))
                else:
                    parts.append(t)
            pop = "\\fscx80\\fscy80\\t(0,90,\\fscx100\\fscy100)" if wi == 0 else ""
            ev(5, a, min(b, end_t), "Cap", "{\\pos(540,%d)%s}" % (cap_y, pop) + " ".join(parts))

    # --- End card ---
    ev(6, end_t, total, "Shape", "{\\pos(0,0)\\p1\\c%s\\1a&H30&\\fad(250,0)}m 0 0 l %d 0 l %d %d l 0 %d{\\p0}" % (PLUM, W, W, H, H))
    ev(7, end_t + 0.15, total, "Shape", "{\\an5\\pos(540,620)\\p1\\c%s\\fscx240\\fscy240\\fad(200,0)\\t(0,300,\\fscx280\\fscy280)\\t(300,600,\\fscx240\\fscy240)}%s{\\p0}" % (CORAL, HEART))
    ev(7, end_t + 0.3, total, "Title", "{\\pos(540,880)\\fad(200,0)\\c%s\\fs150}חבקו אותם" % "&HFFFFFF&")
    ev(7, end_t + 0.3, total, "Title", "{\\pos(540,1040)\\fad(200,0)\\c%s\\fs150}באהבה" % GOLD)
    ev(7, end_t + 0.6, total, "Title", "{\\pos(540,1210)\\fad(200,0)\\c&HFFFFFF&\\fs76}ליאת  |  יועצת מוסמכת לגיל השלישי")
    ev(7, end_t + 0.6, total, "Title", "{\\pos(540,1300)\\fad(200,0)\\c&HFFFFFF&\\fs76}ולבני המשפחה")
    ev(7, end_t + 0.9, total, "Shape", "{\\an5\\pos(540,1480)\\p1\\c%s\\fad(200,0)}m 60 0 l 820 0 b 880 0 880 130 820 130 l 60 130 b 0 130 0 0 60 0{\\p0}" % CORAL)
    ev(8, end_t + 0.9, total, "Title", "{\\pos(540,1480)\\fad(200,0)\\c&HFFFFFF&\\fs74}לייעוץ  ←  הקישור בפרופיל")
    return "\n".join(L) + "\n"


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        print(r.stderr[-3000:]); raise SystemExit(1)


def build(vid, cfg):
    src = [f for f in os.listdir(U) if f.startswith(vid)][0]
    src = f"{U}/{src}"
    words, dur = words_for(vid)
    segs = segments(words, dur, cfg["cut"])
    body = sum(b - a for a, b in segs)
    total = body + END_DUR
    sw, sh = cfg["src"]

    f = []
    if cfg.get("special") == "landscape":
        # landscape footage letterboxed in a vertical frame: rebuild as blurred-fill vertical
        cy0, ch = 354, 316
        f.append(f"[0:v]crop={sw}:{ch}:0:{cy0},split[c1][c2]")
        f.append(f"[c1]scale=-2:{H},crop={W}:{H},gblur=sigma=40,eq=brightness=-0.08:saturation=1.2[bg]")
        f.append(f"[c2]scale={W}:-2,setsar=1[fg]")
        f.append(f"[bg][fg]overlay=0:(H-h)/2+120,setsar=1,fps=30[body]")
        band = 470
        cfg["cap_y"] = 1520
    else:
        y0p = int(sh * cfg["y0"]); chp = int(sh * (cfg["y1"] - cfg["y0"]))
        vh = int(round(chp * W / sw / 2)) * 2
        band = H - vh + 4
        vlabels = []
        zoom, since = False, 0.0
        for i, (a, b) in enumerate(segs):
            if i > 0 and since >= 2.2 and cfg["cut"] is not None:
                zoom, since = not zoom, 0.0
            since += b - a
            z = 1.12 if zoom else 1.0
            zw, zh = int(W * z / 2) * 2, int(vh * z / 2) * 2
            f.append(f"[0:v]trim=start={a:.3f}:end={b:.3f},setpts=PTS-STARTPTS,crop={sw}:{chp}:0:{y0p},"
                     f"scale={zw}:{zh}:flags=lanczos,crop={W}:{vh}:(iw-{W})/2:(ih-{vh})*0.3,setsar=1,fps=30[v{i}]")
            f.append(f"[0:a]atrim=start={a:.3f}:end={b:.3f},asetpts=PTS-STARTPTS,afade=t=in:d=0.02,afade=t=out:st={max(0,b-a-0.03):.3f}:d=0.03[a{i}]")
            vlabels.append(f"[v{i}][a{i}]")
        f.append("".join(vlabels) + f"concat=n={len(segs)}:v=1:a=1[vc][ac]")
        f.append(f"[vc]pad={W}:{H}:0:{H - vh}:color=0xFFF6EC[body]")
    if cfg.get("special") == "landscape":
        f.append("[0:a]anull[ac]")
    # end card: freeze last frame, blurred
    f.append(f"[body]tpad=stop_mode=clone:stop_duration={END_DUR},split[p1][p2]")
    f.append(f"[p2]gblur=sigma=30[pb]")
    f.append(f"[p1][pb]overlay=enable='gte(t,{body:.3f})',format=yuv420p[vb]")
    ass = f"{S}/ass/{vid}.ass"
    os.makedirs(f"{S}/ass", exist_ok=True)
    open(ass, "w").write(build_ass(vid, cfg, words, segs, band, total))
    f.append(f"[vb]ass={ass}:fontsdir=/root/.fonts[vout]")
    f.append(f"[ac]highpass=f=80,acompressor=threshold=-20dB:ratio=3:attack=5:release=120,"
             f"loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,apad,atrim=0:{total:.3f}[aout]")
    out = f"{OUT}/{cfg['n']:02d}_{cfg['slug']}.mp4"
    run(["ffmpeg", "-v", "error", "-y", "-i", src, "-filter_complex", ";".join(f),
         "-map", "[vout]", "-map", "[aout]", "-t", f"{total:.3f}",
         "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-profile:v", "high", "-pix_fmt", "yuv420p",
         "-r", "30", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out])
    print(f"{out}  {total:.1f}s (source {dur:.1f}s, {len(segs)} cuts)", flush=True)


os.makedirs(OUT, exist_ok=True)
for vid, cfg in VIDEOS.items():
    if ONLY and vid not in ONLY:
        continue
    build(vid, cfg)
