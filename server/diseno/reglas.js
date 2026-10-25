// Cómo se escribe un diseño para el motor de JARVIS. Lo leen Claude (chat de Diseño) y Hermes con
// ver_kit_diseno, así que vale para cualquier kit: lo propio de cada marca está en su guía y sus ejemplos.
import { FORMATOS } from './kit.js';
import { MAX_DURACION } from './motor.js';

export function reglasDiseno(kit) {
  return `CÓMO SE ESCRIBE UN DISEÑO PARA JARVIS
Un diseño es un JSON (el mismo formato que los guion.json de HyperFrames) que se guarda con guardar_diseno:
{ "titulo": "…", "formato": "carrusel" | "story", "plantilla": "<id del kit>", "caption": "texto de la publicación",
  "slides": [ { "bg": "black", "glow": "top" | "mid" | null, "blocks": [ { "html": "<style>…</style><div>…</div>", "js": "tl.fromTo(…);" } ] } ] }

Lienzo: carrusel ${FORMATOS.carrusel.ancho}×${FORMATOS.carrusel.alto} px, story ${FORMATOS.story.ancho}×${FORMATOS.story.alto} px. Cada diapositiva dura ${kit.duracion} s (${kit.fps} fps).
Una diapositiva puede durar más que las demás con "duracion": segundos (hasta ${MAX_DURACION}) en esa diapositiva, p. ej. la de un vídeo
con alguien hablando: { "bg": "white", "duracion": 32, "blocks": [ … ] }. Las demás siguen con ${kit.duracion} s.
Marco que pone el motor (no lo escribas tú): <div class="slide on-{bg} fmt-{formato} tpl-{plantilla}" id="s{n}-root"> con
.bg.bg-{bg}, .glow.{glow} (si lo hay), la cabecera .hdr con ${kit.handle || 'el usuario'}${kit.verificado ? ' y el check de verificado' : ''} y los puntos .dots (solo en carruseles de plantillas que los llevan),
y dentro <div class="content"> con el html de los blocks. n es la posición de la diapositiva (empieza en 1).
Para lo que va a sangre detrás del contenido y fuera de su caja (una foto o un vídeo a pantalla completa con su degradado), usa
"fondo" en la diapositiva: { "bg": "black", "fondo": "<div id=\"s1-foto\" style=\"position:absolute;inset:0;…\">…</div>", "blocks": [ … ] }.
Va entre .bg y .glow, antes de la cabecera; se anima desde el js como lo demás.
CSS cargado: ${kit.css.join(', ') || '(ninguno)'}. Usa sus clases y variables; tus estilos van en <style> dentro del html.

Reglas técnicas (si no se cumplen, el vídeo sale mal):
- Prefija ids y clases propias con s{n}- o un prefijo único por diapositiva para que no choquen. Para cambiar el marco usa #s{n}-root.
- Anima SOLO con GSAP sobre la línea de tiempo «tl» (ya creada y en pausa; «O» = "power3.out"): tl.fromTo(sel, desde, hasta, segundo).
  El vídeo se graba fotograma a fotograma moviendo esa línea de tiempo: nada de setTimeout, setInterval, requestAnimationFrame,
  Math.random, Date ni animaciones/transiciones CSS. Los contadores, con un objeto animado por tl y onUpdate.
- Las entradas, en los primeros 4-5 s; al final todo quieto y legible (el JPG y la vista previa son el último fotograma).
  Los vaivenes suaves (yoyo) pueden seguir hasta el final.
- Sin recursos de internet. Imágenes y vídeos: los de la biblioteca (listar_medios → url, tal cual) o los del kit (ruta relativa al kit).
  Vídeos: <video src="…" muted playsinline data-start="0"></video> (el motor los sincroniza). data-start: segundo de la diapositiva en
  que empieza; data-from: segundo del vídeo desde el que se ve (para usar solo un trozo, p. ej. data-from="95.5").
  Con sonido: añade data-audio (o data-audio="0.8" para bajarlo): al exportar en MP4 se oye ese trozo del vídeo. Uno por diapositiva.
  Dale a la diapositiva la "duracion" del trozo que quieres que se oiga.
- Subtítulos de lo que se dice en un vídeo: pide las líneas con subtitulos_video (url del vídeo, desde y hasta en segundos del
  vídeo: el mismo trozo que data-from) y en el js: subtitulos('#s7-sub', LINEAS, INICIO) con las líneas tal cual e INICIO = el
  data-start del vídeo. Crea un <span class="sub-linea"> por línea dentro de la caja #s7-sub y lo enseña en su momento: la caja
  (posición, letra, fondo) y .sub-linea los estilas tú en el <style>, siguiendo la guía del kit.
- Sin emojis en el diseño salvo que la guía del kit diga lo contrario. Textos del guion; no inventes cifras ni clientes.
- Carrusel: 2-10 diapositivas (lo normal, 5-8). Stories: una por pantalla, hasta 20.
- Al guardar, el motor dibuja el último fotograma y te devuelve avisos (textos que se salen, que no caben o que se pisan, medios que no cargan).
  Corrígelos y vuelve a guardar con el mismo id. Mira las vistas previas con Read (te da sus rutas) y, para ver la animación a mitad,
  ver_fotogramas_diseno (la diapositiva en los segundos que elijas).`;
}
