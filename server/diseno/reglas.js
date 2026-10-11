// Cómo se escribe un diseño para el motor de JARVIS. Lo leen Claude (chat de Diseño) y Hermes con
// ver_kit_diseno, así que vale para cualquier kit: lo propio de cada marca está en su guía y sus ejemplos.
import { FORMATOS } from './kit.js';

export function reglasDiseno(kit) {
  return `CÓMO SE ESCRIBE UN DISEÑO PARA JARVIS
Un diseño es un JSON (el mismo formato que los guion.json de HyperFrames) que se guarda con guardar_diseno:
{ "titulo": "…", "formato": "carrusel" | "story", "plantilla": "<id del kit>", "caption": "texto de la publicación",
  "slides": [ { "bg": "black", "glow": "top" | "mid" | null, "blocks": [ { "html": "<style>…</style><div>…</div>", "js": "tl.fromTo(…);" } ] } ] }

Lienzo: carrusel ${FORMATOS.carrusel.ancho}×${FORMATOS.carrusel.alto} px, story ${FORMATOS.story.ancho}×${FORMATOS.story.alto} px. Cada diapositiva dura ${kit.duracion} s (${kit.fps} fps).
Marco que pone el motor (no lo escribas tú): <div class="slide on-{bg} fmt-{formato} tpl-{plantilla}" id="s{n}-root"> con
.bg.bg-{bg}, .glow.{glow} (si lo hay), la cabecera .hdr con ${kit.handle || 'el usuario'}${kit.verificado ? ' y el check de verificado' : ''} y los puntos .dots (solo en carruseles de plantillas que los llevan),
y dentro <div class="content"> con el html de los blocks. n es la posición de la diapositiva (empieza en 1).
CSS cargado: ${kit.css.join(', ') || '(ninguno)'}. Usa sus clases y variables; tus estilos van en <style> dentro del html.

Reglas técnicas (si no se cumplen, el vídeo sale mal):
- Prefija ids y clases propias con s{n}- o un prefijo único por diapositiva para que no choquen. Para cambiar el marco usa #s{n}-root.
- Anima SOLO con GSAP sobre la línea de tiempo «tl» (ya creada y en pausa; «O» = "power3.out"): tl.fromTo(sel, desde, hasta, segundo).
  El vídeo se graba fotograma a fotograma moviendo esa línea de tiempo: nada de setTimeout, setInterval, requestAnimationFrame,
  Math.random, Date ni animaciones/transiciones CSS. Los contadores, con un objeto animado por tl y onUpdate.
- Las entradas, en los primeros 4-5 s; al final todo quieto y legible (el JPG y la vista previa son el último fotograma).
  Los vaivenes suaves (yoyo) pueden seguir hasta el final.
- Sin recursos de internet. Imágenes y vídeos: los de la biblioteca (listar_medios → url, tal cual) o los del kit (ruta relativa al kit).
  Vídeos: <video src="…" muted playsinline data-start="0"></video> (el motor los sincroniza).
- Sin emojis en el diseño salvo que la guía del kit diga lo contrario. Textos del guion; no inventes cifras ni clientes.
- Carrusel: 2-10 diapositivas (lo normal, 5-8). Stories: una por pantalla, hasta 20.
- Al guardar, el motor dibuja el último fotograma y te devuelve avisos (textos que se salen, que no caben o que se pisan, medios que no cargan).
  Corrígelos y vuelve a guardar con el mismo id. Puedes mirar las vistas previas con Read (te da sus rutas).`;
}
