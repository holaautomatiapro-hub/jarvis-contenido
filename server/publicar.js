import { row, rows } from './db.js';
import { JarvisError } from './jarvis.js';
import { nombreArchivo } from './vault.js';
import { REDES } from '../web/src/lib/redes.js';

// "Crea una vez, publica en todos lados": versiones de una pieza para cada red, listas para copiar.
// Viven en la ficha de la pieza y salen el mismo día que ella (su fecha propia, si la tienen, manda):
// un solo calendario. JARVIS NO publica: prepara y la persona publica (Instagram aparte, si lo marca ella).

export { REDES };
const IDS = new Set(REDES.map((r) => r.id));
export const REDES_POR_DEFECTO = ['tiktok', 'youtube_shorts', 'linkedin', 'x', 'threads'];
// Versión de Instagram que corresponde a cada tipo de publicación (para marcarla al publicarse sola)
export const RED_DE_TIPO_IG = { REELS: 'instagram_reel', CAROUSEL: 'instagram_carrusel', STORIES: 'instagram_historia' };

export function promptAdaptar(pieza, redes, notaContenido = '') {
  const nombres = redes.map((r) => REDES.find((x) => x.id === r)?.nombre || r).join(', ');
  return `Usa la skill adaptar-a-todas-las-redes para la pieza #${pieza.id} «${pieza.titulo}»${pieza.formato ? ` (formato original: ${pieza.formato})` : ''}.
Redes: ${nombres} (ids: ${redes.join(', ')}).
${notaContenido ? `Contenido de su nota (${pieza.nota}):\n"""\n${notaContenido.slice(0, 6000)}\n"""\n` : ''}Para cada red escribe una versión NATIVA (no copies y pegues): en reels, shorts y TikTok, un guion con gancho, texto en pantalla y caption; en carruseles, slide a slide; en historias, la secuencia; en LinkedIn, X y Threads, el texto listo para pegar. Lee _voz.md antes de escribir.
Guarda TODAS las versiones con guardar_versiones (piezaId ${pieza.id}): en "texto" lo que se publica, en "extra" los hashtags o el CTA y en "notas" las indicaciones de grabación o diseño. No pongas fecha: salen el mismo día que la pieza (solo si la persona pide otro día para una red, ponlo en "fecha", AAAA-MM-DD). No publiques nada. Responde con un resumen de dos líneas.`;
}

export function createPublicar({ db, jarvis, vault, alCambiar = () => {} }) {
  const q = {
    pieza: db.prepare('SELECT * FROM piezas WHERE id = ?'),
    deDePieza: db.prepare('SELECT * FROM pub_versiones WHERE pieza_id = ? ORDER BY id'),
    porRed: db.prepare("SELECT * FROM pub_versiones WHERE pieza_id = ? AND red = ? AND estado != 'publicado'"),
    ins: db.prepare('INSERT INTO pub_versiones (pieza_id, red, formato, titulo, texto, extra, notas, fecha, hora, origen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    upd: db.prepare("UPDATE pub_versiones SET formato = ?, titulo = ?, texto = ?, extra = ?, notas = ?, fecha = COALESCE(?, fecha), hora = COALESCE(?, hora), origen = ?, actualizado = datetime('now','localtime') WHERE id = ?"),
    version: db.prepare('SELECT * FROM pub_versiones WHERE id = ?'),
    programar: db.prepare("UPDATE pub_versiones SET fecha = ?, hora = ?, actualizado = datetime('now','localtime') WHERE id = ?"),
    publicar: db.prepare("UPDATE pub_versiones SET estado = ?, publicado = CASE WHEN ? = 'publicado' THEN datetime('now','localtime') ELSE NULL END, actualizado = datetime('now','localtime') WHERE id = ?"),
    borrar: db.prepare('DELETE FROM pub_versiones WHERE id = ?'),
    // dia = la fecha de la versión o, si no tiene, la de su pieza
    rango: db.prepare('SELECT v.*, p.titulo AS pieza_titulo, COALESCE(v.fecha, p.fecha) AS dia, COALESCE(v.hora, p.hora) AS hora_dia FROM pub_versiones v JOIN piezas p ON p.id = v.pieza_id WHERE COALESCE(v.fecha, p.fecha) >= ? AND COALESCE(v.fecha, p.fecha) <= ? ORDER BY dia, hora_dia'),
    sinFecha: db.prepare("SELECT v.*, p.titulo AS pieza_titulo FROM pub_versiones v JOIN piezas p ON p.id = v.pieza_id WHERE v.fecha IS NULL AND p.fecha IS NULL AND v.estado != 'publicado' ORDER BY v.id DESC LIMIT 50"),
    piezasRango: db.prepare('SELECT id, titulo, formato, estado, fecha, hora, pilar, objetivo, publicar_ig, ig_estado FROM piezas WHERE fecha >= ? AND fecha <= ? ORDER BY fecha, hora'),
    todas: db.prepare('SELECT id, pieza_id, red, fecha, hora, estado FROM pub_versiones ORDER BY id'),
  };

  const fecha = (f) => {
    if (f == null || f === '') return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) throw new JarvisError('La fecha debe ser AAAA-MM-DD');
    return f;
  };
  const hora = (h) => {
    if (h == null || h === '') return null;
    if (!/^\d{2}:\d{2}$/.test(h)) throw new JarvisError('La hora debe ser HH:MM');
    return h;
  };
  const piezaOError = (id) => {
    const p = row(q.pieza, Number(id));
    if (!p) throw new JarvisError('Esa pieza no existe');
    return p;
  };

  // Guarda (o reemplaza, si aún no está publicada) la versión de cada red
  function guardarVersiones({ piezaId, versiones = [], origen = 'dashboard' }) {
    const p = piezaOError(piezaId);
    if (!Array.isArray(versiones) || !versiones.length) throw new JarvisError('Falta "versiones"');
    const guardadas = [];
    for (const v of versiones) {
      if (!IDS.has(v.red)) throw new JarvisError(`Red no válida: ${v.red}. Usa: ${[...IDS].join(', ')}`);
      const texto = String(v.texto || '').trim();
      if (!texto) throw new JarvisError(`Falta "texto" en la versión de ${v.red}`);
      const args = [v.formato || null, v.titulo || null, texto.slice(0, 20000), v.extra || null, v.notas || null, fecha(v.fecha), hora(v.hora)];
      const previa = row(q.porRed, p.id, v.red);
      if (previa) { q.upd.run(...args, origen, previa.id); guardadas.push(previa.id); }
      else guardadas.push(Number(q.ins.run(p.id, v.red, ...args, origen).lastInsertRowid));
    }
    const nota = escribirNota(p);
    jarvis.registrar(origen === 'hermes' ? 'Hermes' : 'Contenido', `${versiones.length} versiones listas de "${p.titulo}"`, origen);
    alCambiar();
    return { pieza: p.id, versiones: guardadas, nota };
  }

  // Nota en 06-Publicaciones con todas las versiones (se reescribe al actualizar)
  function escribirNota(p) {
    const vs = rows(q.deDePieza, p.id);
    const nombre = (id) => REDES.find((r) => r.id === id)?.nombre || id;
    const md = ['---', 'tipo: publicaciones', `pieza: ${p.id}`, `actualizado: ${new Date().toLocaleString('sv-SE').slice(0, 16)}`, '---', `# ${p.titulo} · versiones por red`, '',
      ...vs.flatMap((v) => [`## ${nombre(v.red)}${v.fecha ? ` · ${v.fecha}${v.hora ? ` ${v.hora}` : ''}` : ''}${v.estado === 'publicado' ? ' · ✅ publicado' : ''}`, '', v.titulo ? `**${v.titulo}**\n` : '', v.texto, '', v.extra ? `${v.extra}\n` : '', v.notas ? `> ${v.notas.replace(/\n/g, '\n> ')}\n` : '']),
    ].join('\n');
    return vault.write(`06-Publicaciones/${nombreArchivo(`${p.titulo.slice(0, 60)} (versiones ${p.id})`)}.md`, md);
  }

  function listarPieza(piezaId) {
    const p = piezaOError(piezaId);
    return { pieza: p, versiones: rows(q.deDePieza, p.id) };
  }

  function programar(id, { fecha: f, hora: h }) {
    const v = row(q.version, Number(id));
    if (!v) throw new JarvisError('Esa versión no existe');
    q.programar.run(fecha(f), hora(h), v.id);
    escribirNota(piezaOError(v.pieza_id));
    alCambiar();
    return row(q.version, v.id);
  }

  function marcar(id, publicado = true) {
    const v = row(q.version, Number(id));
    if (!v) throw new JarvisError('Esa versión no existe');
    q.publicar.run(publicado ? 'publicado' : 'listo', publicado ? 'publicado' : 'listo', v.id);
    const p = piezaOError(v.pieza_id);
    // Si todas las versiones están publicadas, la pieza pasa a Publicado; si se desmarca una, vuelve a Listo
    // (salvo que la publicara JARVIS en Instagram: eso sí ha salido)
    const vs = rows(q.deDePieza, p.id);
    if (publicado && vs.every((x) => x.estado === 'publicado')) jarvis.actualizarPieza(p.id, { estado: 'publicado' });
    else if (!publicado && p.estado === 'publicado' && p.ig_estado !== 'publicado') jarvis.actualizarPieza(p.id, { estado: 'listo' });
    escribirNota(p);
    alCambiar();
    return row(q.version, v.id);
  }

  function borrar(id) {
    const v = row(q.version, Number(id));
    if (!v) throw new JarvisError('Esa versión no existe');
    q.borrar.run(v.id);
    escribirNota(piezaOError(v.pieza_id));
    alCambiar();
    return { ok: true };
  }

  // Todo lo que sale entre dos fechas: las piezas (lo que publica Instagram o tú) y sus versiones para otras redes
  function calendario({ desde, hasta }) {
    const d = fecha(desde), h = fecha(hasta);
    return { desde, hasta, piezas: rows(q.piezasRango, d, h), versiones: rows(q.rango, d, h), sinFecha: rows(q.sinFecha) };
  }

  // Resumen de las versiones de todas las piezas (para el calendario y las listas de Contenido)
  function resumen() {
    return rows(q.todas);
  }

  // Prepara la petición para JARVIS (crea la pieza si viene de un texto nuevo)
  function prepararAdaptacion({ piezaId, texto, redes }) {
    const lista = (Array.isArray(redes) && redes.length ? redes : REDES_POR_DEFECTO).filter((r) => IDS.has(r));
    if (!lista.length) throw new JarvisError('Elige al menos una red');
    let p;
    if (piezaId) p = piezaOError(piezaId);
    else if (String(texto || '').trim()) p = jarvis.capturarIdea({ texto }).pieza;
    else throw new JarvisError('Falta "texto" o una pieza');
    let contenido = '';
    if (p.nota) { try { contenido = vault.read(p.nota).contenido; } catch { /* sin nota */ } }
    return { pieza: p, redes: lista, prompt: promptAdaptar(p, lista, contenido) };
  }

  return { guardarVersiones, listarPieza, programar, marcar, borrar, calendario, resumen, prepararAdaptacion };
}
