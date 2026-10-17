// "Replicar": a partir de una publicación que funcionó (tuya o de la competencia), Claude escribe versiones
// nuevas con tu voz y en los formatos que elijas, y las deja como piezas del pipeline con su guion en 02-Guiones.

export class ReplicarError extends Error {
  constructor(m) { super(m); this.publico = true; }
}

export const FORMATOS_REPLICA = {
  Reel: 'reel: gancho de 0-3 s, desarrollo por bloques con lo que se dice y el texto en pantalla, CTA y caption',
  Carrusel: 'carrusel: slide a slide (título y texto de cada una, 6-10 slides), la última con CTA, y caption',
  Story: 'stories: secuencia de 3-7 stories con el texto de cada una, sticker (encuesta, pregunta, enlace) donde encaje y CTA',
  Post: 'post de una imagen: titular de la imagen, texto de apoyo y caption',
};

// { Reel: 1, Carrusel: 2 } → lista validada
export function normalizarFormatos(formatos) {
  const l = Object.entries(formatos || {})
    .map(([f, n]) => [f, Math.max(0, Math.min(3, Math.round(Number(n) || 0)))])
    .filter(([f, n]) => FORMATOS_REPLICA[f] && n > 0);
  if (!l.length) throw new ReplicarError('Elige al menos un formato');
  return l;
}

const lineaMetricas = (m) => Object.entries(m).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}: ${v}`).join(' · ');

// Carruseles y stories que se diseñan con el kit al terminar el texto
export const seDisena = (formatos, disenar) => Boolean(disenar) && formatos.some(([f]) => f === 'Carrusel' || f === 'Story');

function pasosComunes(formatos, indicaciones, disenar = false) {
  const lista = formatos.map(([f, n]) => `- ${f} × ${n}: ${FORMATOS_REPLICA[f]}`).join('\n');
  const total = formatos.reduce((a, [, n]) => a + n, 0);
  return `Formatos que quiero (${total} ${total === 1 ? 'versión' : 'versiones'}):
${lista}
${indicaciones ? `Indicaciones (mandan sobre todo lo demás): ${String(indicaciones).slice(0, 1500)}\n` : ''}
Cómo hacerlo:
1. Lee _voz.md y escribe con MI voz. Busca con buscar_notas en 03-Transcripciones y 01-Ideas material mío relacionado y úsalo.
2. Si hay una skill adecuada en .claude/skills (guion-reel-30s, guion-reel-60s, ganchos-reel, carrusel-educativo…), síguela.
3. Las versiones del mismo formato tienen que ser distintas entre sí (otro ángulo, otro gancho, otro ejemplo). No copies frases.
4. Mira las fases con ver_pipeline. Guarda cada versión con crear_nota en 02-Guiones (título «<Formato>: <título>») y crea su pieza con crear_pieza: estado "guion" si existe esa fase (si no, la primera fase de trabajo), formato (Reel, Carrusel, Story o Post), nota = la ruta que devuelve crear_nota, el caption y su estrategia: gancho, cta, objetivo (atraer, nutrir o convertir) y pilar (reutiliza uno de ver_pilares si encaja).
${seDisena(formatos, disenar) ? `5. Diseña cada carrusel y cada story con MI sistema de diseño, de uno en uno: ver_kit_diseno; lee con leer_archivo_kit la guía y el ejemplo de la plantilla que encaje; crear_diseno (formato carrusel o story, esa plantilla y el pieza_id de su pieza); guardar_diseno con las diapositivas y el caption; corrige los avisos y mira las vistas previas con Read. Después exportar_diseno (jpg): queda en la biblioteca, unido a su pieza. Los reels y posts se quedan en su guion.
6.` : '5.'} No publiques nada. Responde con la lista de piezas creadas, en una línea cada una${seDisena(formatos, disenar) ? ', y qué diseños quedan para revisar en Laboratorio → Diseño' : ''}.`;
}

// Una publicación tuya de Instagram que funcionó (fila de ig_media)
export function promptReplicarPropia(m, { formatos, indicaciones, medias = {}, disenar = false } = {}) {
  const l = normalizarFormatos(formatos);
  const metricas = lineaMetricas({
    alcance: m.alcance, visualizaciones: m.views, 'me gusta': m.likes, comentarios: m.comentarios,
    guardados: m.guardados, compartidos: m.compartidos, 'alcance medio de mis publicaciones': medias.alcance,
  });
  return `Esta publicación MÍA de Instagram funcionó bien y quiero sacarle más partido en otros formatos.
Publicación: ${m.formato || 'Instagram'} del ${String(m.fecha || '').slice(0, 10)}${m.permalink ? ` (${m.permalink})` : ''}${m.tema ? ` · tema: ${m.tema}` : ''}
Métricas: ${metricas || 'sin datos'}
Caption:
"""
${String(m.caption || '(sin caption)').slice(0, 3000)}
"""
${m.nota ? `Transcripción del vídeo: lee la nota ${m.nota} con leer_nota.\n` : ''}
Primero, en dos líneas, di POR QUÉ crees que funcionó (gancho, tema, estructura, CTA), mirando sus métricas: guardados y compartidos altos = contenido útil; comentarios = conversación. Mantén eso en todas las versiones.

${pasosComunes(l, indicaciones, disenar)}`;
}

// Una publicación de la competencia (fila de comp_media). "slides" son rutas del vault con las imágenes del carrusel.
// (o de cualquier cuenta, traída por su enlace)
export function promptReplicarCompetencia(m, { formatos, indicaciones, slides = [], seguidores, disenar = false } = {}) {
  const l = normalizarFormatos(formatos);
  const metricas = lineaMetricas({
    'me gusta': m.likes, comentarios: m.comentarios, visualizaciones: m.vistas,
    'engagement (interacciones / seguidores)': m.engagement != null ? `${m.engagement} %` : null, seguidores,
  });
  return `Quiero replicar CON MI ESTILO una publicación de otra cuenta que funciona: @${m.username}, ${m.formato || 'publicación'} del ${String(m.fecha || '').slice(0, 10)}${m.permalink ? ` (${m.permalink})` : ''}.
Métricas: ${metricas || 'sin datos'}
Caption:
"""
${String(m.caption || '(sin caption)').slice(0, 3000)}
"""
${m.transcripcion ? `Transcripción del reel:\n"""\n${String(m.transcripcion).slice(0, 8000)}\n"""\n` : ''}${slides.length ? `Imágenes del carrusel (míralas con Read, en orden): ${slides.join(', ')}\n` : ''}
Paso previo: entiende la referencia. ${slides.length ? 'Lee cada slide y apunta su título y su texto. ' : ''}Resume en 3-5 líneas su estructura (gancho, desarrollo, CTA) y por qué funciona. Guarda esa referencia con crear_nota en 04-Competencia (título «Referencia @${m.username}: <tema>»), con el enlace, las métricas, el caption${m.transcripcion ? ', la transcripción' : ''}${slides.length ? ' y el texto de cada slide' : ''}.

Después haz MI versión: mantén lo que la hace funcionar (su estructura: el mismo número de slides o bloques y la misma idea en cada uno, su tipo de gancho y su CTA), pero escribe todo de nuevo con mi voz, mis ejemplos y mi oferta (lee CLAUDE.md). Nunca frases literales suyas. En cada guion indica al final «Inspirado en: <enlace>».

${pasosComunes(l, indicaciones, disenar)}`;
}

// Un anuncio de la competencia (Biblioteca de anuncios de Meta). imagenes: rutas del vault con las del anuncio.
export function promptAdaptarAnuncio(a, { formatos, indicaciones, imagenes = [], disenar = false } = {}) {
  const l = normalizarFormatos(formatos);
  const metricas = lineaMetricas({
    'días activo': a.diasActivo, 'variantes con el mismo texto': a.variantes > 1 ? a.variantes : null,
    'alcance en la UE': a.alcance_ue, plataformas: a.plataformas,
  });
  const textos = (a.cuerpos?.length ? a.cuerpos : [a.cuerpo]).filter(Boolean);
  return `Quiero adaptar A MI ESTILO un anuncio de mi competencia que está funcionando: ${a.pagina}, activo desde el ${String(a.inicio || '').slice(0, 10)} (${a.verEnBiblioteca}).
Señales de que funciona: ${metricas || 'sin datos'} (lleva mucho tiempo activo o lo están duplicando = les da resultado).
Texto del anuncio${textos.length > 1 ? ` (${textos.length} versiones)` : ''}:
${textos.map((t) => `"""\n${String(t).slice(0, 2500)}\n"""`).join('\n') || '(sin texto)'}
${a.titulo ? `Titular: ${a.titulo}\n` : ''}${a.descripcion ? `Descripción: ${a.descripcion}\n` : ''}${a.transcripcion ? `Lo que se dice en el vídeo:\n"""\n${String(a.transcripcion).slice(0, 8000)}\n"""\n` : ''}${imagenes.length ? `Imágenes del anuncio (míralas con Read, en orden): ${imagenes.join(', ')}\n` : ''}
Paso previo: entiende el anuncio. Resume en 3-5 líneas su estructura (gancho, problema, prueba, oferta, CTA), a quién le habla y por qué crees que funciona. Guarda esa referencia con crear_nota en 04-Competencia (título «Anuncio ${a.pagina}: <tema>»), con el enlace, las señales, el texto${a.transcripcion ? ', la transcripción' : ''}.

Después haz MI versión: mantén lo que lo hace funcionar (estructura, tipo de gancho, ángulo, CTA), pero escríbelo todo de nuevo con mi voz, mis ejemplos y mi oferta (lee CLAUDE.md). Nunca frases literales suyas. Si es para anuncio, que el gancho funcione sin sonido y el texto principal quepa en 125 caracteres antes del «ver más». En cada guion indica al final «Inspirado en: ${a.verEnBiblioteca}».

${pasosComunes(l, indicaciones, disenar)}`;
}

// El guion de una pieza desde su ficha: escribirlo de cero o cambiarlo, con la idea de la que sale como base.
// Claude lo guarda en la nota del guion (ya creada) para que la ficha lo vea al terminar.
export function promptGuionPieza(p, { ruta, vacio, referencia = null, indicaciones = '' }) {
  const formato = FORMATOS_REPLICA[p.formato] || 'el formato de la pieza';
  const datos = [p.formato && `formato: ${p.formato}`, p.objetivo && `objetivo: ${p.objetivo}`, p.pilar && `pilar: ${p.pilar}`, p.gancho && `gancho pensado: ${p.gancho}`, p.cta && `CTA: ${p.cta}`].filter(Boolean).join(' · ');
  return `${vacio ? 'Escribe el guion' : 'Cambia el guion'} de mi pieza «${p.titulo}» (#${p.id}${datos ? ` · ${datos}` : ''}).
${vacio ? `Su nota de guion está vacía: «${ruta}».` : `El guion actual está en la nota «${ruta}»: léelo con leer_nota.`}
${referencia ? `Sale de esta idea o referencia (con su caption, su transcripción o el texto de sus slides): léela con leer_nota en «${referencia}» y úsala como base. Si es de otra cuenta, adapta lo que la hace funcionar (estructura, gancho, CTA) pero escríbelo todo de nuevo con mi voz: nunca frases literales suyas.\n` : ''}${p.caption ? `Caption actual:\n"""\n${String(p.caption).slice(0, 2000)}\n"""\n` : ''}
${indicaciones ? `Lo que quiero (manda sobre todo lo demás): ${String(indicaciones).slice(0, 1500)}` : vacio ? 'Escríbelo completo y listo para grabar o diseñar.' : 'Mejóralo: gancho más fuerte, más claro y más con mi voz, sin cambiar la idea.'}

Cómo hacerlo:
1. Lee _voz.md y escribe con MI voz. Si hay una skill adecuada en .claude/skills (guion-reel-30s, guion-reel-60s, ganchos-reel, carrusel-educativo…), síguela.
2. Formato del guion: ${formato}.${vacio ? '' : ' Si te pido un cambio concreto, cambia solo eso y deja el resto igual.'}
3. Guárdalo con editar_nota en «${ruta}» (léela antes con leer_nota): deja el frontmatter y el título (# …) tal cual y pon debajo el guion completo. No le cambies el título a la nota, no crees notas ni piezas y no toques el caption.
4. Responde en una o dos líneas qué has escrito o cambiado.`;
}

// «Replicar» desde la ficha de una idea guardada de la competencia: el guion va en la nota de guion de ESA pieza
// (no se crean otras) y, en completo, Claude la diseña con el kit (la plantilla elegida o la que encaje) y la exporta.
export function promptReplicarEnPieza(p, { ruta, referencia, enlace, imagenes = [], completo = false, plantilla = null, cta = null, indicaciones = '' }) {
  const formato = FORMATOS_REPLICA[p.formato] || 'el mismo formato que la referencia';
  return `Quiero replicar CON MI ESTILO una referencia de otra cuenta que guardé como idea: es mi pieza #${p.id} «${p.titulo}»${p.formato ? ` (${p.formato})` : ''}.
${referencia ? `La referencia está en la nota «${referencia}»: léela con leer_nota (enlace, señales, caption y la transcripción o el texto de los slides).` : `La referencia es ${enlace}.`}
${imagenes.length ? `Imágenes originales (míralas con Read, en orden): ${imagenes.join(', ')}\n` : ''}${indicaciones ? `Indicaciones (mandan sobre todo lo demás): ${String(indicaciones).slice(0, 1500)}\n` : ''}CTA: ${cta ? `usa este: «${String(cta).slice(0, 300)}»` : 'el mismo tipo de CTA que la referencia (la misma acción que pide), adaptado a mi oferta'}.

Cómo hacerlo:
1. Entiende primero por qué funciona: en 3-5 líneas, su gancho, su estructura (cuántos slides o bloques y qué hace cada uno) y su CTA.
2. Lee _voz.md y CLAUDE.md y escribe MI versión: misma estructura y mismo tipo de gancho, pero todo escrito de nuevo con mi voz, mis ejemplos y mi oferta. Nunca frases literales suyas. Si hay una skill adecuada en .claude/skills, síguela. Formato: ${formato}.
3. Guarda el guion con editar_nota en «${ruta}» (léela antes con leer_nota): deja el frontmatter y el título (# …) tal cual y pon debajo el guion completo; al final, «Inspirado en: ${enlace}». No le cambies el título a la nota.
4. Con mover_pieza (id ${p.id}) pon en la pieza el caption, el gancho, el cta y el objetivo (atraer, nutrir o convertir), y pásala a la fase "guion" (mira ver_pipeline). No crees otras piezas.
${completo ? `5. Diseña la pieza con MI sistema de diseño: ver_kit_diseno; ${plantilla ? `usa la plantilla «${plantilla.nombre}» (id ${plantilla.id})` : 'elige la plantilla que mejor encaje'} y lee con leer_archivo_kit su guía y su ejemplo; crear_diseno (formato carrusel${p.formato === 'Post' ? ', una sola diapositiva' : ''}, esa plantilla y pieza_id ${p.id}); guardar_diseno con las diapositivas y el caption; corrige los avisos y mira las vistas previas con Read. Después exportar_diseno (jpg): las imágenes quedan en esta pieza. Al acabar, pasa la pieza a la fase de editado o creado que haya después de "guion".
6.` : '5.'} No publiques nada. Responde en 2-3 líneas: por qué funciona la referencia y qué has hecho.`;
}
