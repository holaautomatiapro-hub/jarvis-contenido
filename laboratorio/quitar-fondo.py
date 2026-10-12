#!/usr/bin/env python3
"""Quita el fondo de una foto (la persona queda recortada sobre transparente) con rembg, como en las portadas
de testimonio. Lo usa JARVIS en «Generar portada». El modelo (u2net) lo descarga el instalador del Laboratorio.
Uso: python quitar-fondo.py <foto> <salida.png>
"""
import sys


def main():
    if len(sys.argv) < 3:
        print(__doc__.strip(), file=sys.stderr)
        sys.exit(1)
    from PIL import Image
    from rembg import new_session, remove

    foto = Image.open(sys.argv[1])
    foto.thumbnail((2000, 2000))  # suficiente para una portada y mucho más rápido
    recorte = remove(foto.convert("RGBA"), session=new_session("u2net"), post_process_mask=True)
    caja = recorte.getbbox()
    if not caja:
        print("No he encontrado a nadie en la foto", file=sys.stderr)
        sys.exit(2)
    recorte.crop(caja).save(sys.argv[2], "PNG")
    print(sys.argv[2])


if __name__ == "__main__":
    main()
