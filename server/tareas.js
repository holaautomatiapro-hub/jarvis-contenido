import { CATEGORIAS, row, rows } from './db.js';

// Tareas con estado, prioridad y fecha límite. La fecha límite puede ser un día, una semana o un mes:
// se guarda como rango (plazo_desde–plazo_hasta) para filtrar por fechas sin casos especiales.

export const ESTADOS_TAREA = ['sin_empezar', 'en_proceso', 'terminada'];
export const PRIORIDADES = ['alta', 'media', 'baja'];
export const PLAZOS = ['dia', 'semana', 'mes'];

export class TareaError extends Error {}

const iso = (d) => d.toLocaleDateString('sv-SE');
// Mediodía local: sumar días no se descuadra con el cambio de hora
const fechaDe = (s) => new Date(`${s}T12:00:00`);
const esFecha = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(fechaDe(s).getTime()) && iso(fechaDe(s)) === s;
export const hoy = () => iso(new Date());

export function lunesDe(s) {
  const d = fechaDe(s);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return iso(d);
}
export function sumarDias(s, n) {
  const d = fechaDe(s);
  d.setDate(d.getDate() + n);
  return iso(d);
}

// Lunes de la semana ISO "2026-W42"
function lunesSemanaIso(anio, semana) {
  const enero4 = new Date(anio, 0, 4, 12);
  enero4.setDate(enero4.getDate() - ((enero4.getDay() + 6) % 7) + (semana - 1) * 7);
  return iso(enero4);
}

// plazo: "AAAA-MM-DD" (día; o cualquier día de la semana/mes), "AAAA-Www" (semana) o "AAAA-MM" (mes)
export function rangoPlazo(tipo, plazo) {
  if (!tipo) return { desde: null, hasta: null };
  if (!PLAZOS.includes(tipo)) throw new TareaError(`Tipo de fecha límite no válido. Usa: ${PLAZOS.join(', ')} (o nada)`);
  const p = typeof plazo === 'string' && plazo.trim() ? plazo.trim() : hoy();
  if (tipo === 'dia') {
    if (!esFecha(p)) throw new TareaError('La fecha debe ser AAAA-MM-DD');
    return { desde: p, hasta: p };
  }
  if (tipo === 'semana') {
    const m = /^(\d{4})-W(\d{1,2})$/i.exec(p);
    let lunes;
    if (m && Number(m[2]) >= 1 && Number(m[2]) <= 53) lunes = lunesSemanaIso(Number(m[1]), Number(m[2]));
    else if (esFecha(p)) lunes = lunesDe(p);
    else throw new TareaError('La semana debe ser AAAA-Www (p. ej. 2026-W42) o un día de esa semana (AAAA-MM-DD)');
    return { desde: lunes, hasta: sumarDias(lunes, 6) };
  }
  const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(p);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12 || (p.length > 7 && !esFecha(p))) throw new TareaError('El mes debe ser AAAA-MM (p. ej. 2026-11)');
  const ultimo = new Date(Number(m[1]), Number(m[2]), 0, 12).getDate();
  return { desde: `${m[1]}-${m[2]}-01`, hasta: `${m[1]}-${m[2]}-${String(ultimo).padStart(2, '0')}` };
}

const ORDEN_ESTADO = { en_proceso: 0, sin_empezar: 1, terminada: 2 };
const ORDEN_PRIORIDAD = { alta: 0, media: 1, baja: 2 };
const ordenar = (a, b) =>
  ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado] ||
  ORDEN_PRIORIDAD[a.prioridad] - ORDEN_PRIORIDAD[b.prioridad] ||
  (a.plazo_hasta || '9999').localeCompare(b.plazo_hasta || '9999') ||
  a.id - b.id;

export function createTareas({ db, registrar }) {
  const q = {
    ins: db.prepare(`INSERT INTO tareas (titulo, descripcion, fecha, categoria, origen, estado, prioridad, plazo_tipo, plazo_desde, plazo_hasta, hecha, completada, actualizado)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 1 THEN datetime('now','localtime') END, datetime('now','localtime'))`),
    get: db.prepare('SELECT * FROM tareas WHERE id = ?'),
    todas: db.prepare('SELECT * FROM tareas'),
    del: db.prepare('DELETE FROM tareas WHERE id = ?'),
  };
  const conDatos = (t, dia = hoy()) => t && { ...t, atrasada: t.estado !== 'terminada' && Boolean(t.plazo_hasta) && t.plazo_hasta < dia };
  const leer = (id) => {
    const t = row(q.get, Number(id));
    if (!t) throw new TareaError('Esa tarea no existe');
    return conDatos(t);
  };

  const validar = { estado: (v) => ESTADOS_TAREA.includes(v), prioridad: (v) => PRIORIDADES.includes(v), categoria: (v) => CATEGORIAS.includes(v) };
  const comprobar = (campo, v) => {
    if (!validar[campo](v)) {
      const lista = { estado: ESTADOS_TAREA, prioridad: PRIORIDADES, categoria: CATEGORIAS }[campo];
      throw new TareaError(`${campo === 'categoria' ? 'Categoría' : campo[0].toUpperCase() + campo.slice(1)} no válida. Usa: ${lista.join(', ')}`);
    }
    return v;
  };
  const titulo = (v) => {
    const s = typeof v === 'string' ? v.trim() : '';
    if (!s) throw new TareaError('Falta "titulo"');
    return s.slice(0, 200);
  };
  const descripcion = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 5000) : null);

  // Sin plazo_tipo: "fecha" (o hoy) es un día concreto, como siempre (así lo usan Hermes y Claude Code).
  // plazo_tipo: null crea la tarea sin fecha límite.
  function crear({ titulo: t, descripcion: d, fecha, plazo_tipo, plazo, prioridad = 'media', estado = 'sin_empezar', categoria = 'contenido', origen = 'dashboard' } = {}) {
    const tit = titulo(t);
    comprobar('prioridad', prioridad); comprobar('estado', estado); comprobar('categoria', categoria);
    const tipo = plazo_tipo === undefined ? 'dia' : plazo_tipo || null;
    const { desde, hasta } = rangoPlazo(tipo, plazo ?? fecha);
    const hecha = estado === 'terminada' ? 1 : 0;
    const { lastInsertRowid } = q.ins.run(tit, descripcion(d), desde || hoy(), categoria, origen, estado, prioridad, tipo, desde, hasta, hecha, hecha);
    if (origen === 'hermes') registrar('Hermes', `Tarea añadida vía Telegram: ${tit}`, origen);
    return leer(lastInsertRowid);
  }

  function actualizar(id, cambios = {}, origen = 'dashboard') {
    const actual = leer(id);
    const set = {};
    if ('titulo' in cambios) set.titulo = titulo(cambios.titulo);
    if ('descripcion' in cambios) set.descripcion = descripcion(cambios.descripcion);
    for (const k of ['prioridad', 'categoria', 'estado']) if (k in cambios) set[k] = comprobar(k, cambios[k]);
    // "hecha" (casilla o completar_tarea) es un atajo del estado
    if ('hecha' in cambios && !('estado' in cambios)) set.estado = cambios.hecha ? 'terminada' : actual.estado === 'terminada' ? 'sin_empezar' : actual.estado;
    if ('plazo_tipo' in cambios || 'plazo' in cambios || 'fecha' in cambios) {
      const tipo = 'plazo_tipo' in cambios ? cambios.plazo_tipo || null : actual.plazo_tipo || 'dia';
      const { desde, hasta } = rangoPlazo(tipo, cambios.plazo ?? cambios.fecha ?? actual.plazo_desde);
      Object.assign(set, { plazo_tipo: tipo, plazo_desde: desde, plazo_hasta: hasta, fecha: desde || actual.fecha });
    }
    if ('estado' in set) {
      set.hecha = set.estado === 'terminada' ? 1 : 0;
      if (set.estado !== actual.estado) set.completada = set.estado === 'terminada' ? new Date().toLocaleString('sv-SE').slice(0, 19) : null;
    }
    const claves = Object.keys(set);
    if (!claves.length) return actual;
    db.prepare(`UPDATE tareas SET ${claves.map((k) => `${k} = ?`).join(', ')}, actualizado = datetime('now','localtime') WHERE id = ?`)
      .run(...claves.map((k) => set[k] ?? null), actual.id);
    if (set.estado === 'terminada' && actual.estado !== 'terminada') registrar('Tarea', `Tarea terminada: ${actual.titulo}`, origen);
    return leer(actual.id);
  }

  function borrar(id) {
    if (!q.del.run(Number(id)).changes) throw new TareaError('Esa tarea no existe');
    return { ok: true };
  }

  // Filtros: estado, prioridad, categoria (uno o varios separados por comas), desde/hasta (solapan con el plazo),
  // sinFecha, atrasadas y texto (título o descripción).
  function listar({ estado, prioridad, categoria, desde, hasta, sinFecha, atrasadas, texto } = {}) {
    const lista = (v) => (Array.isArray(v) ? v : typeof v === 'string' && v ? v.split(',') : null);
    const [es, pr, ca] = [lista(estado), lista(prioridad), lista(categoria)];
    for (const v of es || []) comprobar('estado', v);
    for (const v of pr || []) comprobar('prioridad', v);
    for (const v of ca || []) comprobar('categoria', v);
    for (const f of [desde, hasta]) if (f && !esFecha(f)) throw new TareaError('Las fechas del filtro deben ser AAAA-MM-DD');
    const dia = hoy();
    const busca = typeof texto === 'string' ? texto.trim().toLowerCase() : '';
    const todas = rows(q.todas).map((t) => conDatos(t, dia));
    const resumen = {
      total: todas.length,
      porEstado: Object.fromEntries(ESTADOS_TAREA.map((e) => [e, todas.filter((t) => t.estado === e).length])),
      pendientes: todas.filter((t) => t.estado !== 'terminada').length,
      atrasadas: todas.filter((t) => t.atrasada).length,
      hoy: todas.filter((t) => t.estado !== 'terminada' && t.plazo_desde && t.plazo_desde <= dia && t.plazo_hasta >= dia).length,
      altas: todas.filter((t) => t.estado !== 'terminada' && t.prioridad === 'alta').length,
    };
    const tareas = todas.filter((t) =>
      (!es || es.includes(t.estado)) &&
      (!pr || pr.includes(t.prioridad)) &&
      (!ca || ca.includes(t.categoria)) &&
      (!sinFecha || !t.plazo_tipo) &&
      (!atrasadas || t.atrasada) &&
      (!desde || (t.plazo_hasta && t.plazo_hasta >= desde)) &&
      (!hasta || (t.plazo_desde && t.plazo_desde <= hasta)) &&
      (!busca || `${t.titulo}\n${t.descripcion || ''}`.toLowerCase().includes(busca)),
    ).sort(ordenar);
    return { hoy: dia, tareas, resumen };
  }

  // Plan de un día: lo que vence o cae dentro de ese día/semana/mes, más lo atrasado (si es hoy)
  function delDia({ fecha = hoy() } = {}) {
    if (!esFecha(fecha)) throw new TareaError('La fecha debe ser AAAA-MM-DD');
    const todas = rows(q.todas).map((t) => conDatos(t, fecha));
    const delDia = todas.filter((t) => t.plazo_desde && t.plazo_desde <= fecha && t.plazo_hasta >= fecha)
      .sort((a, b) => a.hecha - b.hecha || ORDEN_PRIORIDAD[a.prioridad] - ORDEN_PRIORIDAD[b.prioridad] || a.id - b.id);
    const atrasadas = fecha === hoy() ? todas.filter((t) => t.atrasada).sort((a, b) => a.plazo_hasta.localeCompare(b.plazo_hasta) || a.id - b.id) : [];
    return { fecha, tareas: delDia, atrasadas };
  }

  return { crear, actualizar, borrar, listar, delDia, leer };
}
