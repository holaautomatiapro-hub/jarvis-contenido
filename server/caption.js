// Caption con IA al crear o programar un post: Claude lo escribe con la voz de la persona (_voz.md), su
// negocio (CLAUDE.md), las reglas de caption de su sistema de diseño y lo que se sepa de la pieza.

export class CaptionError extends Error {
  constructor(m) { super(m); this.publico = true; }
}

const MAX_CAPTION = 2200;
const recortar = (v, n) => String(v ?? '').trim().slice(0, n);

export function promptCaption(d = {}) {
  const titulo = recortar(d.titulo, 200);
  const nota = recortar(d.nota, 300);
  const actual = recortar(d.caption, 3000);
  const indicaciones = recortar(d.indicaciones, 1000);
  if (!titulo && !nota && !actual && !indicaciones) throw new CaptionError('Ponle antes un título (o di de qué va) para que JARVIS sepa qué escribir');
  const formato = recortar(d.formato, 40) || 'publicación';
  const palabra = recortar(d.palabra, 30).toUpperCase().replace(/[^A-ZÁÉÍÓÚÜÑ0-9]/g, '');
  const lm = d.leadmagnet ? (/^https?:\/\//i.test(String(d.leadmagnet_url || '')) ? `sí (${recortar(d.leadmagnet_url, 300)})` : 'sí') : null;
  const archivos = (Array.isArray(d.archivos) ? d.archivos : []).map((a) => recortar(a?.nombre || a, 80)).filter(Boolean).slice(0, 10);

  return `Escribe el caption de Instagram de esta publicación.
Tipo: ${formato}
${titulo ? `Título / tema: ${titulo}\n` : ''}${nota ? `Guion: lee la nota ${nota} con leer_nota.\n` : ''}${archivos.length ? `Archivos: ${archivos.join(', ')}\n` : ''}${lm ? `Lleva lead magnet: ${lm}. El cierre es «Comenta **${palabra || 'PALABRA'}** y te lo envío» (${palabra ? 'esa palabra exacta' : 'elige una palabra clave corta en mayúsculas que encaje'}).\n` : palabra ? `Palabra clave para el cierre: ${palabra}.\n` : ''}${actual ? `Caption que ya tengo (úsalo de base y mejóralo; no lo copies tal cual):\n"""\n${actual}\n"""\n` : ''}${indicaciones ? `Indicaciones: ${indicaciones}\n` : ''}
Antes de escribir:
- Lee _voz.md (mi forma de escribir) y CLAUDE.md (mi negocio y a quién me dirijo).
- Si existe _diseno/kit.json, lee su guía (el archivo que indica "guia") en lo que diga de captions, palabra clave y cierres, y síguelo.
Cómo:
- Primera línea con gancho (se ve antes del «… más»). Párrafos cortos, frases cortas, español de España y tuteo.
- Emojis con moderación. Pon en **negrita** (con dos asteriscos) solo lo clave, como la palabra clave del cierre: al publicar se verá en negrita.
- Cierra con una llamada a la acción clara${lm ? ' (la del lead magnet)' : ''}. Hashtags: como mucho 3 y solo si encajan con mi forma de escribir.
- Nada de datos inventados. Menos de ${MAX_CAPTION} caracteres.
Responde SOLO con el caption, listo para pegar: sin títulos, sin comillas, sin explicaciones antes ni después.`;
}

// Lo que devuelve Claude, limpio: sin comillas o bloques alrededor y dentro del límite de Instagram
export function limpiarCaption(t) {
  let s = String(t ?? '').trim();
  s = s.replace(/^```[a-z]*\n?|\n?```$/g, '').trim();
  s = s.replace(/^(caption|aquí tienes[^:\n]*):\s*\n?/i, '').trim();
  if (/^["«“]/.test(s) && /["»”]$/.test(s)) s = s.slice(1, -1).trim();
  if (!s) throw new CaptionError('JARVIS no ha devuelto ningún caption. Vuelve a probar.');
  return s.slice(0, MAX_CAPTION);
}
