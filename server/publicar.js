import { row, rows } from './db.js';
import { JarvisError } from './jarvis.js';
import { nombreArchivo } from './vault.js';

// "Crea una vez, publica en todos lados": versiones de una pieza para cada red, listas para copiar
// y programadas en el calendario. JARVIS NO publica: prepara y la persona publica.

export const REDES = [
  { id: 'instagram_reel', nombre: 'Instagram Reel', corto: 'IG Reel', color: '#d6249f', grupo: 'Instagram' },
  { id: 'instagram_carrusel', nombre: 'Instagram Carrusel', corto: 'Carrusel', color: '#e1306c', grupo: 'Instagram' },
  { id: 'instagram_historia', nombre: 'Instagram Historias', corto: 'Historias', color: '#f77737', grupo: 'Instagram' },
  { id: 'tiktok', nombre: 'TikTok', corto: 'TikTok', color: '#25f4ee', grupo: 'TikTok' },
  { id: 'youtube_shorts', nombre: 'YouTube Shorts', corto: 'Shorts', color: '#ff0033', grupo: 'YouTube' },
  { id: 'linkedin', nombre: 'LinkedIn', corto: 'LinkedIn', color: '#0a66c2', grupo: 'LinkedIn' },
  { id: 'x', nombre: 'X (hilo)', corto: 'X', color: '#e7e9ea', grupo: 'X' },
  { id: 'threads', nombre: 'Threads', corto: 'Threads', color: '#b4b4b4', grupo: 'Threads' },
  { id: 'facebook', nombre: 'Facebook', corto: 'Facebook', color: '#1877f2', grupo: 'Facebook' },
  { id: 'pinterest', nombre: 'Pinterest', corto: 'Pinterest', color: '#e60023', grupo: 'Pinterest' },
  { id: 'telegram', nombre: 'Canal de Telegram', corto: 'Telegram', color: '#2aabee', grupo: 'Telegram' },
  { id: 'newsletter', nombre: 'Newsletter', corto: 'Email', color: '#8b5cf6', grupo: 'Email' },
];
const IDS = new Set(REDES.map((r) => r.id));
export const REDES_POR_DEFECTO = ['instagram_reel', 'instagram_carrusel', 'instagram_historia', 'tiktok', 'youtube_shorts', 'linkedin', 'x', 'threads'];

export function promptAdaptar(pieza, redes, notaContenido = '') {
  const nombres = redes.map((r) => REDES.find((x) => x.id === r)?.nombre || r).join(', ');
  return `Usa la skill adaptar-a-todas-las-redes para la pieza #${pieza.id} «${pieza.titulo}»${pieza.formato ? ` (formato original: ${pieza.formato})` : ''}.
Redes: ${nombres} (ids: ${redes.join(', ')}).
${notaContenido ? `Contenido de su nota (${pieza.nota}):\n"""\n${notaContenido.slice(0, 6000)}\n"""\n` : ''}Para cada red escribe una versión NATIVA (no copies y pegues): en reels, shorts y TikTok, un guion con gancho, texto en pantalla y caption; en carruseles, slide a slide; en historias, la secuencia; en LinkedIn, X y Threads, el texto listo para pegar. Lee _voz.md antes de escribir.
Guarda TODAS las versiones con guardar_versiones (piezaId ${pieza.id}): en "texto" lo que se publica, en "extra" los hashtags o el CTA y en "notas" las indicaciones de grabación o diseño. Si la persona dio fechas, ponlas en "fecha" (AAAA-MM-DD). No publiques nada. Responde con un resumen de dos líneas.`;
}

export function createPublicar({ db, jarvis, vault, alCambiar = () => {} }) {
  const q = {
    pieza: db.prepare('SELECT * FROM piezas WHERE id = ?'),
    piezas: db.prepare("SELECT * FROM piezas WHERE estado != 'publicado' ORDER BY actualizado DESC LIMIT 60"),
    deDePieza: db.prepare('SELECT * FROM pub_versiones WHERE pieza_id = ? ORDER BY id'),
    porRed: db.prepare("SELECT * FROM pub_versiones WHERE pieza_id = ? AND red = ? AND estado != 'publicado'"),
    ins: db.prepare('INSERT INTO pub_versiones (pieza_id, red, formato, titulo, texto, extra, notas, fecha, hora, origen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    upd: db.prepare("UPDATE pub_versiones SET formato = ?, titulo = ?, texto = ?, extra = ?, notas = ?, fecha = COALESCE(?, fecha), hora = COALESCE(?, hora), origen = ?, actualizado = datetime('now','localtime') WHERE id = ?"),
    version: db.prepare('SELECT * FROM pub_versiones WHERE id = ?'),
    programar: db.prepare("UPDATE pub_versiones SET fecha = ?, hora = ?, actualizado = datetime('now','localtime') WHERE id = ?"),
    publicar: db.prepare("UPDATE pub_versiones SET estado = ?, publicado = CASE WHEN ? = 'publicado' THEN datetime('now','localtime') ELSE NULL END, actualizado = datetime('now','localtime') WHERE id = ?"),
    borrar: db.prepare('DELETE FROM pub_versiones WHERE id = ?'),
    rango: db.prepare('SELECT v.*, p.titulo AS pieza_titulo FROM pub_versiones v JOIN piezas p ON p.id = v.pieza_id WHERE v.fecha >= ? AND v.fecha <= ? ORDER BY v.fecha, v.hora'),
    sinFecha: db.prepare("SELECT v.*, p.titulo AS pieza_titulo FROM pub_versiones v JOIN piezas p ON p.id = v.pieza_id WHERE v.fecha IS NULL AND v.estado != 'publicado' ORDER BY v.id DESC LIMIT 50"),
    cuenta: db.prepare('SELECT pieza_id, COUNT(*) AS n, SUM(estado = \'publicado\') AS pub FROM pub_versiones GROUP BY pieza_id'),
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
    // Si todas las versiones están publicadas, la pieza pasa a Publicado
    const vs = rows(q.deDePieza, p.id);
    if (publicado && vs.every((x) => x.estado === 'publicado')) jarvis.actualizarPieza(p.id, { estado: 'publicado' });
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

  function calendario({ desde, hasta }) {
    return { desde, hasta, versiones: rows(q.rango, fecha(desde), fecha(hasta)), sinFecha: rows(q.sinFecha) };
  }

  function piezas() {
    const n = new Map(rows(q.cuenta).map((c) => [c.pieza_id, c]));
    return rows(q.piezas).map((p) => ({ ...p, versiones: n.get(p.id)?.n || 0, publicadas: n.get(p.id)?.pub || 0 }));
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

  return { guardarVersiones, listarPieza, programar, marcar, borrar, calendario, piezas, prepararAdaptacion };
}
