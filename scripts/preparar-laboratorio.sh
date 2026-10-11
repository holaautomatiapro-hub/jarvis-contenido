#!/usr/bin/env bash
# Prepara el Laboratorio de JARVIS en Linux (VPS): ffmpeg, Python con las librerías del plugin de testimonios
# (transcribir, recortar fotos, montar) y el modelo de transcripción. Se puede repetir: solo instala lo que falta.
#
#   bash scripts/preparar-laboratorio.sh
#
# Variables: LABORATORIO_PATH (carpeta de trabajo, por defecto ~/JARVIS-Laboratorio) y LAB_SIN_MODELO=1 para
# no descargar el modelo de transcripción (~1,6 GB).
set -euo pipefail

LAB="${LABORATORIO_PATH:-$HOME/JARVIS-Laboratorio}"
VENV="$LAB/.venv"
LIBRERIAS="pillow numpy opencv-python-headless rembg onnxruntime faster-whisper huggingface_hub"
# El modelo exacto que usa motor/transcribir.py del plugin (Whisper large-v3-turbo para faster-whisper)
MODELO="mobiuslabsgmbh/faster-whisper-large-v3-turbo"
REVISION="0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf"
SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"
ok() { printf '    \033[32m✓\033[0m %s\n' "$1"; }

mkdir -p "$LAB"
if command -v apt-get >/dev/null; then
  faltan=()
  command -v ffmpeg >/dev/null || faltan+=(ffmpeg)
  command -v python3 >/dev/null || faltan+=(python3)
  python3 -c 'import ensurepip, venv' >/dev/null 2>&1 || faltan+=(python3-venv)
  if [ ${#faltan[@]} -gt 0 ]; then
    $SUDO apt-get update -qq
    $SUDO apt-get install -y -qq "${faltan[@]}" >/dev/null
  fi
fi
command -v ffmpeg >/dev/null || { echo "Falta ffmpeg"; exit 1; }
ok "ffmpeg $(ffmpeg -version | head -1 | awk '{print $3}')"

[ -x "$VENV/bin/python" ] || python3 -m venv "$VENV"
"$VENV/bin/python" -m pip install -q --upgrade pip >/dev/null
"$VENV/bin/python" -m pip install -q $LIBRERIAS
ok "Python $("$VENV/bin/python" -c 'import sys; print(sys.version.split()[0])') con las librerías del plugin en $VENV"

if [ -z "${LAB_SIN_MODELO:-}" ]; then
  "$VENV/bin/python" - "$MODELO" "$REVISION" <<'PY'
import sys
from huggingface_hub import snapshot_download
ruta = snapshot_download(sys.argv[1], revision=sys.argv[2])
print("    \033[32m✓\033[0m modelo de transcripción en", ruta)
PY
  # rembg descarga su modelo la primera vez que recorta una foto: se baja ya para no esperar luego
  "$VENV/bin/python" -c "from rembg import new_session; new_session('u2net')" >/dev/null 2>&1 && ok "modelo para recortar fotos (rembg)" || true
fi
