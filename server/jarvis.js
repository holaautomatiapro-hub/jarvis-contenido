import { CATEGORIAS, row, rows } from './db.js';
import { createTareas, TareaError, lunesDe, sumarDias } from './tareas.js';
import { createPipeline } from './pipeline.js';

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
    piezasDelDia: db.prepare('SELECT * FROM piezas WHERE fecha = ? ORDER BY hora, id'),
    versionesDelDia: db.prepare('SELECT v.*, p.titulo AS pieza_titulo FROM pub_versiones v JOIN piezas p ON p.id = v.pieza_id WHERE v.fecha = ? ORDER BY v.hora, v.id'),
    totales: db.prepare('SELECT (SELECT COUNT(*) FROM tareas) AS t, (SELECT COUNT(*) FROM piezas) AS p, (SELECT COUNT(*) FROM actividad) AS a'),
  };

  const registrar = (tipo, txt, origen = 'dashboard') => q.insActividad.run(tipo, txt.slice(0, 300), origen);
  const tareasDb = createTareas({ db, registrar });
  const pipeline = createPipeline({ db });
  const etiquetaFase = (id) => pipeline.etiqueta(id);

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
    for (const k of ['titulo', 'estado', 'formato', 'plataformas', 'fecha', 'hora', 'nota', 'caption', 'video_url', 'carpeta', 'archivos', 'leadmagnet_url']) {
      if (!(k in c)) continue;
      const v = c[k];
      if (k === 'archivos') set.archivos = archivosValidos(v);
      else if (k === 'plataformas') set.plataformas = Array.isArray(v) ? v.join(', ') : v || null;
      else set[k] = typeof v === 'string' ? (k === 'caption' ? v : v.trim()) || null : v ?? null;
    }
    if ('titulo' in set) set.titulo = texto(set.titulo, 'titulo', 200);
    if ('estado' in set && !pipeline.existe(set.estado)) throw new JarvisError(`Fase no válida. Usa: ${pipeline.ids().join(', ')}`);
    if (set.fecha && !/^\d{4}-\d{2}-\d{2}$/.test(set.fecha)) throw new JarvisError('La fecha debe ser AAAA-MM-DD');
    if (set.hora && !/^\d{2}:\d{2}$/.test(set.hora)) throw new JarvisError('La hora debe ser HH:MM');
    if (set.caption) set.caption = set.caption.slice(0, 5000);
    if (set.carpeta) set.carpeta = nombreCarpeta(set.carpeta);
    // Lead magnet: la casilla y su enlace. Sin casilla no se guarda enlace; con enlace, la casilla se marca sola.
    if ('leadmagnet' in c) set.leadmagnet = c.leadmagnet ? 1 : 0;
    if (set.leadmagnet_url) {
      if (!/^https?:\/\/\S+$/i.test(set.leadmagnet_url)) throw new JarvisError('El enlace del lead magnet debe empezar por https://');
      set.leadmagnet_url = set.leadmagnet_url.slice(0, 500);
      if (!('leadmagnet' in set)) set.leadmagnet = 1;
    }
    if (set.leadmagnet === 0) set.leadmagnet_url = null;
    return set;
  };

  function crearPieza({ estado = 'idea', origen = 'dashboard', registrarActividad = true, ...datos }) {
    // Las fases que traía JARVIS de serie y ya no existen van a la primera fase de trabajo
    const set = camposPieza({ ...datos, estado: pipeline.normalizar(estado), titulo: datos.titulo });
    set.orden = q.maxOrden.get(set.estado).m + 1;
    set.origen = origen;
    const claves = Object.keys(set);
    const { lastInsertRowid } = db.prepare(`INSERT INTO piezas (${claves.join(', ')}) VALUES (${claves.map(() => '?').join(', ')})`).run(...claves.map((k) => set[k] ?? null));
    if (registrarActividad) registrar('Contenido', `Pieza creada: ${set.titulo}`, origen);
    return leerPieza(lastInsertRowid);
  }

  function listarPiezas({ estado } = {}) {
    if (estado && !pipeline.existe(estado)) throw new JarvisError(`Fase no válida. Usa: ${pipeline.ids().join(', ')}`);
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
      registrar(set.estado === 'publicado' ? 'Contenido' : 'Tarea', `"${actual.titulo}" pasa a ${etiquetaFase(set.estado)}`, origen);
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
      leadmagnet: p.leadmagnet, leadmagnet_url: p.leadmagnet_url,
    });
    registrar('Contenido', `Copia para volver a publicar: ${p.titulo}`, origen);
    return copia;
  }

  // ---------- Biblioteca: carpetas y carruseles ----------
  // Las carpetas pueden tener subcarpetas: se guardan con su ruta, «Clientes/Andrea/Stories»
  const SEP = '/';
  const nombreCarpeta = (v) => {
    const partes = (typeof v === 'string' ? v : '').split(SEP).map((x) => x.trim().replace(/\s+/g, ' ').slice(0, 60)).filter(Boolean);
    if (!partes.length) throw new JarvisError('Ponle nombre a la carpeta.');
    if (partes.length > 6) throw new JarvisError('Como mucho 6 niveles de subcarpetas.');
    const n = partes.join(SEP);
    if (n.length > 200) throw new JarvisError('El nombre de la carpeta es demasiado largo.');
    return n;
  };
  const padreDe = (n) => (n.includes(SEP) ? n.slice(0, n.lastIndexOf(SEP)) : null);
  const dentroDe = (n, raiz) => n === raiz || n.startsWith(raiz + SEP);
  const ordenRuta = (a, b) => {
    const x = a.split(SEP), y = b.split(SEP);
    for (let i = 0; i < Math.min(x.length, y.length); i++) {
      const c = x[i].localeCompare(y[i], 'es', { numeric: true, sensitivity: 'base' });
      if (c) return c;
    }
    return x.length - y.length;
  };
  function carpetas() {
    const nombres = new Set();
    for (const r of rows(q.carpetas)) {
      // Las carpetas de arriba existen aunque solo se haya guardado la de dentro
      for (let n = r.nombre; n; n = padreDe(n)) nombres.add(n);
    }
    const lista = [...nombres].sort(ordenRuta);
    const directas = new Map(lista.map((n) => [n, q.usoCarpeta.get(n).n]));
    return lista.map((n) => ({
      nombre: n, padre: padreDe(n), etiqueta: n.split(SEP).at(-1), nivel: n.split(SEP).length - 1,
      piezas: directas.get(n), total: lista.filter((m) => dentroDe(m, n)).reduce((a, m) => a + directas.get(m), 0),
      subcarpetas: lista.filter((m) => padreDe(m) === n).length,
    }));
  }
  const existeCarpeta = (n, salvo = null) => carpetas().some((c) => c.nombre.toLowerCase() === n.toLowerCase() && (!salvo || !dentroDe(c.nombre, salvo)));
  // nombre: la carpeta nueva; padre (opcional): dentro de cuál va
  function crearCarpeta(nombre, padre = null) {
    if (padre && !String(nombre ?? '').replace(/\//g, '').trim()) throw new JarvisError('Ponle nombre a la carpeta.');
    const n = nombreCarpeta(padre ? `${nombreCarpeta(padre)}${SEP}${nombre}` : nombre);
    if (existeCarpeta(n)) throw new JarvisError('Ya hay una carpeta con ese nombre.');
    q.insCarpeta.run(n);
    return { nombre: n };
  }
  // Renombra o mueve una carpeta con todo lo de dentro (subcarpetas y piezas)
  function renombrarCarpeta(viejo, nuevo) {
    const v = nombreCarpeta(viejo), n = nombreCarpeta(nuevo);
    if (v === n) return { nombre: n };
    if (dentroDe(n, v)) throw new JarvisError('Una carpeta no puede ir dentro de sí misma.');
    if (existeCarpeta(n, v)) throw new JarvisError('Ya hay una carpeta con ese nombre.');
    const cambiar = (x) => n + x.slice(v.length);
    const guardadas = rows(db.prepare('SELECT nombre FROM contenido_carpetas')).map((r) => r.nombre).filter((x) => dentroDe(x, v));
    const enPiezas = rows(db.prepare('SELECT DISTINCT carpeta FROM piezas WHERE carpeta = ? OR substr(carpeta, 1, ?) = ?'), v, v.length + 1, v + SEP);
    db.exec('BEGIN');
    try {
      for (const x of guardadas) db.prepare('DELETE FROM contenido_carpetas WHERE nombre = ?').run(x);
      for (const x of guardadas) if (!q.getCarpeta.get(cambiar(x))) q.insCarpeta.run(cambiar(x));
      if (!q.getCarpeta.get(n)) q.insCarpeta.run(n);
      for (const { carpeta: x } of enPiezas) db.prepare('UPDATE piezas SET carpeta = ? WHERE carpeta = ?').run(cambiar(x), x);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    return { nombre: n };
  }
  // Las piezas no se borran: pasan a la carpeta de arriba (o se quedan sin carpeta). Las subcarpetas se van con ella.
  function borrarCarpeta(nombre) {
    const n = nombreCarpeta(nombre);
    const destino = padreDe(n);
    let movidas = 0;
    db.exec('BEGIN');
    try {
      for (const { nombre: x } of rows(db.prepare('SELECT nombre FROM contenido_carpetas'))) if (dentroDe(x, n)) db.prepare('DELETE FROM contenido_carpetas WHERE nombre = ?').run(x);
      if (destino && !q.getCarpeta.get(destino)) q.insCarpeta.run(destino);
      movidas = db.prepare('UPDATE piezas SET carpeta = ? WHERE carpeta = ? OR substr(carpeta, 1, ?) = ?').run(destino, n, n.length + 1, n + SEP).changes;
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    return { ok: true, sueltas: movidas, destino };
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
    const fases = pipeline.ids();
    const porEstado = Object.fromEntries(fases.map((e) => [e, piezas.filter((p) => p.estado === e)]));
    return {
      fecha: hoy(),
      tareas: { total: lista.length, hechas: lista.filter((t) => t.hecha).length, pendientes: lista.filter((t) => !t.hecha).map((t) => t.titulo), atrasadas: atrasadas.map((t) => `${t.titulo} (vencía ${t.plazo_hasta})`), altaPrioridad: lista.filter((t) => !t.hecha && t.prioridad === 'alta').map((t) => t.titulo) },
      pipeline: Object.fromEntries(fases.map((e) => [e, porEstado[e].length])),
      fases: pipeline.fases().map((f) => ({ id: f.id, nombre: f.label })),
      paraHoy: piezas.filter((p) => p.fecha === hoy() && p.estado !== 'publicado').map((p) => `${p.titulo} [${etiquetaFase(p.estado)}]`),
      ideasRecientes: (porEstado.idea || []).slice(0, 5).map((p) => p.titulo),
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

  // ---------- Editar, renombrar y borrar notas ----------
  // Las piezas del pipeline guardan la ruta de su nota: al renombrar o restaurar se actualiza
  const reenlazar = (antes, despues) => { if (antes !== despues) db.prepare('UPDATE piezas SET nota = ? WHERE nota = ?').run(despues, antes); };

  function editarNota(ruta, { contenido, titulo, modificado } = {}) {
    let actual = vault.read(ruta);
    if (contenido != null && contenido !== actual.contenido) actual = vault.guardar(actual.path, contenido, { modificado });
    if (titulo != null && String(titulo).trim() && String(titulo).trim() !== actual.titulo) {
      const nueva = vault.renombrar(actual.path, String(titulo).trim());
      reenlazar(actual.path, nueva);
      actual = vault.read(nueva);
    }
    return actual;
  }

  function borrarNota(ruta) {
    return vault.borrar(ruta);
  }

  function restaurarNota(enPapelera, rutaOriginal) {
    const n = vault.restaurar(enPapelera);
    if (rutaOriginal) reenlazar(rutaOriginal, n.path);
    return n;
  }

  // Lo que pide la persona al abrir JARVIS: qué se publica hoy y qué tareas tiene hoy, esta semana y este mes
  function agenda({ fecha = hoy() } = {}) {
    const lunes = lunesDe(fecha), domingo = sumarDias(lunes, 6);
    const finMes = new Date(Number(fecha.slice(0, 4)), Number(fecha.slice(5, 7)), 0, 12).toLocaleDateString('sv-SE');
    const { tareas: todas } = listarTareas({});
    // Las terminadas se quedan a la vista el día que se terminan (para poder desmarcarlas)
    const visible = (t) => t.estado !== 'terminada' || String(t.completada || '').slice(0, 10) === fecha;
    // Cada tarea va donde vence: hoy, esta semana o este mes (las de la semana también salen en el mes)
    const en = (desde, hasta) => todas.filter((t) => visible(t) && !t.atrasada && t.plazo_hasta && t.plazo_hasta >= desde && t.plazo_hasta <= hasta);
    const corta = ({ id, titulo, estado, prioridad, categoria, plazo_tipo, plazo_desde, plazo_hasta, hecha, atrasada }) =>
      ({ id, titulo, estado, prioridad, categoria, plazo_tipo, plazo_desde, plazo_hasta, hecha: Boolean(hecha), atrasada });

    const piezas = rows(q.piezasDelDia, fecha).map((p) => ({
      tipo: 'pieza', id: p.id, titulo: p.titulo, formato: p.formato, hora: p.hora || null, leadmagnet: p.leadmagnet ? p.leadmagnet_url || '' : null,
      estado: p.estado, etiqueta: etiquetaFase(p.estado),
      instagram: p.ig_estado === 'publicado' ? 'publicado' : p.ig_estado === 'error' ? 'error' : p.ig_estado === 'procesando' ? 'publicando' : p.publicar_ig ? 'programado' : null,
      error: p.ig_estado === 'error' ? p.ig_error : null,
    }));
    const versiones = rows(q.versionesDelDia, fecha).map((v) => ({
      tipo: 'version', id: v.id, piezaId: v.pieza_id, titulo: v.titulo || v.pieza_titulo, red: v.red, hora: v.hora || null,
      estado: v.estado, etiqueta: v.estado === 'publicado' ? 'Publicado' : 'Pendiente', instagram: null, error: null,
    }));
    const publicaHoy = [...piezas, ...versiones].sort((a, b) => (a.hora || '99:99').localeCompare(b.hora || '99:99'));

    return {
      fecha,
      publicaHoy,
      tareas: {
        hoy: en(fecha, fecha).map(corta),
        semana: en(lunes, domingo).map(corta),
        mes: en(`${fecha.slice(0, 7)}-01`, finMes).map(corta),
        atrasadas: todas.filter((t) => t.atrasada).map(corta),
      },
    };
  }

  // Lo último que ha llegado por un origen (p. ej. 'hermes' = Telegram)
  function actividadDe(origen, n = 8) {
    return rows(q.actividadDe, origen, n).map((a) => ({ ts: a.ts, tipo: a.tipo, texto: a.texto }));
  }

  return {
    capturarIdea, crearNota, crearPieza, listarPiezas, actualizarPieza, borrarPieza,
    duplicarPieza, carpetas, crearCarpeta, renombrarCarpeta, borrarCarpeta, moverACarpeta, juntarEnCarrusel,
    crearTarea, actualizarTarea, marcarTarea, borrarTarea, listarTareas, tareas, resumenDelDia, inicio, agenda, registrar, editarNota, borrarNota, restaurarNota, actividadDe,
    vault, pipeline,
  };
}


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
