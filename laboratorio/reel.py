# -*- coding: utf-8 -*-
"""Editor de reels del Laboratorio de JARVIS. Usa el motor del plugin «testimonios» (cortes sin
silencios, subtítulos con tu marca, audio a -14 LUFS) para vídeos tuyos hablando a cámara.

La ficha de cada reel va en fichas/reels/<nombre>.json (carpeta de trabajo del Laboratorio):

    {
      "cliente": "Mi reel",                 nombre que se ve (carpeta reels/<cliente>/)
      "video": "mi-video.mp4",              archivo en crudo/
      "transcripcion": "mi-video",          transcripciones/<id>.json (python transcribir.py)
      "plantillas": ["pantalla"],           pantalla (9:16 a pantalla completa), ventana (9:16 con marco) y/o feed (4:5)
      "foco_y": 0.4,                        dónde está la cara (0 = arriba, 1 = abajo) al recortar el vídeo
      "espejo": false,
      "quitar_muletillas": true,            «eh», «em», «mmm»… fuera del audio y de los subtítulos (los tacos, según la marca)
      "quitar": [[23.1, 23.6]],             trozos sueltos que también se quitan («o sea», una tos…), en segundos
      "reemplazos": {}, "correcciones": [],
      "clips": [{"nombre": "01-gancho", "titulo": "LÍNEA 1\\nLÍNEA 2", "tramos": [[12.3, 41.0, "nota"]]}]
    }

    python reel.py <nombre> plan                 cortes y duración de cada clip
    python reel.py <nombre> textos               lo que se va a subtitular
    python reel.py <nombre> limpiar              qué muletillas y tacos se van a quitar
    python reel.py <nombre> preview <clip> [plantilla] [segundo]   fotograma de prueba en reels/<cliente>/
    python reel.py <nombre> <clip|all> [plantilla]                 monta (salida en reels/<cliente>/<plantilla>/)

Necesita la variable TESTIMONIOS_PLUGIN (carpeta del plugin) y se ejecuta desde la carpeta de trabajo.
"""
import json, os, re, shutil, subprocess, sys

sys.stdout.reconfigure(encoding="utf-8")
PLUGIN = os.environ.get("TESTIMONIOS_PLUGIN") or ""
if not os.path.isdir(os.path.join(PLUGIN, "motor")):
    sys.exit("Falta el plugin de testimonios (TESTIMONIOS_PLUGIN): impórtalo en JARVIS → Laboratorio")
sys.path.insert(0, os.path.join(PLUGIN, "motor"))

import rutas as R          # noqa: E402  (del plugin)
import formatos as F       # noqa: E402
import montar as M         # noqa: E402
import marca as MARCA      # noqa: E402

# Pantalla completa: el vídeo ocupa todo el reel; título arriba y subtítulos abajo, con sombra para que se lean
F.FORMATS["pantalla"] = dict(
    W=1080, H=1920, dest="pantalla-9x16", title=True,
    title_fit=960, title_max=150, cap_size=84, handle_size=34, radius=0,
    maquetas={1: dict(paneles=[(1080, 1920, 0, 0)], title_y=330, cap_y=1390, handle_y=1830)},
)
PLANTILLAS = {"pantalla": "pantalla", "ventana": "reel", "feed": "carrusel"}
ASPECTO = {"pantalla": (1080, 1920), "reel": (1010, 568), "carrusel": (1000, 563)}
MULETILLAS = re.compile(r"^(e+h+|e+m+|e+h+m+|m{2,}|a+h+|h+m+|u+m+)$", re.I)
REELS = R.t("reels")
NOMBRE = ""
QUITAR, HUECOS = [], []      # palabras que se quitan y los trozos de audio que se cortan


_intervalos = M.build_intervals


def intervalos(spans, gap, pad, lead_max=0.30, tail_max=0.45):
    """Los trozos que conserva el motor, menos las muletillas, los tacos y los trozos de "quitar"."""
    ivs = _intervalos(spans, gap, pad, lead_max, tail_max)
    for ha, hb in HUECOS:
        nuevos = []
        for s, e in ivs:
            if hb <= s or ha >= e:
                nuevos.append((s, e))
                continue
            if ha - s > 0.20:
                nuevos.append((s, ha))
            if e - hb > 0.20:
                nuevos.append((hb, e))
        ivs = nuevos
    return ivs


M.build_intervals = intervalos


def ficha_ruta(nombre):
    return R.t("fichas", "reels", nombre + ".json")


def cargar(nombre):
    """Carga la ficha en el motor (montar.cargar lee fichas/clips/<x>.json: se le da la ruta relativa)."""
    global NOMBRE
    NOMBRE = nombre
    if not os.path.exists(ficha_ruta(nombre)):
        sys.exit("No existe la ficha fichas/reels/%s.json" % nombre)
    os.makedirs(R.t("fichas", "clips"), exist_ok=True)       # en Linux, «clips/..» solo resuelve si existe
    M.cargar(os.path.join("..", "reels", nombre))
    M.CFG.setdefault("orden", ["yo"])
    # Muletillas (y tacos, si la marca dice «quitar»): fuera de los subtítulos y del audio
    quitar_tacos = MARCA.cargar().get("tacos", "quitar") == "quitar"
    QUITAR.clear()
    for w in M.WORDS:
        limpia = re.sub(r"[^\wáéíóúñü]", "", w["w"].strip().lower())
        if (M.CFG.get("quitar_muletillas", True) and MULETILLAS.match(limpia)) or (quitar_tacos and M.TACOS.search(limpia)):
            QUITAR.append(w)
    M.WORDS[:] = [w for w in M.WORDS if w not in QUITAR]
    HUECOS[:] = [(w["s"] - 0.01, w["e"] + 0.01) for w in QUITAR] + [(float(a), float(b)) for a, b, *_ in M.CFG.get("quitar", [])]
    for c in M.CFG["clips"]:
        c.setdefault("ajustar", False)        # en reels no se estira ni se acelera hasta 60-90 s
        c["orden"] = ["yo"]


def dimensiones():
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:stream_side_data=rotation",
                        "-of", "json", M.SRC], capture_output=True, text=True)
    s = json.loads(r.stdout or "{}").get("streams", [{}])[0]
    w, h = int(s.get("width", 1080)), int(s.get("height", 1920))
    rot = abs(int(next((d.get("rotation", 0) for d in s.get("side_data_list", []) if "rotation" in d), 0) or 0))
    return (h, w) if rot in (90, 270) else (w, h)


def recorte(fk):
    """La zona del vídeo que entra en la ventana, con su misma forma (sin deformar)."""
    W, H = dimensiones()
    pw, ph = ASPECTO[fk]
    if W / H > pw / ph:              # vídeo más ancho que la ventana: se recorta a los lados
        h = H
        w = int(round(H * pw / ph))
        x, y = (W - w) // 2, 0
    else:                            # más alto: se recorta arriba y abajo, centrando en la cara
        w = W
        h = int(round(W * ph / pw))
        x = 0
        y = int(round(max(0, min(H - h, H * float(M.CFG.get("foco_y", 0.4)) - h / 2))))
    return [x - x % 2, y - y % 2, w - w % 2, h - h % 2]


def preparar_plantilla(fk):
    M.CFG["fuentes"] = {"yo": recorte(fk)}
    if fk == "pantalla":             # sin marco alrededor: el vídeo es el fondo
        d = M.assets_dir(fk, 1)
        if not os.path.exists(os.path.join(d, "marcos.png")):
            M.make_assets(fk, 1)
            from PIL import Image
            Image.new("RGBA", (1080, 1920), (0, 0, 0, 0)).save(os.path.join(d, "marcos.png"))


_escribir_ass = M.write_ass


def escribir_ass(path, title, caps, dur, f):
    _escribir_ass(path, title, caps, dur, f)
    if f.get("dest") == "pantalla-9x16":      # contorno y sombra: el texto va encima del vídeo
        t = open(path, encoding="utf-8").read()
        # BorderStyle 1 con contorno 4 y sombra 2 (los 15 campos de antes no cambian)
        t = re.sub(r"^(Style: (?:[^,\n]*,){15})1,0,0,5,", r"\g<1>1,4,2,5,", t, flags=re.M)
        t = t.replace("&H00000000,&H00000000", "&H00000000,&H80000000")
        open(path, "w", encoding="utf-8").write(t)


M.write_ass = escribir_ass


def plantillas():
    return [PLANTILLAS.get(p, p) for p in M.CFG.get("plantillas", ["pantalla"])]


def nombre_plantilla(fk):
    return next((k for k, v in PLANTILLAS.items() if v == fk), fk)


def montar(clip, fk, preview_at=None):
    preparar_plantilla(fk)
    visible = M.CFG["cliente"]
    M.CFG["cliente"] = "_reel_" + re.sub(r"[^\w-]+", "_", NOMBRE)    # caché aparte de los testimonios
    try:
        dur = M.render(clip, fk, preview_at=preview_at)
    finally:
        interno = M.CFG["cliente"]
        M.CFG["cliente"] = visible
    destino = os.path.join(REELS, visible)
    os.makedirs(destino, exist_ok=True)
    if preview_at is not None:
        shutil.copyfile(os.path.join(M.CACHE, "preview_%s_%s.jpg" % (interno, fk)),
                        os.path.join(destino, "_preview-%s.jpg" % nombre_plantilla(fk)))
        print("preview ->", os.path.join("reels", visible, "_preview-%s.jpg" % nombre_plantilla(fk)))
        return
    # El motor deja el vídeo en clips/<cliente>/<formato>/: se mueve a reels/<cliente>/<plantilla>/
    origen = os.path.join(R.TRABAJO, "clips", interno, F.FORMATS[fk]["dest"], clip["nombre"] + ".mp4")
    if os.path.exists(origen):
        final = os.path.join(destino, nombre_plantilla(fk))
        os.makedirs(final, exist_ok=True)
        shutil.move(origen, os.path.join(final, clip["nombre"] + ".mp4"))
        shutil.rmtree(os.path.join(R.TRABAJO, "clips", interno), ignore_errors=True)
        print("ok ->", os.path.join("reels", visible, nombre_plantilla(fk), clip["nombre"] + ".mp4"), "(%.1f s)" % (dur or 0))


def limpiar():
    """Lo que se va a quitar del audio y de los subtítulos."""
    for w in QUITAR:
        print("  fuera «%s» en %.2f s" % (w["w"].strip(), w["s"]))
    for a, b, *_ in M.CFG.get("quitar", []):
        print("  fuera el trozo %.2f-%.2f s" % (float(a), float(b)))
    print("Se quitan %d muletillas o tacos y %d trozos marcados." % (len(QUITAR), len(M.CFG.get("quitar", []))))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    cargar(sys.argv[1])
    arg = sys.argv[2] if len(sys.argv) > 2 else "plan"
    if arg == "limpiar":
        limpiar()
    elif arg in ("plan", "textos"):
        sys.argv = [sys.argv[0], "", arg]
        for c in M.CFG["clips"]:
            ivs, sp, raw = M.plan(c)
            if arg == "plan":
                print("%-28s cortes=%3d  duración=%6.1f s  plantillas=%s" % (c["nombre"], len(ivs), raw / sp, ",".join(map(nombre_plantilla, plantillas()))))
            else:
                txt = " ".join(t for _, _, t in M.chunks(ivs, M.tramos(c), sp))
                print("=== %s (%.0f s) — %s" % (c["nombre"], raw / sp, c.get("titulo", "").replace("\n", " / ")))
                print(txt)
                for m in M.TACOS.finditer(txt):
                    print("   >>> TACO: «%s»" % m.group(0))
                print()
    elif arg == "preview":
        c = M.buscar(sys.argv[3])
        fk = PLANTILLAS.get(sys.argv[4], sys.argv[4]) if len(sys.argv) > 4 else plantillas()[0]
        montar(c, fk, preview_at=float(sys.argv[5]) if len(sys.argv) > 5 else 3.0)
    else:
        clips = M.CFG["clips"] if arg == "all" else [M.buscar(arg)]
        fks = [PLANTILLAS.get(sys.argv[3], sys.argv[3])] if len(sys.argv) > 3 else plantillas()
        for c in clips:
            for fk in fks:
                montar(c, fk)
