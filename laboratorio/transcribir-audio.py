#!/usr/bin/env python3
"""Transcribe un audio en español con Whisper (faster-whisper), el mismo modelo que instala el Laboratorio.
Lo usa JARVIS para escribir el caption de un reel a partir de lo que dices cuando no hay clave de ElevenLabs.
Uso: python transcribir-audio.py <audio>   → escribe el texto en la salida estándar
"""
import os
import sys

MODELO = "mobiuslabsgmbh/faster-whisper-large-v3-turbo"
REVISION = "0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf"


def main():
    if len(sys.argv) < 2:
        print(__doc__.strip(), file=sys.stderr)
        sys.exit(1)
    os.environ.setdefault("HF_HUB_OFFLINE", "1")  # el modelo ya está descargado: sin red
    from faster_whisper import WhisperModel

    modelo = WhisperModel(MODELO, revision=REVISION, device="cpu", compute_type="int8")
    trozos, _ = modelo.transcribe(sys.argv[1], language="es", vad_filter=True, beam_size=1)
    print(" ".join(t.text.strip() for t in trozos).strip())


if __name__ == "__main__":
    main()
