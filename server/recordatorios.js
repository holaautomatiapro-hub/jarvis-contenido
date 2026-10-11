import { row, rows } from './db.js';

// Recordatorios que se repiten (todos los días o algunos días de la semana) y salen en Inicio para marcarlos
// cada día: «subir una story», «responder DMs»… Se guarda qué día se marcó cada uno.

export class RecordatorioError extends Error {
  constructor(m) { super(m); this.publico = true; }
}

const TODOS = [0, 1, 2, 3, 4, 5, 6]; // como Date.getDay(): 0 = domingo
const iso = (d) => d.toLocaleDateString('sv-SE');
const esFecha = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

export function createRecordatorios({ db }) {
  db.exec(`CREATE TABLE IF NOT EXISTS recordatorios (
    id INTEGER PRIMARY KEY,
    texto TEXT NOT NULL,
    dias TEXT NOT NULL DEFAULT '0,1,2,3,4,5,6',
    hora TEXT,
    activo INTEGER NOT NULL DEFAULT 1,
    origen TEXT NOT NULL DEFAULT 'dashboard',
    creado TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS recordatorios_hechos (
    recordatorio_id INTEGER NOT NULL,
    fecha TEXT NOT NULL,
    PRIMARY KEY (recordatorio_id, fecha)
  );`);
  const q = {
    todos: db.prepare('SELECT * FROM recordatorios ORDER BY COALESCE(hora, \'99:99\'), id'),
    get: db.prepare('SELECT * FROM recordatorios WHERE id = ?'),
    hechos: db.prepare('SELECT recordatorio_id FROM recordatorios_hechos WHERE fecha = ?'),
    marcar: db.prepare('INSERT OR IGNORE INTO recordatorios_hechos (recordatorio_id, fecha) VALUES (?, ?)'),
    desmarcar: db.prepare('DELETE FROM recordatorios_hechos WHERE recordatorio_id = ? AND fecha = ?'),
    del: db.prepare('DELETE FROM recordatorios WHERE id = ?'),
    delHechos: db.prepare('DELETE FROM recordatorios_hechos WHERE recordatorio_id = ?'),
  };

  const vista = (r) => r && { ...r, activo: Boolean(r.activo), dias: r.dias.split(',').filter(Boolean).map(Number) };
  const leer = (id) => {
    const r = vista(row(q.get, Number(id)));
    if (!r) throw new RecordatorioError('Ese recordatorio no existe');
    return r;
  };
  const campos = (c) => {
    const set = {};
    if ('texto' in c) {
      const t = typeof c.texto === 'string' ? c.texto.trim() : '';
      if (!t) throw new RecordatorioError('Escribe el recordatorio');
      set.texto = t.slice(0, 200);
    }
    if ('dias' in c) {
      const d = c.dias === 'diario' || c.dias == null ? TODOS : Array.isArray(c.dias) ? c.dias : String(c.dias).split(',');
      const nums = [...new Set(d.map(Number))].filter((n) => TODOS.includes(n)).sort();
      if (!nums.length) throw new RecordatorioError('Elige al menos un día');
      set.dias = nums.join(',');
    }
    if ('hora' in c) {
      if (c.hora && !/^\d{2}:\d{2}$/.test(c.hora)) throw new RecordatorioError('La hora debe ser HH:MM');
      set.hora = c.hora || null;
    }
    if ('activo' in c) set.activo = c.activo ? 1 : 0;
    return set;
  };

  const listar = () => rows(q.todos).map(vista);

  // Los de un día, con si ya se marcaron
  function deHoy({ fecha = iso(new Date()) } = {}) {
    if (!esFecha(fecha)) throw new RecordatorioError('La fecha debe ser AAAA-MM-DD');
    const dia = new Date(`${fecha}T12:00:00`).getDay();
    const hechos = new Set(rows(q.hechos, fecha).map((h) => h.recordatorio_id));
    return listar().filter((r) => r.activo && r.dias.includes(dia)).map((r) => ({ ...r, hecho: hechos.has(r.id), fecha }));
  }

  function crear({ texto, dias = 'diario', hora = null, origen = 'dashboard' } = {}) {
    const set = campos({ texto, dias, hora });
    const { lastInsertRowid } = db.prepare('INSERT INTO recordatorios (texto, dias, hora, origen) VALUES (?, ?, ?, ?)').run(set.texto, set.dias, set.hora ?? null, origen);
    return leer(lastInsertRowid);
  }

  function actualizar(id, cambios = {}) {
    const r = leer(id);
    const set = campos(cambios);
    const claves = Object.keys(set);
    if (claves.length) db.prepare(`UPDATE recordatorios SET ${claves.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...claves.map((k) => set[k]), r.id);
    return leer(r.id);
  }

  function borrar(id) {
    const r = leer(id);
    q.del.run(r.id);
    q.delHechos.run(r.id);
    return { ok: true };
  }

  function marcar(id, { hecho = true, fecha = iso(new Date()) } = {}) {
    const r = leer(id);
    if (!esFecha(fecha)) throw new RecordatorioError('La fecha debe ser AAAA-MM-DD');
    if (hecho) q.marcar.run(r.id, fecha); else q.desmarcar.run(r.id, fecha);
    return { ...r, hecho: Boolean(hecho), fecha };
  }

  return { listar, deHoy, crear, actualizar, borrar, marcar };
}
