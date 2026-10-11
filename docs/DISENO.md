# Diseño: del guion al carrusel o las stories, con tu sistema de diseño

En **Laboratorio → Diseño**, JARVIS convierte un guion en un **carrusel** (1080 × 1350) o en **stories** (1080 × 1920) con **tu** sistema de diseño: tus colores, tus tipografías, tus plantillas. Claude lo diseña, JARVIS lo dibuja y revisa que nada se salga ni se pise, y tú lo exportas a la biblioteca como **imágenes (JPG)** o **vídeo (MP4)** para programarlo o publicarlo en Instagram.

## Cómo se usa

1. **Nuevo diseño**: elige carrusel o stories, la plantilla y el guion. Puede venir de una pieza del pipeline (la nota de `02-Guiones`) o pegado. Si quieres, añade indicaciones, por ejemplo: «palabra clave SETTER; en la portada usa mi vídeo de la biblioteca».
2. **Claude (Opus) lo diseña** con tu guía y el ejemplo de la plantilla. Suele tardar 2-5 minutos. Cada versión aparece en cuanto la guarda.
3. **Revisión automática**: JARVIS dibuja el último fotograma de cada diapositiva y avisa si un texto se sale de la imagen, no cabe en su caja, se monta sobre otro, queda fuera de la zona segura de las stories, o si una foto o un vídeo no cargan. Claude corrige esos avisos antes de terminar. Si queda alguno, pulsa **Pedir a Claude que lo corrija**.
4. **Ajusta en el chat** de la derecha: «en la 3 pon el chat más grande», «cambia leads por clientes»… Claude cambia solo eso y lo vuelve a dibujar.
5. **Exporta a la biblioteca**:
   - **Imágenes (JPG)**: al momento.
   - **Vídeo (MP4)**: 7 s por diapositiva, H.264, sin audio. Tarda unos 15 s por diapositiva.
   - Un carrusel se convierte en una pieza de tipo Carrusel con su caption. Si el guion venía de una pieza del pipeline, es esa misma pieza, que pasa a «Listo».
   - Las stories se guardan como una pieza por story, todas en una carpeta con el nombre del diseño.
   - Si vuelves a exportar, se sustituye lo exportado antes, salvo que ya esté publicado.
6. **Programa o publica** como cualquier otra pieza: **Programar…** (con «Publicar sola en Instagram») o **Abrir** → «Publicar ahora».

Desde Telegram, Hermes también puede crear y escribir diseños con las mismas herramientas: `crear_diseno`, `guardar_diseno`… Exportar y publicar se hace siempre desde el dashboard.

## Tu propio sistema de diseño

Mientras no importes el tuyo, JARVIS usa uno de ejemplo (`diseno/kit-ejemplo`). Tu sistema es un **.zip** que se importa en **Laboratorio → Diseño → Importar mi sistema (.zip)**:
- Se guarda en tu vault, en `_diseno/`. Es tuyo: no va al repositorio de JARVIS.
- Si importas otro, el anterior se guarda en `data/kits-anteriores/`.

Lo que lleva el .zip, todo dentro de una carpeta o en la raíz:

| Archivo | Para qué |
|---|---|
| `kit.json` | **Obligatorio.** Qué plantillas tienes y cómo se cargan (ver abajo) |
| La guía (p. ej. `CLAUDE.md`) | Tu sistema explicado: colores, tipografías, tamaños, composición, animación, caption. Claude la sigue al pie de la letra |
| CSS | Las clases y variables de tu marca. El motor pone el marco: `.slide.on-{bg}`, `.bg.bg-{bg}`, `.glow.{glow}`, `.hdr` (tu cuenta), `.content` y `.dots` |
| Fuentes | `.woff2` con su `@font-face` en un CSS del kit. Así se ven igual en el PC y en el VPS, sin internet. También valen enlaces de Google Fonts en `fuentes` |
| Ejemplos | Un diseño completo por plantilla, hecho a mano. Es lo que más ayuda a Claude a clavar tu estilo |
| Imágenes de referencia | Opcionales: Claude puede mirarlas |

`kit.json`:

```json
{
  "nombre": "Mi marca",
  "handle": "@micuenta",
  "verificado": true,
  "duracion": 7,
  "fps": 30,
  "guia": "CLAUDE.md",
  "css": ["fuentes/fuentes.css", "estilos.css"],
  "fuentes": [],
  "zonaSeguraStory": [270, 300],
  "plantillas": [
    { "id": "rejilla", "nombre": "Plantilla 1 · Rejilla", "descripcion": "…", "formatos": ["carrusel", "story"], "cabecera": true, "paginacion": true, "ejemplo": "ejemplos/plantilla-1.json" },
    { "id": "cine", "nombre": "Plantilla 2 · Cine", "descripcion": "…", "formatos": ["carrusel"], "cabecera": false, "paginacion": false, "ejemplo": "ejemplos/plantilla-2.json" }
  ]
}
```

## El formato de un diseño

Es el mismo que el de los `guion.json` de HyperFrames: lo que ya tengas hecho para HyperFrames sirve como ejemplo.

```json
{ "titulo": "…", "formato": "carrusel", "plantilla": "rejilla", "caption": "…",
  "slides": [ { "bg": "black", "glow": "top", "blocks": [ { "html": "<style>…</style><div id=\"s1-h\">…</div>", "js": "tl.fromTo(\"#s1-h\", { opacity: 0 }, { opacity: 1, duration: 0.6 }, 0.3);" } ] } ] }
```

- El contenedor de cada diapositiva es `#s{n}-root` (n = posición).
- Las animaciones van en la línea de tiempo de GSAP `tl`, que está en pausa. El vídeo se graba fotograma a fotograma moviendo esa línea de tiempo.
- No uses `setTimeout`, animaciones CSS ni `Math.random`.
- Las fotos y vídeos son los de tu biblioteca (`/api/contenido/archivos/…`) o los del propio kit.

## Requisitos

- **Windows**: Microsoft Edge o Google Chrome. Edge viene con Windows.
- **VPS**: `bash instalar-vps.sh` instala Chromium y sus dependencias.
- **Vídeo**: `ffmpeg` viene con `npm install` (paquete `ffmpeg-static`). Si prefieres otro, indícalo con `FFMPEG_PATH` en `.env`.
- `npm run doctor` te dice qué sistema de diseño está activo.

**Seguridad**: cada diapositiva se dibuja en una página aislada. Solo puede cargar archivos del kit, GSAP, tus medios y Google Fonts, y no tiene acceso a la API de JARVIS.
