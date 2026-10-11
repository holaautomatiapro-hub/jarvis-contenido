import { CATEGORIAS, ESTADOS, row, rows } from './db.js';
import { createTareas, TareaError } from './tareas.js';

// Lógica de negocio compartida por la API del dashboard y por el MCP (Hermes / Claude Code).

export class JarvisError extends Error {}
export { TareaError };

export const hoy = (d = new Date()) => d.toLocaleDateString('sv-SE');
const ahora = (d = new Date()) => `${hoy(d)} ${d.toTimeString().slice(0, 5)}`;
const diaMenos = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return hoy(d); };

const texto = (v, campo, max = 2000) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) throw new JarvisError(`Falta "${campo}"`);
  return s.slice(0, max);
};
const tituloDe = (t) => {
  const primera = t.split('\n')[0].replace(/^#+\s*/, '').trim();
  return primera.length > 70 ? primera.slice(0, 67).replace(/\s+\S*$/, '') + '…' : primera;
};
const frontmatter = (campos) =>
  '---\n' + Object.entries(campos).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}: ${v}`).join('\n') + '\n---\n';

export function createJarvis({ db, vault }) {
  const q = {
    insActividad: db.prepare('INSERT INTO actividad (tipo, texto, origen) VALUES (?, ?, ?)'),
    getPieza: db.prepare('SELECT * FROM piezas WHERE id = ?'),
    piezas: db.prepare('SELECT * FROM piezas ORDER BY orden DESC, id DESC'),
    piezasEstado: db.prepare('SELECT * FROM piezas WHERE estado = ? ORDER BY orden DESC, id DESC'),
    maxOrden: db.prepare('SELECT COALESCE(MAX(orden), 0) AS m FROM piezas WHERE estado = ?'),
    delPieza: db.prepare('DELETE FROM piezas WHERE id = ?'),
    carpetas: db.prepare("SELECT nombre FROM contenido_carpetas UNION SELECT carpeta FROM piezas WHERE carpeta IS NOT NULL AND carpeta != ''"),
    getCarpeta: db.prepare('SELECT nombre FROM contenido_carpetas WHERE nombre = ?'),
    insCarpeta: db.prepare('INSERT INTO contenido_carpetas (nombre) VALUES (?)'),
    usoCarpeta: db.prepare('SELECT COUNT(*) AS n FROM piezas WHERE carpeta = ?'),
    actividad: db.prepare('SELECT * FROM actividad ORDER BY id DESC LIMIT ?'),
    actividadDe: db.prepare('SELECT * FROM actividad WHERE origen = ? ORDER BY id DESC LIMIT ?'),
    cuentaPorDia: (tabla, col, filtro = '') =>
      db.prepare(`SELECT substr(${col}, 1, 10) AS dia, COUNT(*) AS n FROM ${tabla} WHERE substr(${col}, 1, 10) >= ? ${filtro} GROUP BY dia`),
    totales: db.prepare('SELECT (SELECT COUNT(*) FROM tareas) AS t, (SELECT COUNT(*) FROM piezas) AS p, (SELECT COUNT(*) FROM actividad) AS a'),
  };

  const registrar = (tipo, txt, origen = 'dashboard') => q.insActividad.run(tipo, txt.slice(0, 300), origen);
  const tareasDb = createTareas({ db, registrar });

  // ---------- Ideas, notas y piezas ----------
  function capturarIdea({ texto: t, origen = 'dashboard', formato = null }) {
    // "idea: …" (como se escribe en Telegram o por voz) no forma parte del título
    const contenido = texto(typeof t === 'string' ? t.replace(/^\s*idea\s*:\s*/i, '') : t, 'texto', 8000);
    const titulo = tituloDe(contenido);
    const nota = vault.create('01-Ideas', titulo, frontmatter({ tipo: 'idea', creado: ahora(), origen, formato }) + `# ${titulo}\n\n${contenido}\n`);
    const pieza = crearPieza({ titulo, estado: 'idea', formato, nota, origen, registrarActividad: false });
    registrar(origen === 'hermes' ? 'Hermes' : 'Idea', `Nueva idea${origen === 'hermes' ? ' vía Telegram' : ''}: ${titulo}`, origen);
    return { pieza, nota };
  }

  function crearNota({ carpeta = '00-Inbox', titulo, contenido = '', origen = 'dashboard', tipo = 'nota' }) {
    const t = texto(titulo, 'titulo', 120);
    const cuerpo = typeof contenido === 'string' ? contenido : '';
    const ruta = vault.create(carpeta, t, frontmatter({ tipo, creado: ahora(), origen }) + `# ${t}\n\n${cuerpo}\n`);
    registrar(origen === 'hermes' ? 'Hermes' : 'Nota', `Nota creada: ${t}`, origen);
    return { nota: ruta };
  }

  // Las piezas guardan sus archivos como JSON: [{ path, url, nombre, mime, tamano }]
  const pieza = (p) => {
    if (!p) return p;
    let archivos = [];
    try { archivos = JSON.parse(p.archivos || '[]'); } catch { /* columna dañada: sin archivos */ }
    return { ...p, archivos: Array.isArray(archivos) ? archivos : [] };
  };
  const leerPieza = (id) => {
    const p = pieza(row(q.getPieza, Number(id)));
    if (!p) throw new JarvisError('Esa pieza no existe');
    return p;
  };
  const archivosValidos = (v) => {
    if (!Array.isArray(v)) throw new JarvisError('"archivos" debe ser una lista');
    return JSON.stringify(v.slice(0, 50).map((a) => ({
      path: String(a?.path || ''), url: String(a?.url || ''), nombre: String(a?.nombre || '').slice(0, 200),
      mime: String(a?.mime || ''), tamano: Number(a?.tamano) || 0,
    })).filter((a) => a.url));
  };
  // Normaliza los campos que se pueden escribir en una pieza
  const camposPieza = (c) => {
    const set = {};
    for (const k of ['titulo', 'estado', 'formato', 'plataformas', 'fecha', 'hora', 'nota', 'caption', 'video_url', 'carpeta', 'archivos']) {
      if (!(k in c)) continue;
      const v = c[k];
      if (k === 'archivos') set.archivos = archivosValidos(v);
      else if (k === 'plataformas') set.plataformas = Array.isArray(v) ? v.join(', ') : v || null;
      else set[k] = typeof v === 'string' ? (k === 'caption' ? v : v.trim()) || null : v ?? null;
    }
    if ('titulo' in set) set.titulo = texto(set.titulo, 'titulo', 200);
    if ('estado' in set && !ESTADOS.includes(set.estado)) throw new JarvisError(`Estado no válido. Usa: ${ESTADOS.join(', ')}`);
    if (set.fecha && !/^\d{4}-\d{2}-\d{2}$/.test(set.fecha)) throw new JarvisError('La fecha debe ser AAAA-MM-DD');
    if (set.hora && !/^\d{2}:\d{2}$/.test(set.hora)) throw new JarvisError('La hora debe ser HH:MM');
    if (set.caption) set.caption = set.caption.slice(0, 5000);
    if (set.carpeta) set.carpeta = set.carpeta.slice(0, 80);
    return set;
  };

  function crearPieza({ estado = 'idea', origen = 'dashboard', registrarActividad = true, ...datos }) {
    const set = camposPieza({ ...datos, estado, titulo: datos.titulo });
    set.orden = q.maxOrden.get(set.estado).m + 1;
    set.origen = origen;
    const claves = Object.keys(set);
    const { lastInsertRowid } = db.prepare(`INSERT INTO piezas (${claves.join(', ')}) VALUES (${claves.map(() => '?').join(', ')})`).run(...claves.map((k) => set[k] ?? null));
    if (registrarActividad) registrar('Contenido', `Pieza creada: ${set.titulo}`, origen);
    return leerPieza(lastInsertRowid);
  }

  function listarPiezas({ estado } = {}) {
    if (estado && !ESTADOS.includes(estado)) throw new JarvisError(`Estado no válido. Usa: ${ESTADOS.join(', ')}`);
    return (estado ? rows(q.piezasEstado, estado) : rows(q.piezas)).map(pieza);
  }

  function actualizarPieza(id, cambios = {}, origen = 'dashboard') {
    const actual = leerPieza(id);
    const set = camposPieza(cambios);
    if ('estado' in set && set.estado !== actual.estado) set.orden = q.maxOrden.get(set.estado).m + 1;
    const claves = Object.keys(set);
    if (!claves.length) return actual;
    db.prepare(`UPDATE piezas SET ${claves.map((k) => `${k} = ?`).join(', ')}, actualizado = datetime('now','localtime') WHERE id = ?`)
      .run(...claves.map((k) => set[k] ?? null), actual.id);
    if (set.estado && set.estado !== actual.estado) {
      registrar(set.estado === 'publicado' ? 'Contenido' : 'Tarea', `"${actual.titulo}" pasa a ${ETIQUETA_ESTADO[set.estado]}`, origen);
    }
    return leerPieza(actual.id);
  }

  // Devuelve la pieza borrada para que quien llama pueda borrar también sus archivos
  function borrarPieza(id) {
    const p = leerPieza(id);
    q.delPieza.run(p.id);
    return { ok: true, pieza: p };
  }

  // Copia de una pieza (p. ej. un carrusel ya publicado) para volver a publicarla otro día.
  // Comparte los archivos: no se borran del disco mientras alguna pieza los use.
  function duplicarPieza(id, origen = 'dashboard') {
    const p = leerPieza(id);
    const copia = crearPieza({
      titulo: p.titulo, estado: 'listo', formato: p.formato, plataformas: p.plataformas, caption: p.caption,
      video_url: p.video_url, carpeta: p.carpeta, nota: p.nota, archivos: p.archivos, fecha: null, hora: p.hora, origen, registrarActividad: false,
    });
    registrar('Contenido', `Copia para volver a publicar: ${p.titulo}`, origen);
    return copia;
  }

  // ---------- Biblioteca: carpetas y carruseles ----------
  const nombreCarpeta = (v) => {
    const s = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
    if (!s) throw new JarvisError('Ponle nombre a la carpeta.');
    return s.slice(0, 80);
  };
  function carpetas() {
    return rows(q.carpetas).map((r) => ({ nombre: r.nombre, piezas: q.usoCarpeta.get(r.nombre).n }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true }));
  }
  function crearCarpeta(nombre) {
    const n = nombreCarpeta(nombre);
    if (carpetas().some((c) => c.nombre.toLowerCase() === n.toLowerCase())) throw new JarvisError('Ya hay una carpeta con ese nombre.');
    q.insCarpeta.run(n);
    return { nombre: n };
  }
  function renombrarCarpeta(viejo, nuevo) {
    const v = nombreCarpeta(viejo), n = nombreCarpeta(nuevo);
    if (v === n) return { nombre: n };
    if (carpetas().some((c) => c.nombre.toLowerCase() === n.toLowerCase() && c.nombre.toLowerCase() !== v.toLowerCase())) throw new JarvisError('Ya hay una carpeta con ese nombre.');
    db.prepare('DELETE FROM contenido_carpetas WHERE nombre = ?').run(v);
    if (!q.getCarpeta.get(n)) q.insCarpeta.run(n);
    db.prepare('UPDATE piezas SET carpeta = ? WHERE carpeta = ?').run(n, v);
    return { nombre: n };
  }
  // Las piezas de la carpeta no se borran: se quedan sueltas
  function borrarCarpeta(nombre) {
    const n = nombreCarpeta(nombre);
    db.prepare('DELETE FROM contenido_carpetas WHERE nombre = ?').run(n);
    const { changes } = db.prepare('UPDATE piezas SET carpeta = NULL WHERE carpeta = ?').run(n);
    return { ok: true, sueltas: changes };
  }
  const idsDe = (ids) => {
    if (!Array.isArray(ids) || !ids.length) throw new JarvisError('Marca al menos una pieza');
    return ids.map((id) => leerPieza(id).id);
  };
  function moverACarpeta(ids, carpeta) {
    const n = carpeta ? nombreCarpeta(carpeta) : null;
    if (n && !q.getCarpeta.get(n)) q.insCarpeta.run(n);
    const upd = db.prepare("UPDATE piezas SET carpeta = ?, actualizado = datetime('now','localtime') WHERE id = ?");
    for (const id of idsDe(ids)) upd.run(n, id);
    return { ok: true };
  }
  // Junta varias piezas en un carrusel, en el orden en que se marcaron. Los archivos no se borran: pasan al carrusel.
  function juntarEnCarrusel(ids, origen = 'dashboard') {
    const lista = idsDe(ids).map(leerPieza);
    if (lista.length < 2) throw new JarvisError('Marca al menos dos piezas para juntarlas');
    const [primera] = lista;
    const nueva = crearPieza({
      titulo: primera.titulo, estado: primera.estado, formato: 'Carrusel', fecha: primera.fecha, hora: primera.hora,
      carpeta: primera.carpeta, caption: lista.find((p) => p.caption?.trim())?.caption || null,
      archivos: lista.flatMap((p) => p.archivos), origen, registrarActividad: false,
    });
    for (const p of lista) q.delPieza.run(p.id);
    registrar('Contenido', `Carrusel creado con ${lista.length} piezas: ${nueva.titulo}`, origen);
    return nueva;
  }

  // ---------- Tareas (server/tareas.js) ----------
  const crearTarea = (datos) => tareasDb.crear(datos);
  const actualizarTarea = (id, cambios, origen) => tareasDb.actualizar(id, cambios, origen);
  const marcarTarea = (id, hecha = true, origen = 'dashboard') => tareasDb.actualizar(id, { hecha }, origen);
  const borrarTarea = (id) => tareasDb.borrar(id);
  const listarTareas = (filtros) => tareasDb.listar(filtros);
  const tareas = (opts) => tareasDb.delDia(opts);

  // ---------- Resúmenes ----------
  function resumenDelDia() {
    const { tareas: lista, atrasadas } = tareas();
    const piezas = listarPiezas();
    const porEstado = Object.fromEntries(ESTADOS.map((e) => [e, piezas.filter((p) => p.estado === e)]));
    return {
      fecha: hoy(),
      tareas: { total: lista.length, hechas: lista.filter((t) => t.hecha).length, pendientes: lista.filter((t) => !t.hecha).map((t) => t.titulo), atrasadas: atrasadas.map((t) => `${t.titulo} (vencía ${t.plazo_hasta})`), altaPrioridad: lista.filter((t) => !t.hecha && t.prioridad === 'alta').map((t) => t.titulo) },
      pipeline: Object.fromEntries(ESTADOS.map((e) => [e, porEstado[e].length])),
      paraHoy: piezas.filter((p) => p.fecha === hoy() && p.estado !== 'publicado').map((p) => `${p.titulo} [${ETIQUETA_ESTADO[p.estado]}]`),
      ideasRecientes: porEstado.idea.slice(0, 5).map((p) => p.titulo),
    };
  }

  function inicio() {
    const desde = diaMenos(13);
    const notas = vault.list();
    const serie = (stmt, ...args) => {
      const m = new Map(rows(stmt, desde, ...args).map((r) => [r.dia, r.n]));
      return Array.from({ length: 14 }, (_, i) => m.get(diaMenos(13 - i)) || 0);
    };
    const tareasSerie = serie(q.cuentaPorDia('tareas', 'fecha'));
    const analisisSerie = serie(q.cuentaPorDia('actividad', 'ts', "AND tipo = 'Analisis'"));
    const notasPorDia = new Map(), ideasPorDia = new Map();
    for (const n of notas) {
      const d = hoy(new Date(n.creado));
      notasPorDia.set(d, (notasPorDia.get(d) || 0) + 1);
      if (n.carpeta === '01-Ideas') ideasPorDia.set(d, (ideasPorDia.get(d) || 0) + 1);
    }
    const ideasSerie = Array.from({ length: 14 }, (_, i) => ideasPorDia.get(diaMenos(13 - i)) || 0);
    let acumulado = notas.filter((n) => hoy(new Date(n.creado)) < desde).length;
    const notasSerie = Array.from({ length: 14 }, (_, i) => (acumulado += notasPorDia.get(diaMenos(13 - i)) || 0));

    const suma = (a, i, j) => a.slice(i, j).reduce((x, y) => x + y, 0);
    const delta = (a) => { const prev = suma(a, 0, 7), cur = suma(a, 7, 14); return prev ? Math.round(((cur - prev) / prev) * 100) : cur ? 100 : 0; };
    const deltaAcum = (a) => (a[6] ? Math.round(((a[13] - a[6]) / a[6]) * 100) : a[13] ? 100 : 0);

    const kpis = [
      { id: 'tareas', label: 'Tareas hoy', value: tareasSerie[13], delta: delta(tareasSerie), color: 'var(--orange)', icon: 'checkCircle', series: tareasSerie.slice(2) },
      { id: 'ideas', label: 'Ideas capturadas', value: suma(ideasSerie, 7, 14), delta: delta(ideasSerie), color: 'var(--blue)', icon: 'bulb', series: ideasSerie.slice(2) },
      { id: 'notas', label: 'Notas', value: notas.length, delta: deltaAcum(notasSerie), color: 'var(--purple)', icon: 'doc', series: notasSerie.slice(2) },
      { id: 'contenido', label: 'Contenido analizado', value: suma(analisisSerie, 7, 14), delta: delta(analisisSerie), color: 'var(--green)', icon: 'chart', series: analisisSerie.slice(2) },
    ];

    // Foco de la semana: tareas por categoría + ideas capturadas
    const porCat = Object.fromEntries(CATEGORIAS.map((c) => [c, 0]));
    for (const r of rows(db.prepare('SELECT categoria, COUNT(*) AS n FROM tareas WHERE fecha >= ? GROUP BY categoria'), diaMenos(6))) porCat[r.categoria] = r.n;
    porCat.ideas += suma(ideasSerie, 7, 14);
    const totalFoco = Object.values(porCat).reduce((a, b) => a + b, 0) || 1;
    const foco = FOCO.map((f) => ({ ...f, pct: Math.round((porCat[f.id] / totalFoco) * 100) }));

    const actividad = rows(q.actividad, 6).map((a) => ({
      hora: a.ts.slice(11, 16),
      ...(ACTIVIDAD[a.origen === 'hermes' ? 'Hermes' : a.tipo] || ACTIVIDAD.Nota),
      texto: a.texto,
    }));

    const tot = row(q.totales);
    const vacio = !tot.t && !tot.p && !tot.a;
    return { vacio, kpis, foco, actividad };
  }

  // Lo último que ha llegado por un origen (p. ej. 'hermes' = Telegram)
  function actividadDe(origen, n = 8) {
    return rows(q.actividadDe, origen, n).map((a) => ({ ts: a.ts, tipo: a.tipo, texto: a.texto }));
  }

  return {
    capturarIdea, crearNota, crearPieza, listarPiezas, actualizarPieza, borrarPieza,
    duplicarPieza, carpetas, crearCarpeta, renombrarCarpeta, borrarCarpeta, moverACarpeta, juntarEnCarrusel,
    crearTarea, actualizarTarea, marcarTarea, borrarTarea, listarTareas, tareas, resumenDelDia, inicio, registrar, actividadDe,
    vault,
  };
}

export const ETIQUETA_ESTADO = { idea: 'Idea', guion: 'Guion', grabar: 'Grabar', editar: 'Editar', listo: 'Listo', publicado: 'Publicado' };

const FOCO = [
  { id: 'ideas', label: 'Ideas', color: 'var(--blue)', icon: 'bulb' },
  { id: 'contenido', label: 'Contenido', color: 'var(--purple)', icon: 'pen' },
  { id: 'analisis', label: 'Análisis', color: 'var(--orange)', icon: 'chart' },
  { id: 'administracion', label: 'Administración', color: 'var(--green)', icon: 'briefcase' },
  { id: 'aprendizaje', label: 'Aprendizaje', color: 'var(--cyan)', icon: 'book' },
];

const ACTIVIDAD = {
  Idea: { icon: 'bulb', color: 'var(--blue)', tag: 'Idea' },
  Contenido: { icon: 'pen', color: 'var(--purple)', tag: 'Contenido' },
  Nota: { icon: 'doc', color: 'var(--green)', tag: 'Nota' },
  Tarea: { icon: 'checkCircle', color: 'var(--orange)', tag: 'Tarea' },
  Analisis: { icon: 'chart', color: 'var(--green)', tag: 'Análisis' },
  Hermes: { icon: 'telegram', color: 'var(--cyan)', tag: 'Hermes' },
};
