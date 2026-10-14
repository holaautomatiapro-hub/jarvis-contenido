#!/usr/bin/env python3
"""Transcribe un audio (o un vídeo) en español con Whisper (faster-whisper), el mismo modelo que instala el Laboratorio.
Lo usa JARVIS cuando no hay clave de ElevenLabs o falla (p. ej. sin créditos): para el caption de un reel y para
transcribir entrevistas y vídeos de la biblioteca.
Uso: python transcribir-audio.py <audio>   → escribe el texto en la salida estándar
"""
import os
import subprocess
import sys

MODELO = "mobiuslabsgmbh/faster-whisper-large-v3-turbo"
REVISION = "0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf"


def audio_con_ffmpeg(ruta):
    """El audio a 16 kHz mono como lo quiere Whisper, leído con ffmpeg. Así no depende de PyAV, que en sus
    versiones nuevas (19+) ya no acepta lo que le pasa faster-whisper. None si no hay ffmpeg."""
    import numpy as np

    ffmpeg = os.environ.get("JARVIS_FFMPEG") or "ffmpeg"
    try:
        r = subprocess.run([ffmpeg, "-nostdin", "-v", "error", "-i", ruta, "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
    except (OSError, subprocess.CalledProcessError):
        return None
    return np.frombuffer(r.stdout, dtype=np.float32)


def main():
    if len(sys.argv) < 2:
        print(__doc__.strip(), file=sys.stderr)
        sys.exit(1)
    os.environ.setdefault("HF_HUB_OFFLINE", "1")  # el modelo ya está descargado: sin red
    from faster_whisper import WhisperModel

    audio = audio_con_ffmpeg(sys.argv[1])
    if audio is not None and not audio.size:
        sys.exit("El vídeo no tiene audio")
    modelo = WhisperModel(MODELO, revision=REVISION, device="cpu", compute_type="int8")
    trozos, info = modelo.transcribe(audio if audio is not None else sys.argv[1], language="es", vad_filter=True, beam_size=1)
    textos = []
    for t in trozos:
        textos.append(t.text.strip())
        # Cuánto lleva (lo lee JARVIS para la barra de «Trabajando»)
        if info.duration:
            print(f"@progreso {min(t.end / info.duration, 1):.3f}", file=sys.stderr, flush=True)
    print(" ".join(textos).strip())


if __name__ == "__main__":
    main()
