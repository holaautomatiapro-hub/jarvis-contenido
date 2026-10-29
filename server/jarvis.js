import { OBJETIVOS, ajustes, row, rows } from './db.js';
import { createTareas, TareaError, lunesDe, sumarDias } from './tareas.js';
import { createPipeline } from './pipeline.js';

// Lógica de negocio compartida por la API del dashboard y por el MCP (Hermes / Claude Code).

export class JarvisError extends Error {}
export { TareaError };

export const hoy = (d = new Date()) => d.toLocaleDateString('sv-SE');
const ahora = (d = new Date()) => `${hoy(d)} ${d.toTimeString().slice(0, 5)}`;

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
    porOrigenRef: db.prepare('SELECT * FROM piezas WHERE origen_ref = ? ORDER BY id DESC LIMIT 1'),
    setGuion: db.prepare('UPDATE piezas SET guion_nota = ?, nota = COALESCE(nota, ?), actualizado = datetime(\'now\',\'localtime\') WHERE id = ?'),
    piezas: db.prepare('SELECT * FROM piezas ORDER BY orden DESC, id DESC'),
    piezasEstado: db.prepare('SELECT * FROM piezas WHERE estado = ? ORDER BY orden DESC, id DESC'),
    maxOrden: db.prepare('SELECT COALESCE(MAX(orden), 0) AS m FROM piezas WHERE estado = ?'),
    delPieza: db.prepare('DELETE FROM piezas WHERE id = ?'),
    carpetas: db.prepare("SELECT nombre FROM contenido_carpetas UNION SELECT carpeta FROM piezas WHERE carpeta IS NOT NULL AND carpeta != ''"),
    getCarpeta: db.prepare('SELECT nombre FROM contenido_carpetas WHERE nombre = ?'),
    insCarpeta: db.prepare('INSERT INTO contenido_carpetas (nombre) VALUES (?)'),
    usoCarpeta: db.prepare('SELECT COUNT(*) AS n FROM piezas WHERE carpeta = ?'),
    actividadDe: db.prepare('SELECT * FROM actividad WHERE origen = ? ORDER BY id DESC LIMIT ?'),
    piezasDelDia: db.prepare('SELECT * FROM piezas WHERE fecha = ? ORDER BY hora, id'),
    // Versiones para otras redes con un día propio distinto del de su pieza (las demás salen con la pieza)
    versionesDelDia: db.prepare('SELECT v.*, p.titulo AS pieza_titulo FROM pub_versiones v JOIN piezas p ON p.id = v.pieza_id WHERE v.fecha = ? AND (p.fecha IS NULL OR p.fecha != v.fecha) ORDER BY v.hora, v.id'),
    versionesConPieza: db.prepare('SELECT red, estado FROM pub_versiones WHERE pieza_id = ? AND (fecha IS NULL OR fecha = ?) ORDER BY id'),
  };

  const registrar = (tipo, txt, origen = 'dashboard') => q.insActividad.run(tipo, txt.slice(0, 300), origen);
  const tareasDb = createTareas({ db, registrar });
  const pipeline = createPipeline({ db });
  const etiquetaFase = (id) => pipeline.etiqueta(id);

  // ---------- Ideas, notas y piezas ----------
  function capturarIdea({ texto: t, origen = 'dashboard', formato = null, pilar = null, objetivo = null }) {
    // "idea: …" (como se escribe en Telegram o por voz) no forma parte del título
    const contenido = texto(typeof t === 'string' ? t.replace(/^\s*idea\s*:\s*/i, '') : t, 'texto', 8000);
    const titulo = tituloDe(contenido);
    const nota = vault.create('01-Ideas', titulo, frontmatter({ tipo: 'idea', creado: ahora(), origen, formato }) + `# ${titulo}\n\n${contenido}\n`);
    const pieza = crearPieza({ titulo, estado: 'idea', formato, pilar, objetivo, nota, origen, registrarActividad: false });
    registrar(origen === 'hermes' ? 'Hermes' : 'Idea', `Nueva idea${origen === 'hermes' ? ' vía Telegram' : ''}: ${titulo}`, origen);
    return { pieza, nota };
  }

  // Una idea con su referencia ya escrita (una publicación o un anuncio de la competencia): título y nota propios.
  // Si ya se guardó esa referencia (mismo enlace), se devuelve la que hay en vez de duplicarla.
  function guardarIdea({ titulo: t, contenido = '', origen = 'dashboard', formato = null, origen_ref = null }) {
    const titulo = texto(t, 'titulo', 110).replace(/[\n\r]+/g, ' ');
    const ya = origen_ref ? row(q.porOrigenRef, String(origen_ref)) : null;
    if (ya?.nota && vault.existe(ya.nota)) return { pieza: pieza(ya), nota: ya.nota, ya: true };
    const nota = vault.create('01-Ideas', titulo, frontmatter({ tipo: 'idea', creado: ahora(), origen, formato, referencia: origen_ref }) + `# ${titulo}\n\n${contenido}\n`);
    const p = crearPieza({ titulo, estado: 'idea', formato, nota, origen, origen_ref, registrarActividad: false });
    registrar('Idea', `Nueva idea: ${titulo}`, origen);
    return { pieza: p, nota };
  }

  // ---------- El guion de una pieza ----------
  // Es una nota de 02-Guiones: la de «Replicar» (su "nota") o la que se escribe desde la ficha (guion_nota).
  // En la ficha se edita el cuerpo; la cabecera (frontmatter y título) se conserva.
  const partirNota = (contenido) => {
    const m = /^(---\r?\n[\s\S]*?\r?\n---\r?\n)?\s*(# [^\n]*\n)?\n*/.exec(contenido);
    return { cabecera: (m[1] || '') + (m[2] ? `${m[2]}\n` : ''), cuerpo: contenido.slice(m[0].length) };
  };
  const rutaGuion = (p) => [p.guion_nota, /^02-Guiones\//.test(p.nota || '') ? p.nota : null].find((r) => r && vault.existe(r)) || null;
  function guionDePieza(id) {
    const p = leerPieza(id);
    const ruta = rutaGuion(p);
    const g = ruta ? vault.read(ruta) : null;
    // La idea o la referencia de la que sale (con su transcripción), para tenerla a mano al escribir
    const ref = p.nota && p.nota !== ruta && vault.existe(p.nota) ? vault.read(p.nota) : null;
    return {
      ruta, texto: g ? partirNota(g.contenido).cuerpo.trimEnd() : '', modificado: g?.modificado || null,
      referencia: ref ? { ruta: ref.path, texto: partirNota(ref.contenido).cuerpo.trimEnd() } : null,
    };
  }
  // Si la pieza aún no tiene guion, se le crea su nota en 02-Guiones
  function notaGuion(id) {
    const p = leerPieza(id);
    const ya = rutaGuion(p);
    if (ya) return ya;
    const titulo = `${p.formato || 'Guion'}: ${p.titulo}`.slice(0, 120);
    const ruta = vault.create('02-Guiones', titulo, frontmatter({ tipo: 'guion', creado: ahora(), pieza: p.id, formato: p.formato }) + `# ${titulo}\n\n`);
    q.setGuion.run(ruta, ruta, p.id);
    return ruta;
  }
  function guardarGuion(id, { texto: t = '', modificado } = {}) {
    if (typeof t !== 'string') throw new JarvisError('Falta el guion');
    const ruta = notaGuion(id);
    const { cabecera } = partirNota(vault.read(ruta).contenido);
    vault.guardar(ruta, `${cabecera}${t.trimEnd()}\n`, { modificado: modificado || undefined });
    return guionDePieza(id);
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
    let portada = null;
    try { portada = p.portada ? JSON.parse(p.portada) : null; } catch { /* sin portada */ }
    return { ...p, archivos: Array.isArray(archivos) ? archivos : [], portada: portada?.url ? portada : null };
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
    for (const k of ['titulo', 'estado', 'formato', 'plataformas', 'fecha', 'hora', 'nota', 'caption', 'video_url', 'carpeta', 'archivos', 'leadmagnet_url', 'pilar', 'objetivo', 'gancho', 'cta', 'origen_ref', 'categoria']) {
      if (!(k in c)) continue;
      const v = c[k];
      if (k === 'archivos') set.archivos = archivosValidos(v);
      else if (k === 'plataformas') set.plataformas = Array.isArray(v) ? v.join(', ') : v || null;
      else set[k] = typeof v === 'string' ? (k === 'caption' ? v : v.trim()) || null : v ?? null;
    }
    if ('en_pipeline' in c) set.en_pipeline = c.en_pipeline ? 1 : 0;
    if ('deposito' in c) set.deposito = c.deposito ? 1 : 0;
    // Portada (de un reel): una imagen de la biblioteca, o null para quitarla
    if ('portada' in c) {
      const a = c.portada;
      if (!a) set.portada = null;
      else {
        if (!/^image\//.test(String(a.mime || '')) || !a.url) throw new JarvisError('La portada tiene que ser una imagen');
        const [x] = JSON.parse(archivosValidos([a]));
        set.portada = x ? JSON.stringify(x) : null;
      }
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
    // Estrategia
    if (set.pilar) set.pilar = set.pilar.replace(/\s+/g, ' ').slice(0, 60);
    if (set.objetivo) {
      set.objetivo = set.objetivo.toLowerCase();
      if (!OBJETIVOS.includes(set.objetivo)) throw new JarvisError(`Objetivo no válido. Usa: ${OBJETIVOS.join(', ')}`);
    }
    if (set.gancho) set.gancho = set.gancho.slice(0, 300);
    if (set.cta) set.cta = set.cta.slice(0, 300);
    if (set.origen_ref) set.origen_ref = set.origen_ref.slice(0, 500);
    if (set.categoria) set.categoria = set.categoria.slice(0, 30);
    if ('padre_id' in c) {
      const id = c.padre_id ? Number(c.padre_id) : null;
      if (id && !row(q.getPieza, id)) throw new JarvisError('La pieza de la que sale no existe');
      set.padre_id = id;
    }
    return set;
  };
  // Los pilares son los que ya usan tus piezas (para sugerirlos al escribir)
  const pilares = () => rows(db.prepare("SELECT pilar, COUNT(*) AS n FROM piezas WHERE pilar IS NOT NULL AND pilar != '' GROUP BY pilar ORDER BY n DESC, pilar")).map((r) => ({ nombre: r.pilar, piezas: r.n }));

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
    if (set.padre_id) {
      // Ni ella misma ni una de las que salen de ella (no puede haber círculos)
      for (let p = set.padre_id, n = 0; p && n < 50; p = row(q.getPieza, p)?.padre_id, n++) {
        if (p === actual.id) throw new JarvisError('Una pieza no puede salir de sí misma ni de una que sale de ella');
      }
    }
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
    // Las que salían de ella pasan a salir de su padre (o de ninguna)
    db.prepare('UPDATE piezas SET padre_id = ? WHERE padre_id = ?').run(p.padre_id ?? null, p.id);
    return { ok: true, pieza: p };
  }

  // Copia de una pieza (p. ej. un carrusel ya publicado) para volver a publicarla otro día.
  // Comparte los archivos: no se borran del disco mientras alguna pieza los use.
  function duplicarPieza(id, origen = 'dashboard') {
    const p = leerPieza(id);
    const copia = crearPieza({
      titulo: p.titulo, estado: 'listo', formato: p.formato, plataformas: p.plataformas, caption: p.caption,
      video_url: p.video_url, carpeta: p.carpeta, nota: p.nota, archivos: p.archivos, portada: p.portada, fecha: null, hora: p.hora, origen, registrarActividad: false,
      leadmagnet: p.leadmagnet, leadmagnet_url: p.leadmagnet_url,
      pilar: p.pilar, objetivo: p.objetivo, gancho: p.gancho, cta: p.cta, padre_id: p.padre_id, origen_ref: p.origen_ref,
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
      semana: resumenSemana(miSemana()),
    };
  }

  // La semana en pocas palabras (para Hermes y el chat)
  function resumenSemana(m) {
    return {
      ritmo: m.progreso.map((x) => `${x.tipo}: ${x.publicadas} publicadas + ${x.programadas} programadas de ${x.objetivo}${x.faltan ? ` (faltan ${x.faltan})` : ''}`),
      diasCubiertos: m.colchon.dias ? `${m.colchon.dias} días de publicación cubiertos, hasta el ${m.colchon.hasta}` : 'Hoy no tiene nada programado',
      huecos: m.huecos,
      listasSinFecha: m.reserva,
      porProducir: m.producir.map((p) => `${p.titulo} [${p.etiqueta}] sale el ${p.fecha}${p.urgente ? ' (urgente)' : ''}`),
    };
  }

  // ---------- Tu ritmo: cuánto quieres publicar cada semana y qué días ----------
  // objetivos: { Reel: 4, Carrusel: 2, Story: 7 } (por tipo de pieza) · dias: días en que publicas (0 = domingo … 6 = sábado)
  const aj = ajustes(db);
  const RITMO_BASE = { objetivos: {}, dias: [1, 2, 3, 4, 5] };
  const ritmo = () => {
    const r = aj.leer('ritmo', null);
    return { objetivos: { ...(r?.objetivos || {}) }, dias: Array.isArray(r?.dias) && r.dias.length ? r.dias : RITMO_BASE.dias };
  };
  function guardarRitmo({ objetivos = {}, dias } = {}) {
    const o = {};
    for (const [k, v] of Object.entries(objetivos || {})) {
      const n = Math.round(Number(v));
      const tipo = String(k).trim().slice(0, 30);
      if (!tipo) continue;
      if (!Number.isFinite(n) || n < 0 || n > 50) throw new JarvisError(`El objetivo de ${tipo} debe ser un número de 0 a 50`);
      if (n > 0) o[tipo] = n;
    }
    const d = Array.isArray(dias) ? [...new Set(dias.map(Number))].filter((x) => Number.isInteger(x) && x >= 0 && x <= 6).sort() : ritmo().dias;
    if (!d.length) throw new JarvisError('Elige al menos un día de publicación');
    aj.guardar('ritmo', { objetivos: o, dias: d });
    return ritmo();
  }

  // Día en que salió una pieza publicada: el de Instagram si la publicó JARVIS; si no, su fecha prevista
  const diaPublicada = (p) => ((p.estado === 'publicado' || p.ig_estado === 'publicado') ? (p.ig_publicado_en ? hoy(new Date(p.ig_publicado_en)) : p.fecha) : null);
  const pendiente = (p) => p.estado !== 'publicado' && p.ig_estado !== 'publicado';
  const mismoTipo = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  const diaSemana = (f) => new Date(`${f}T12:00:00`).getDay();

  // Tu semana: qué sale cada día (y los huecos), cómo vas con tu ritmo, cuántos días tienes cubiertos y qué falta producir
  function miSemana({ fecha = hoy() } = {}) {
    const piezas = listarPiezas();
    const r = ritmo();
    const lunes = lunesDe(fecha), domingo = sumarDias(lunes, 6);
    const enDia = (f) => piezas.filter((p) => (diaPublicada(p) || (pendiente(p) ? p.fecha : null)) === f);
    const corta = (p) => ({ id: p.id, titulo: p.titulo, formato: p.formato, estado: p.estado, hora: p.hora || null, publicada: !pendiente(p) });

    const dias = Array.from({ length: 7 }, (_, i) => {
      const f = sumarDias(lunes, i);
      const lista = enDia(f).map(corta);
      const publicas = r.dias.includes(diaSemana(f));
      return { fecha: f, piezas: lista, publicas, hueco: publicas && f >= fecha && !lista.length, pasado: f < fecha };
    });

    // Ritmo de la semana por tipo: lo publicado y lo que ya tiene día
    const deLaSemana = piezas.filter((p) => { const d = diaPublicada(p) || (pendiente(p) ? p.fecha : null); return d && d >= lunes && d <= domingo; });
    const progreso = Object.entries(r.objetivos).map(([tipo, objetivo]) => {
      const delTipo = deLaSemana.filter((p) => mismoTipo(p.formato, tipo));
      const publicadas = delTipo.filter((p) => !pendiente(p)).length;
      return { tipo, objetivo, publicadas, programadas: delTipo.length - publicadas, faltan: Math.max(0, objetivo - delTipo.length) };
    });

    // Días cubiertos: días de publicación seguidos, desde hoy, que ya tienen algo
    let cubiertos = 0, hasta = null;
    for (let i = 0, f = fecha; i < 90; i++, f = sumarDias(f, 1)) {
      if (!r.dias.includes(diaSemana(f))) continue;
      if (!enDia(f).length) break;
      cubiertos++; hasta = f;
    }
    const huecos = [];
    for (let i = 0, f = fecha; i < 14; i++, f = sumarDias(f, 1)) if (r.dias.includes(diaSemana(f)) && !enDia(f).length) huecos.push(f);

    // Lo que tiene día en las próximas dos semanas y aún no está listo
    const listoOPublicado = new Set(['listo', 'publicado']);
    const producir = piezas
      .filter((p) => pendiente(p) && p.fecha && p.fecha >= fecha && p.fecha <= sumarDias(fecha, 13) && !listoOPublicado.has(p.estado))
      .sort((a, b) => a.fecha.localeCompare(b.fecha) || String(a.hora || '').localeCompare(String(b.hora || '')))
      .map((p) => {
        const dias = Math.round((new Date(`${p.fecha}T12:00:00`) - new Date(`${fecha}T12:00:00`)) / 86400000);
        return { ...corta(p), fecha: p.fecha, etiqueta: etiquetaFase(p.estado), dias, urgente: dias <= 2 };
      });

    return {
      desde: lunes, hasta: domingo, ritmo: r, dias, progreso,
      colchon: { dias: cubiertos, hasta },
      huecos,
      reserva: piezas.filter((p) => pendiente(p) && !p.fecha && p.estado === 'listo').length,
      producir,
    };
  }

  // KPIs de Inicio: lo que importa para publicar con constancia (todo real desde el primer día)
  function inicio({ fecha = hoy() } = {}) {
    const piezas = listarPiezas();
    const lunes = lunesDe(fecha);
    const publicadas = piezas.map(diaPublicada).filter(Boolean);
    const programadas = piezas.filter((p) => pendiente(p) && p.fecha);
    const enDias = (lista, desde, n) => Array.from({ length: n }, (_, i) => { const d = sumarDias(desde, i); return lista.filter((x) => x === d).length; });

    const estaSemana = publicadas.filter((d) => d >= lunes && d <= fecha).length;
    const semanaPasada = publicadas.filter((d) => d >= sumarDias(lunes, -7) && d <= sumarDias(fecha, -7)).length;
    const proximas = programadas.filter((p) => p.fecha >= fecha && p.fecha <= sumarDias(fecha, 6));
    const listas = piezas.filter((p) => pendiente(p) && !p.fecha && p.estado === 'listo');
    const ideas = piezas.filter((p) => p.estado === 'idea');
    const delta = (cur, prev) => (prev ? Math.round(((cur - prev) / prev) * 100) : null);

    const kpis = [
      { id: 'publicadas', label: 'Publicado esta semana', value: estaSemana, delta: delta(estaSemana, semanaPasada), ayuda: 'frente a la semana pasada', color: 'var(--green)', icon: 'checkCircle', series: enDias(publicadas, sumarDias(fecha, -11), 12), ir: 'contenido', vista: 'calendario' },
      { id: 'programadas', label: 'Programado · 7 días', value: proximas.length, ayuda: 'con día en el calendario', color: 'var(--accent-2)', icon: 'calendar', series: enDias(programadas.map((p) => p.fecha), fecha, 12), ir: 'contenido', vista: 'calendario' },
      { id: 'listas', label: 'Listo sin fecha', value: listas.length, ayuda: listas.length ? 'ponles día en el calendario' : 'nada esperando', color: 'var(--cyan)', icon: 'layers', ir: 'contenido', vista: 'biblioteca' },
      { id: 'ideas', label: 'Ideas en el banco', value: ideas.length, ayuda: 'por desarrollar', color: 'var(--blue)', icon: 'bulb', ir: 'contenido', vista: 'ideas' },
    ];
    return { kpis };
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
      // Para publicarla desde Inicio: copiar el caption y descargar los archivos
      caption: p.caption || '', archivos: pieza(p).archivos.map(({ url, nombre, mime }) => ({ url, nombre, mime })),
      estado: p.estado, etiqueta: etiquetaFase(p.estado),
      instagram: p.ig_estado === 'publicado' ? 'publicado' : p.ig_estado === 'error' ? 'error' : p.ig_estado === 'procesando' ? 'publicando' : p.publicar_ig ? 'programado' : null,
      error: p.ig_estado === 'error' ? p.ig_error : null,
      // Las otras redes donde sale ese mismo día (versiones de la ficha)
      redes: rows(q.versionesConPieza, p.id, fecha),
    }));
    const versiones = rows(q.versionesDelDia, fecha).map((v) => ({
      tipo: 'version', id: v.id, piezaId: v.pieza_id, titulo: v.titulo || v.pieza_titulo, red: v.red, hora: v.hora || null,
      texto: [v.titulo, v.texto, v.extra].filter(Boolean).join('\n\n'),
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
    capturarIdea, guardarIdea, guionDePieza, notaGuion, guardarGuion, crearNota, crearPieza, listarPiezas, leerPieza, actualizarPieza, borrarPieza, pilares, ritmo, guardarRitmo, miSemana,
    duplicarPieza, carpetas, crearCarpeta, renombrarCarpeta, borrarCarpeta, moverACarpeta, juntarEnCarrusel,
    crearTarea, actualizarTarea, marcarTarea, borrarTarea, listarTareas, tareas, resumenDelDia, inicio, agenda, registrar, editarNota, borrarNota, restaurarNota, actividadDe,
    vault, pipeline,
  };
}


