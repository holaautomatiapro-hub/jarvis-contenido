import { CATEGORIAS, ESTADOS, row, rows } from './db.js';

// Lógica de negocio compartida por la API del dashboard y por el MCP (Hermes / Claude Code).

export class JarvisError extends Error {}

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
    insPieza: db.prepare('INSERT INTO piezas (titulo, estado, formato, plataformas, fecha, nota, origen, orden) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    getPieza: db.prepare('SELECT * FROM piezas WHERE id = ?'),
    piezas: db.prepare('SELECT * FROM piezas ORDER BY orden DESC, id DESC'),
    piezasEstado: db.prepare('SELECT * FROM piezas WHERE estado = ? ORDER BY orden DESC, id DESC'),
    maxOrden: db.prepare('SELECT COALESCE(MAX(orden), 0) AS m FROM piezas WHERE estado = ?'),
    delPieza: db.prepare('DELETE FROM piezas WHERE id = ?'),
    insTarea: db.prepare('INSERT INTO tareas (titulo, fecha, categoria, origen) VALUES (?, ?, ?, ?)'),
    getTarea: db.prepare('SELECT * FROM tareas WHERE id = ?'),
    tareasFecha: db.prepare('SELECT * FROM tareas WHERE fecha = ? ORDER BY hecha, id'),
    pendientesAntes: db.prepare('SELECT * FROM tareas WHERE fecha < ? AND hecha = 0 ORDER BY fecha, id'),
    setHecha: db.prepare("UPDATE tareas SET hecha = ?, completada = CASE WHEN ? = 1 THEN datetime('now','localtime') ELSE NULL END WHERE id = ?"),
    delTarea: db.prepare('DELETE FROM tareas WHERE id = ?'),
    actividad: db.prepare('SELECT * FROM actividad ORDER BY id DESC LIMIT ?'),
    actividadDe: db.prepare('SELECT * FROM actividad WHERE origen = ? ORDER BY id DESC LIMIT ?'),
    cuentaPorDia: (tabla, col, filtro = '') =>
      db.prepare(`SELECT substr(${col}, 1, 10) AS dia, COUNT(*) AS n FROM ${tabla} WHERE substr(${col}, 1, 10) >= ? ${filtro} GROUP BY dia`),
    totales: db.prepare('SELECT (SELECT COUNT(*) FROM tareas) AS t, (SELECT COUNT(*) FROM piezas) AS p, (SELECT COUNT(*) FROM actividad) AS a'),
  };

  const registrar = (tipo, txt, origen = 'dashboard') => q.insActividad.run(tipo, txt.slice(0, 300), origen);

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

  function crearPieza({ titulo, estado = 'idea', formato = null, plataformas = null, fecha = null, nota = null, origen = 'dashboard', registrarActividad = true }) {
    const t = texto(titulo, 'titulo', 200);
    if (!ESTADOS.includes(estado)) throw new JarvisError(`Estado no válido. Usa: ${ESTADOS.join(', ')}`);
    const plats = Array.isArray(plataformas) ? plataformas.join(', ') : plataformas;
    const orden = q.maxOrden.get(estado).m + 1;
    const { lastInsertRowid } = q.insPieza.run(t, estado, formato, plats, fecha, nota, origen, orden);
    if (registrarActividad) registrar('Contenido', `Pieza creada: ${t}`, origen);
    return row(q.getPieza, lastInsertRowid);
  }

  function listarPiezas({ estado } = {}) {
    if (estado && !ESTADOS.includes(estado)) throw new JarvisError(`Estado no válido. Usa: ${ESTADOS.join(', ')}`);
    return estado ? rows(q.piezasEstado, estado) : rows(q.piezas);
  }

  function actualizarPieza(id, cambios = {}, origen = 'dashboard') {
    const actual = row(q.getPieza, Number(id));
    if (!actual) throw new JarvisError('Esa pieza no existe');
    const permitidos = ['titulo', 'estado', 'formato', 'plataformas', 'fecha', 'nota'];
    const set = {};
    for (const k of permitidos) if (k in cambios) set[k] = Array.isArray(cambios[k]) ? cambios[k].join(', ') : cambios[k];
    if ('estado' in set && !ESTADOS.includes(set.estado)) throw new JarvisError(`Estado no válido. Usa: ${ESTADOS.join(', ')}`);
    if ('titulo' in set) set.titulo = texto(set.titulo, 'titulo', 200);
    if ('estado' in set && set.estado !== actual.estado) set.orden = q.maxOrden.get(set.estado).m + 1;
    const claves = Object.keys(set);
    if (!claves.length) return actual;
    db.prepare(`UPDATE piezas SET ${claves.map((k) => `${k} = ?`).join(', ')}, actualizado = datetime('now','localtime') WHERE id = ?`)
      .run(...claves.map((k) => set[k] ?? null), actual.id);
    if (set.estado && set.estado !== actual.estado) {
      registrar(set.estado === 'publicado' ? 'Contenido' : 'Tarea', `"${actual.titulo}" pasa a ${ETIQUETA_ESTADO[set.estado]}`, origen);
    }
    return row(q.getPieza, actual.id);
  }

  function borrarPieza(id) {
    if (!q.delPieza.run(Number(id)).changes) throw new JarvisError('Esa pieza no existe');
    return { ok: true };
  }

  // ---------- Tareas ----------
  function crearTarea({ titulo, fecha = hoy(), categoria = 'contenido', origen = 'dashboard' }) {
    const t = texto(titulo, 'titulo', 200);
    if (!CATEGORIAS.includes(categoria)) throw new JarvisError(`Categoría no válida. Usa: ${CATEGORIAS.join(', ')}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new JarvisError('La fecha debe ser AAAA-MM-DD');
    const { lastInsertRowid } = q.insTarea.run(t, fecha, categoria, origen);
    if (origen === 'hermes') registrar('Hermes', `Tarea añadida vía Telegram: ${t}`, origen);
    return row(q.getTarea, lastInsertRowid);
  }

  function marcarTarea(id, hecha = true, origen = 'dashboard') {
    const t = row(q.getTarea, Number(id));
    if (!t) throw new JarvisError('Esa tarea no existe');
    q.setHecha.run(hecha ? 1 : 0, hecha ? 1 : 0, t.id);
    if (hecha && !t.hecha) registrar('Tarea', `Tarea completada: ${t.titulo}`, origen);
    return row(q.getTarea, t.id);
  }

  function borrarTarea(id) {
    if (!q.delTarea.run(Number(id)).changes) throw new JarvisError('Esa tarea no existe');
    return { ok: true };
  }

  function tareas({ fecha = hoy() } = {}) {
    return { fecha, tareas: rows(q.tareasFecha, fecha), atrasadas: fecha === hoy() ? rows(q.pendientesAntes, fecha) : [] };
  }

  // ---------- Resúmenes ----------
  function resumenDelDia() {
    const { tareas: lista, atrasadas } = tareas();
    const piezas = listarPiezas();
    const porEstado = Object.fromEntries(ESTADOS.map((e) => [e, piezas.filter((p) => p.estado === e)]));
    return {
      fecha: hoy(),
      tareas: { total: lista.length, hechas: lista.filter((t) => t.hecha).length, pendientes: lista.filter((t) => !t.hecha).map((t) => t.titulo), atrasadas: atrasadas.map((t) => `${t.titulo} (${t.fecha})`) },
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
    crearTarea, marcarTarea, borrarTarea, tareas, resumenDelDia, inicio, registrar, actividadDe,
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
