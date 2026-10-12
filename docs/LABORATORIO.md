# Laboratorio: diseño, testimonios, reels, lead magnets e imágenes

El **Laboratorio** es la pestaña donde se crea lo visual. Tiene cinco secciones:

| Sección | Qué hace |
|---|---|
| **Diseño** | Carruseles y stories con tu sistema de diseño (ver [DISENO.md](DISENO.md)) |
| **Testimonios** | De la entrevista de un cliente a stories y carrusel en vídeo, clips (reel, 4:5 y YouTube), portada y 3 captions |
| **Reels** | Tus vídeos hablando a cámara: los mejores momentos, sin silencios ni muletillas, con tus subtítulos y tu título |
| **Lead magnets** | Guías, checklists, tests y generadores en una página web con tu diseño, publicados en Vercel con un enlace |
| **Imágenes** | Con Higgsfield (tu cuenta): imágenes para tus diseños, fotos contigo (tu personaje con tu cara), B-roll y animar una imagen |

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

## Lead magnets

Páginas web **interactivas** (no PDF) para mandar a quien comenta tu palabra clave: guía paso a paso, checklist para marcar, test con resultado, generador, pack de recursos o calculadora. No hace falta el plugin.

1. **Conecta Vercel (una vez).** En Lead magnets → **Conectar**, pega un token de [vercel.com/account/tokens](https://vercel.com/account/tokens). JARVIS lo comprueba y lo guarda en el `.env` de tu servidor (`VERCEL_TOKEN`). No lo pegues nunca en el chat. Puedes elegir el nombre del proyecto (tus enlaces serán `https://<proyecto>.vercel.app/<lead-magnet>`) o un dominio propio que ya hayas añadido a ese proyecto en Vercel.
2. **Sube los banners del cierre (una vez):** la imagen de tu Skool y la de tu WhatsApp. JARVIS los mete dentro de la página.
3. **Crea uno:** de qué va, el tipo, la palabra clave y, si quieres, la pieza que lo anuncia y tu contenido de base. JARVIS (Claude Opus) sigue la sección «Lead magnets» de tu sistema de diseño y parte de su plantilla HTML. Escribe con tu voz, revisa la página a 375 px (`laboratorio/captura.mjs`: capturas, lo que se sale por los lados y errores) y corrige hasta que esté bien. Al final te da un caption para anunciarlo.
4. **Revísalo** con **Ver** (como en el móvil). Para cambiar algo, **Pedir cambios**.
5. **Publicar** lo sube a Vercel y te da el enlace para copiar. Si lo has unido a una pieza, el enlace se pone solo en ella (casilla «Lleva lead magnet»). **Quitar de internet** lo retira; el enlace deja de funcionar.

Todos tus lead magnets publicados van en el mismo proyecto de Vercel: cada vez que publicas uno, JARVIS sube también los demás que siguen publicados.

## Imágenes con Higgsfield

Usa **el conector de Higgsfield de tu cuenta** (el mismo que en Claude), así que gasta los créditos de tu plan.

**Conectar (una vez).** El instalador del VPS añade el conector. Solo falta iniciar sesión:
1. En PowerShell: `ssh -t root@TU-IP`
2. En el VPS: `claude mcp login higgsfield --no-browser`
3. Abre en tu navegador el enlace que sale y entra con tu cuenta de Higgsfield.
4. El navegador acaba en una página de `localhost` que no carga: copia esa dirección entera y pégala en la terminal del VPS.
5. En Laboratorio → Imágenes, pulsa **Comprobar**: tiene que poner «Conectado».

Si Higgsfield pide volver a entrar algún día, repite los pasos 1 a 4.

**Tu cara (una vez).** Sube de 5 a 20 fotos tuyas (mejor 10-20: solo tú, cara bien visible, luz y ángulos distintos) y pulsa **Crear mi personaje**. JARVIS las sube a Higgsfield y entrena tu personaje (Soul), que tarda unos 10 minutos. Su número queda en `imagenes/_mi-cara/personaje.json`.

**Crear.** Elige qué quieres:
- **Imagen**: fondos, escenas, objetos o portadas para tus carruseles y stories.
- **Foto contigo**: con tu personaje.
- **B-roll**: un vídeo corto para meter entre lo que dices en tus reels.
- **Animar una imagen**: una foto o un diseño que subas, con movimiento.

Después describe la imagen y elige el formato (9:16, 4:5, 1:1 o 16:9), cuántas quieres, las referencias (si quieres) y un **presupuesto de créditos**. JARVIS escribe el prompt, elige el modelo y mira el coste antes de generar. Si cuesta más que tu presupuesto, te pregunta en el chat. Nunca usa tus generaciones ilimitadas si no se lo pides.

Lo generado se baja a `imagenes/<encargo>/`. Desde ahí lo pasas a la biblioteca con un clic, y así ya lo tienes para tus diseños (Diseño usa los medios de la biblioteca) y tus reels.

## Captions con negrita y emojis

En **Contenido**, el caption tiene una barra:
- **B** pone en negrita lo que selecciones (o la palabra donde está el cursor). También funciona **Ctrl+B**, y si lo pulsas otra vez, se quita. Es la negrita que se ve en Instagram: letras Unicode, las únicas que Instagram enseña en negrita.
- **😀** abre los emojis por grupos, con tus recientes primero.
- Si un caption trae `**PALABRA**` (por ejemplo, uno escrito por JARVIS), al publicar en Instagram se convierte en negrita.

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
leadmagnets/<nombre>/   index.html (la página), captura.png y _capturas/ (revisión a 375 px)
leadmagnets/_comun/     los banners de Skool y WhatsApp
imagenes/<encargo>/     lo generado con Higgsfield y _encargo.md (prompt y modelo)
imagenes/_referencias/  fotos y vídeos de referencia
imagenes/_mi-cara/      tus fotos para tu personaje y personaje.json
```

## Cómo trabaja JARVIS aquí

- El Laboratorio lleva su **propio carril**: mientras monta, puedes seguir usando JARVIS en el resto de pestañas.
- Claude Code se lanza con tu plugin y en la carpeta del Laboratorio. Solo puede ejecutar los programas del montaje:
  - `python`, `ffmpeg`, `ffprobe`, `node` y `npx`;
  - y moverse por las carpetas.

  No puede borrar, instalar ni usar `sudo`. Cada comando puede durar hasta 2 horas (transcribir y renderizar es lento).
- Las copias del PC (`npm run exportar`) no incluyen el Laboratorio, porque los vídeos pesan mucho.
- En Windows, instala tú Python 3.10+ y ejecuta `python -m venv %USERPROFILE%\JARVIS-Laboratorio\.venv`; después, con el Python de ese entorno, `python -m pip install pillow numpy opencv-python-headless rembg onnxruntime faster-whisper huggingface_hub`.
