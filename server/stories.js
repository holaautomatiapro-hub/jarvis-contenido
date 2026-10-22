// Guiones de stories (Laboratorio → Stories). De un carrusel, de un reel o de un tema, JARVIS escribe la secuencia
// de stories (con tu voz y lo que toca en tu estrategia); la cambias a mano o se la pides de nuevo, y cuando está,
// se diseña con tu sistema de diseño (un diseño de formato story, que se ajusta en el chat y se exporta).
import path from 'node:path';
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { row, rows } from './db.js';

export class StoriesError extends Error {
  constructor(m) { super(m); this.publico = true; }
}

export const OBJETIVOS_STORIES = {
  educar: 'Educar: que entiendan el problema o la solución',
  lm: 'Lead magnet: que pidan el recurso (palabra clave o enlace)',
  testimonio: 'Testimonio: prueba social de un cliente',
  qa: 'Q&A: responder preguntas y abrir conversación',
  comunidad: 'Comunidad: interacción (encuestas, preguntas, quiz)',
  personal: 'Personal: conexión, tu día y tu historia',
  promo: 'Llevar tráfico al carrusel o al reel',
  venta: 'Venta: que te escriban para tu oferta',
};
// Tu guía de estilo de stories: una nota del vault (también se edita en Obsidian). JARVIS la sigue al escribir
// los guiones y Claude al diseñarlas (lo hace Diseño con cualquier diseño de stories).
export const ESTILO_STORIES = 'Stories/CLAUDE.md';
export function leerEstiloStories(vault) {
  try { const n = vault.read(ESTILO_STORIES); return { ruta: n.path, texto: n.contenido, modificado: n.modificado }; } catch { return { ruta: ESTILO_STORIES, texto: '', modificado: null }; }
}
// Tus stories de ejemplo (capturas o diseños tuyos): imágenes en el vault, en Stories/ejemplos. Claude las mira
// antes de diseñar para copiar tu estilo visual, y al escribir el guion para el tono y la estructura.
export const EJEMPLOS_STORIES = 'Stories/ejemplos';
const IMAGEN = /\.(jpe?g|png|webp)$/i;
export const MAX_EJEMPLOS = 12;
export function ejemplosStories(vault) {
  const dir = path.join(vault.base, EJEMPLOS_STORIES);
  try {
    return readdirSync(dir).filter((f) => IMAGEN.test(f) && !f.startsWith('.')).sort()
      .map((f) => ({ fichero: f, ruta: path.join(dir, f), tamano: statSync(path.join(dir, f)).size }));
  } catch { return []; }
}
// El guion de stories de una pieza de tipo Story (desde su ficha): se guarda en su nota de guion, como el de
// cualquier pieza, pero escrito como una secuencia de stories, con tu guía, tus ejemplos y lo que toca ese día.
export function promptGuionStory(p, { ruta, vacio, referencia = null, indicaciones = '', vault }) {
  const estilo = leerEstiloStories(vault).texto.trim();
  const ejemplos = ejemplosStories(vault);
  const datos = [p.fecha && `para el ${p.fecha}${p.hora ? ` a las ${p.hora}` : ''}`, p.categoria && `tipo de contenido: ${p.categoria}`, p.objetivo && `objetivo: ${p.objetivo}`, p.pilar && `pilar: ${p.pilar}`].filter(Boolean).join(' · ');
  return `${vacio ? 'Escribe' : 'Cambia'} el GUION DE STORIES de mi pieza «${p.titulo}» (#${p.id}, Story${datos ? ` · ${datos}` : ''}).
${vacio ? `Su nota de guion está vacía: «${ruta}».` : `El guion actual está en la nota «${ruta}»: léelo con leer_nota${'. Si te pido un cambio concreto, cambia solo eso'}.`}
${referencia ? `Sale de esta idea o referencia: léela con leer_nota en «${referencia}» y úsala como base (con mi voz, nunca frases literales de otros).\n` : ''}${estilo ? `Mi guía de estilo de stories (${ESTILO_STORIES}): síguela en todo, por encima de las reglas generales de abajo:\n"""\n${estilo.slice(0, 12_000)}\n"""\n` : ''}${ejemplos.length ? `Mis stories de ejemplo (míralas con Read para captar mi tono, cuánto texto pongo y cómo estructuro una secuencia): ${ejemplos.map((e) => e.ruta).join(', ')}\n` : ''}${indicaciones ? `Lo que quiero (manda sobre todo lo demás): ${String(indicaciones).slice(0, 1500)}\n` : ''}
Cómo hacerlo:
1. Lee _voz.md y CLAUDE.md (mi oferta, mi cliente) y escribe con MI voz.${p.fecha ? ` Mira con ver_estrategia qué stories tocan el ${p.fecha} y que encaje con eso${p.categoria ? ` (sobre todo con «${p.categoria}»)` : ''}.` : ''} Si hay una skill de stories en .claude/skills, síguela.
2. Una secuencia de 3-7 stories con hilo: la 1 engancha, las del medio desarrollan con una idea por story, donde encaje una interacción (encuesta, caja de preguntas, quiz o deslizador) y la última cierra con un CTA claro.
3. Textos cortos para leer en 3-5 segundos. Escribe cada story así:
## Story 1 · <tipo: texto, encuesta, pregunta, quiz, vídeo selfie, captura, enlace…>
Texto en pantalla: <lo que se lee>
Visual: <qué se ve: fondo, foto, captura, tu cara…>
Sticker: <encuesta con sus opciones, caja de preguntas, enlace… (si lleva)>
4. Guárdalo con editar_nota en «${ruta}» (léela antes con leer_nota): deja el frontmatter y el título (# …) tal cual y pon debajo el guion completo. No le cambies el título a la nota, no crees notas ni piezas y no publiques nada.
5. Responde en una o dos líneas qué has escrito.`;
}
const FORMATOS_ORIGEN = { Carrusel: 'carrusel', Reel: 'reel', Short: 'reel', 'Reel split': 'reel', 'B-roll': 'reel', Post: 'post' };
const texto = (v, max) => (v == null ? '' : String(v).trim().slice(0, max));

export function createStories({ db, jarvis, asistente = null, alCambiar = () => {} }) {
  const q = {
    get: db.prepare('SELECT * FROM stories_guiones WHERE id = ?'),
    lista: db.prepare('SELECT * FROM stories_guiones ORDER BY actualizado DESC, id DESC LIMIT 200'),
    del: db.prepare('DELETE FROM stories_guiones WHERE id = ?'),
  };
  const actualizar = (id, campos) => {
    const claves = Object.keys(campos);
    db.prepare(`UPDATE stories_guiones SET ${claves.map((k) => `${k} = ?`).join(', ')}, actualizado = datetime('now','localtime') WHERE id = ?`)
      .run(...claves.map((k) => campos[k] ?? null), id);
  };
  const leer = (id) => {
    const r = row(q.get, Number(id));
    if (!r) throw new StoriesError('Ese guion de stories ya no existe');
    return r;
  };
  // El que JARVIS está escribiendo ahora (en la conversación de guiones): { id, guion }
  let enMarcha = null;
  const escribiendo = (r) => Boolean(enMarcha?.id === r.id && asistente?.estado({ conversacion: 'guiones' }).ocupadoAqui);

  function vista(r) {
    const pieza = r.pieza_origen ? jarvis.listarPiezas().find((p) => p.id === r.pieza_origen) : null;
    // Se quedó «escribiendo» pero JARVIS ya no está con él (se cerró a medias): vuelve a estar disponible
    const cortado = r.estado === 'escribiendo' && !escribiendo(r);
    const estado = cortado ? (r.guion.trim() ? 'listo' : 'error') : r.estado;
    return {
      id: r.id, titulo: r.titulo, tema: r.tema || '', objetivo: r.objetivo || null, cantidad: r.cantidad, indicaciones: r.indicaciones || '',
      guion: r.guion, estado, error: cortado && !r.guion.trim() ? 'Se cortó antes de terminar. Vuelve a pedírselo a JARVIS.' : r.error, creado: r.creado, actualizado: r.actualizado,
      pieza: pieza ? { id: pieza.id, titulo: pieza.titulo, formato: pieza.formato } : null,
    };
  }
  const listar = () => rows(q.lista).map(vista);
  const obtener = (id) => vista(leer(id));

  // Lo que se le pide a JARVIS: la pieza (su guion, caption y la referencia de la que sale) o el tema, y cómo
  function prompt(r, { indicaciones = '' } = {}) {
    let origen = '';
    if (r.pieza_origen) {
      const p = jarvis.leerPieza(r.pieza_origen);
      const g = jarvis.guionDePieza(p.id);
      const tipo = FORMATOS_ORIGEN[p.formato] || 'publicación';
      origen = `Sale de mi ${tipo} «${p.titulo}» (pieza #${p.id}${p.formato ? `, ${p.formato}` : ''}${p.ig_permalink ? `, publicada en ${p.ig_permalink}` : p.fecha ? `, para el ${p.fecha}` : ''}).
${g.texto ? `Su guion:\n"""\n${g.texto.slice(0, 8000)}\n"""\n` : ''}${p.caption ? `Su caption:\n"""\n${String(p.caption).slice(0, 2500)}\n"""\n` : ''}${!g.texto && g.referencia?.texto ? `La idea de la que sale (con su transcripción):\n"""\n${g.referencia.texto.slice(0, 6000)}\n"""\n` : ''}${!g.texto && !p.caption && !g.referencia ? `Solo tengo su título: míralo con ver_pieza (id ${p.id}) y, si es un vídeo, transcríbelo con transcribir_pieza, para saber qué cuenta.\n` : ''}Las stories cuentan lo mismo con otro formato (no repitas el carrusel o el reel tal cual): que quien las vea quiera ir a verlo o actúe.`;
    } else origen = `Tema: ${r.tema}`;
    const obj = OBJETIVOS_STORIES[r.objetivo];
    const estilo = leerEstiloStories(jarvis.vault).texto.trim();
    const ejemplos = ejemplosStories(jarvis.vault);
    const pedido = texto(indicaciones, 1500) || r.indicaciones;
    return `${r.guion.trim() ? 'Cambia' : 'Escribe'} el GUION DE STORIES #${r.id} de JARVIS («${r.titulo}»): una secuencia de ${r.cantidad} stories de Instagram.
${origen}
${estilo ? `Mi guía de estilo de stories (${ESTILO_STORIES}): síguela en todo (estructura, tono, longitud de los textos, stickers, CTA), por encima de las reglas generales de abajo:\n"""\n${estilo.slice(0, 12_000)}\n"""\n` : ''}${ejemplos.length ? `Mis stories de ejemplo (míralas con Read para captar mi tono, cuánto texto pongo y cómo estructuro una secuencia): ${ejemplos.map((e) => e.ruta).join(', ')}\n` : ''}${obj ? `Objetivo de la secuencia: ${obj}.\n` : ''}${pedido ? `Lo que quiero (manda sobre todo lo demás): ${pedido}\n` : ''}${r.guion.trim() ? `Guion actual (si pido un cambio concreto, cambia solo eso):\n"""\n${r.guion.slice(0, 8000)}\n"""\n` : ''}
Cómo hacerlo:
1. Lee _voz.md y CLAUDE.md (mi oferta, mi cliente) y escribe con MI voz. Mira con ver_estrategia qué stories tocan estos días por si encaja. Si hay una skill de stories en .claude/skills, síguela.
2. ${r.cantidad} stories con hilo: la 1 engancha (que no pasen), las del medio desarrollan con una idea por story, al menos una lleva interacción (encuesta, caja de preguntas, quiz o deslizador) y la última cierra con un CTA claro (responder con una palabra clave, ir al post o al reel, o el enlace).
3. Textos cortos para leer en 3-5 segundos. Escribe cada story así:
## Story 1 · <tipo: texto, encuesta, pregunta, quiz, vídeo selfie, captura, enlace…>
Texto en pantalla: <lo que se lee>
Visual: <qué se ve: fondo, foto, captura, tu cara…>
Sticker: <encuesta con sus opciones, caja de preguntas, enlace… (si lleva)>
4. Guárdalo con guardar_guion_stories (id ${r.id}) con el guion completo y un título corto. No crees piezas, notas ni diseños, y no publiques nada.
5. Responde en una o dos líneas qué has escrito.`;
  }

  function escribir(id, { indicaciones = '' } = {}) {
    if (!asistente) throw new StoriesError('JARVIS (Claude Code) no está disponible');
    if (asistente.estado({ conversacion: 'guiones' }).ocupado) throw new StoriesError('JARVIS está terminando otra petición. Espera un momento y vuelve a pulsar.');
    const r = leer(id);
    asistente.preguntar({ conversacion: 'guiones', texto: prompt(r, { indicaciones }) });
    enMarcha = { id: r.id, guion: r.guion };
    actualizar(r.id, { estado: 'escribiendo', error: null });
    alCambiar();
    return obtener(r.id);
  }

  function crear({ pieza_id, tema, objetivo, cantidad, indicaciones, titulo, escribirConJarvis = true } = {}) {
    let pieza = null;
    if (pieza_id) {
      pieza = jarvis.listarPiezas().find((p) => p.id === Number(pieza_id));
      if (!pieza) throw new StoriesError('Esa pieza ya no existe');
    }
    const t = texto(tema, 2000);
    if (!pieza && !t && escribirConJarvis) throw new StoriesError('Elige un carrusel o un reel, o escribe de qué van las stories');
    const n = Math.max(2, Math.min(15, Math.round(Number(cantidad) || 5)));
    const nombre = texto(titulo, 120) || (pieza ? `Stories · ${pieza.titulo}` : t.split('\n')[0]) || 'Stories';
    const { lastInsertRowid } = db.prepare('INSERT INTO stories_guiones (titulo, pieza_origen, tema, objetivo, cantidad, indicaciones) VALUES (?, ?, ?, ?, ?, ?)')
      .run(nombre.slice(0, 120), pieza?.id ?? null, t || null, OBJETIVOS_STORIES[objetivo] ? objetivo : null, n, texto(indicaciones, 1500) || null);
    const id = Number(lastInsertRowid);
    alCambiar();
    if (!escribirConJarvis) return obtener(id);
    try { return escribir(id); } catch (e) { actualizar(id, { estado: 'error', error: e.message }); throw e; }
  }

  // A mano (desde la pantalla) o desde JARVIS (guardar_guion_stories)
  function guardarGuion(id, { guion, titulo } = {}) {
    const r = leer(id);
    if (typeof guion !== 'string') throw new StoriesError('Falta el guion');
    actualizar(r.id, { guion: guion.trimEnd().slice(0, 30_000), ...(texto(titulo, 120) ? { titulo: texto(titulo, 120) } : {}), ...(r.estado === 'error' ? { estado: 'listo', error: null } : {}) });
    alCambiar();
    return obtener(r.id);
  }

  // Cuando JARVIS acaba: si no llegó a guardar el guion, se avisa
  function alEventoClaude(e) {
    if (e.conversacion !== 'guiones' || !enMarcha || !(e.tipo === 'fin' || e.tipo === 'error')) return;
    const { id, guion } = enMarcha;
    enMarcha = null;
    let r;
    try { r = leer(id); } catch { return; }
    const sinGuardar = r.guion === guion;
    actualizar(id, {
      estado: e.tipo === 'error' || (sinGuardar && !r.guion.trim()) ? 'error' : 'listo',
      error: e.tipo === 'error' ? `JARVIS no ha podido terminar: ${e.mensaje || 'error'}` : sinGuardar ? 'JARVIS ha terminado sin guardar el guion. Vuelve a pedírselo.' : null,
    });
    alCambiar();
  }

  function borrar(id) {
    const r = leer(id);
    if (escribiendo(r)) throw new StoriesError('Espera a que JARVIS termine el guion');
    q.del.run(r.id);
    alCambiar();
    return { ok: true };
  }

  const estilo = () => leerEstiloStories(jarvis.vault);
  function guardarEstilo({ texto: t, modificado } = {}) {
    if (typeof t !== 'string') throw new StoriesError('Falta el texto de tu guía de estilo');
    if (t.length > 50_000) throw new StoriesError('La guía es demasiado larga (máximo 50.000 caracteres)');
    const contenido = t.trimEnd() ? `${t.trimEnd()}\n` : '';
    if (jarvis.vault.existe(ESTILO_STORIES)) {
      try { jarvis.vault.guardar(ESTILO_STORIES, contenido, { modificado: modificado || undefined }); } catch (e) { throw new StoriesError(e.message); }
    } else jarvis.vault.write(ESTILO_STORIES, contenido);
    alCambiar();
    return estilo();
  }

  // Las stories de ejemplo: se suben una a una (imagen) y se borran
  const ejemplos = () => ejemplosStories(jarvis.vault).map(({ fichero, tamano }) => ({ fichero, tamano, url: `/api/stories/ejemplos/${encodeURIComponent(fichero)}` }));
  function subirEjemplo({ nombre, datos }) {
    if (!Buffer.isBuffer(datos) || !datos.length) throw new StoriesError('Sube la imagen de la story');
    if (datos.length > 15 * 1024 ** 2) throw new StoriesError('La imagen pesa más de 15 MB');
    const ext = String(nombre || '').toLowerCase().match(/\.(jpe?g|png|webp)$/)?.[1]?.replace('jpeg', 'jpg');
    if (!ext) throw new StoriesError('Sube la story como imagen (JPG, PNG o WebP). Si es un vídeo, haz una captura.');
    if (ejemplosStories(jarvis.vault).length >= MAX_EJEMPLOS) throw new StoriesError(`Como mucho ${MAX_EJEMPLOS} ejemplos: borra alguno`);
    const base = String(nombre).replace(/\.[^.]*$/, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'story';
    const dir = path.join(jarvis.vault.base, EJEMPLOS_STORIES);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${Date.now()}-${base}.${ext}`), datos);
    alCambiar();
    return ejemplos();
  }
  const rutaEjemplo = (fichero) => ejemplosStories(jarvis.vault).find((e) => e.fichero === fichero)?.ruta || null;
  function borrarEjemplo(fichero) {
    const r = rutaEjemplo(fichero);
    if (r) rmSync(r, { force: true });
    alCambiar();
    return ejemplos();
  }

  return { listar, obtener, crear, estilo, guardarEstilo, ejemplos, subirEjemplo, borrarEjemplo, rutaEjemplo, escribir, guardarGuion, borrar, alEventoClaude, prompt };
}
