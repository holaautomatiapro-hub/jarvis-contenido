# Laboratorio: diseño, testimonios y reels

El **Laboratorio** es la pestaña donde se crea lo visual. Tiene cuatro secciones:

| Sección | Qué hace |
|---|---|
| **Diseño** | Carruseles y stories con tu sistema de diseño (ver [DISENO.md](DISENO.md)) |
| **Testimonios** | De la entrevista de un cliente a stories y carrusel en vídeo, clips (reel, 4:5 y YouTube), portada y 3 captions |
| **Reels** | Tus vídeos hablando a cámara: los mejores momentos, sin silencios ni muletillas, con tus subtítulos y tu título |
| **Imágenes** | Imágenes, B-roll y avatares con IA (próximamente) |

Testimonios y Reels usan **tu plugin «testimonios»** (el de Automatia Pro), con su motor de montaje y su entrevista de marca.

## Preparación (una vez)

1. **El plugin.** En Laboratorio → Testimonios → **Importar (.zip)**.
   - Se guarda solo en tu servidor (`~/JARVIS-Laboratorio/.jarvis/plugin`). No va al código de JARVIS.
   - Si importas uno nuevo, el anterior se guarda en `.jarvis/plugins-anteriores/`.
2. **Python en el VPS.** `bash ~/instalar-vps.sh` lo deja listo con `scripts/preparar-laboratorio.sh`:
   - `ffmpeg`.
   - Un Python aparte (`~/JARVIS-Laboratorio/.venv`) con las librerías del plugin: Pillow, NumPy, OpenCV, rembg, onnxruntime y faster-whisper.
   - El modelo de transcripción (Whisper large-v3-turbo, unos 1,6 GB) y el de recortar fotos.

   Se puede repetir sin miedo: solo instala lo que falta.
3. **Tu marca.** La primera vez, pulsa **Configurar mi marca**. JARVIS lee lo que ya sabe de ti (tu sistema de diseño de Laboratorio → Diseño, tu `_voz.md` y el `CLAUDE.md` de tu vault) y te lo enseña relleno para que lo confirmes. Solo te pregunta lo que no está en ningún sitio: logo, palabra de cierre, tacos… Si tu letra está en `.woff2`, la pasa a `.ttf` para los clips y la portada. Después te enseña una tarjeta de muestra y no sigue hasta que digas que sí. Para cambiarla, **Cambiar mi marca**.

**Comprobar requisitos** (o `npm run doctor`) te dice qué falta.

## Testimonios

1. Escribe el nombre del cliente y sube la **entrevista** (Zoom o móvil; mp4, mov, m4v o mkv: lo que no sea mp4 se convierte solo).
2. Opcional:
   - la **foto** y la **frase** de la portada;
   - **qué hiciste con el cliente**: si lo dejas vacío, JARVIS te lo pregunta, no lo inventa;
   - indicaciones.
3. Elige qué sacar (todo, por defecto, con la skill `testimonio-completo`) y pulsa **Hacer todo el testimonio**.
4. En el chat de la derecha, JARVIS va contando cada paso. Primero transcribe (una entrevista de 1 hora tarda unos 20-40 min en el VPS). Luego te enseña **el guion de las stories y el carrusel y la lista de clips con sus títulos**, y lo que deja fuera por delicado. **No monta nada hasta que le des el visto bueno.**
5. Cuando termina, cada testimonio aparece con:
   - sus **portadas**, **stories**, **carrusel en vídeo** y **clips** (reel, 4:5, YouTube);
   - los **captions** (3 versiones) y el **índice de clips**.
6. **A la biblioteca**: marca los archivos (o todos) y pásalos a Contenido. Quedan en la fase Listo, para ponerles día o publicarlos:
   - el carrusel en vídeo, como una pieza con todos sus vídeos;
   - cada story y cada clip, como una pieza.

Las cifras y frases entre comillas son **literales de la entrevista**. Antes de publicar, asegúrate de tener el permiso del cliente.

## Reels

1. Sube tu vídeo (vertical u horizontal) y ponle nombre.
2. Elige:
   - **Los mejores momentos**: cuántos clips y de qué duración. O **el vídeo entero, limpio**.
   - **Plantillas**:
     - **Pantalla completa (9:16)**: el vídeo ocupa todo el reel; título arriba y subtítulos abajo, con contorno para que se lean.
     - **Ventana con marco (9:16)**: tu vídeo en una ventana sobre el fondo de tu marca, como los clips de testimonios.
     - **Feed 4:5**.
   - **Quitar muletillas** («eh», «em», «mmm») y silencios. Los tacos se quitan si tu marca dice «quitar».
   - Título (si no, JARVIS propone uno con gancho por clip) e indicaciones.
3. JARVIS transcribe, elige los cortes (gancho fuerte al principio, una sola idea, sin frases a medias) y te enseña cada clip con su título, su texto y su duración. Con tu sí, saca un fotograma de prueba y monta.
4. Los reels aparecen con su caption, listos para pasarlos a la biblioteca.

Por dentro, el editor es `laboratorio/reel.py`:
- usa el motor del plugin (cortes, subtítulos con tu marca, audio a −14 LUFS);
- añade la plantilla a pantalla completa y la limpieza de muletillas;
- la ficha de cada reel está en `fichas/reels/<nombre>.json`.

## Dónde queda cada cosa

En `~/JARVIS-Laboratorio` (cámbialo con `LABORATORIO_PATH` en `.env`):

```
crudo/                  entrevistas y vídeos originales (nunca se tocan)
fichas/                 clips/, testimonios/ y reels/: lo que decide JARVIS para cada pieza
transcripciones/        las transcripciones (con el segundo de cada palabra)
marca/marca.json        tu marca (y muestra.jpg)
fotos/<cliente>/        fotos de los clientes
clips/<Cliente>/        reels, 4:5 y YouTube de cada testimonio
testimonios/<Cliente>/  stories, carrusel en vídeo, portadas y _caption.md
reels/<Nombre>/         tus reels editados, por plantilla, y _caption.md
```

## Cómo trabaja JARVIS aquí

- El Laboratorio lleva su **propio carril**: mientras monta, puedes seguir usando JARVIS en el resto de pestañas.
- Claude Code se lanza con tu plugin y en la carpeta del Laboratorio. Solo puede ejecutar los programas del montaje:
  - `python`, `ffmpeg`, `ffprobe`, `node` y `npx`;
  - y moverse por las carpetas.

  No puede borrar, instalar ni usar `sudo`. Cada comando puede durar hasta 2 horas (transcribir y renderizar es lento).
- Las copias del PC (`npm run exportar`) no incluyen el Laboratorio, porque los vídeos pesan mucho.
- En Windows, instala tú Python 3.10+ y ejecuta `python -m venv %USERPROFILE%\JARVIS-Laboratorio\.venv`; después, con el Python de ese entorno, `python -m pip install pillow numpy opencv-python-headless rembg onnxruntime faster-whisper huggingface_hub`.
