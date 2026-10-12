import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { openDb } from '../server/db.js';
import { createVault, ensureVault } from '../server/vault.js';
import { createJarvis, hoy } from '../server/jarvis.js';
import { rangoPlazo, lunesDe, sumarDias } from '../server/tareas.js';
import { createArchivos, nombreSeguro } from '../server/archivos.js';
import { getConfig } from '../server/config.js';
import { createApp } from '../server/index.js';

let dir, jarvis;
const nuevoJarvis = (db = openDb(':memory:')) => createJarvis({ db, vault: createVault(path.join(dir, 'V')) });
before(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-tc-'));
  const cfg = getConfig({});
  ensureVault(path.join(dir, 'V'), cfg.templateDir, cfg.mcpScript);
  jarvis = nuevoJarvis();
});
after(() => rmSync(dir, { recursive: true, force: true }));

describe('fecha límite', () => {
  test('día, semana (lunes a domingo) y mes', () => {
    assert.deepEqual(rangoPlazo('dia', '2026-10-14'), { desde: '2026-10-14', hasta: '2026-10-14' });
    assert.deepEqual(rangoPlazo('semana', '2026-10-14'), { desde: '2026-10-12', hasta: '2026-10-18' });
    assert.deepEqual(rangoPlazo('semana', '2026-W42'), { desde: '2026-10-12', hasta: '2026-10-18' });
    assert.deepEqual(rangoPlazo('semana', '2026-W01'), { desde: '2025-12-29', hasta: '2026-01-04' });
    assert.deepEqual(rangoPlazo('mes', '2026-02'), { desde: '2026-02-01', hasta: '2026-02-28' });
    assert.deepEqual(rangoPlazo('mes', '2028-02-10'), { desde: '2028-02-01', hasta: '2028-02-29' });
    assert.deepEqual(rangoPlazo(null), { desde: null, hasta: null });
    // Semana que cruza el cambio de hora de octubre
    assert.deepEqual(rangoPlazo('semana', '2026-10-25'), { desde: '2026-10-19', hasta: '2026-10-25' });
    assert.throws(() => rangoPlazo('dia', '2026-02-30'), /AAAA-MM-DD/);
    assert.throws(() => rangoPlazo('mes', '2026-13'), /AAAA-MM/);
    assert.throws(() => rangoPlazo('trimestre', '2026-10'), /no válido/);
  });
});

describe('tareas', () => {
  test('crear con prioridad, estado y plazo; ver, modificar y eliminar', () => {
    const t = jarvis.crearTarea({ titulo: 'Guion del reel', descripcion: 'Tres errores', prioridad: 'alta', plazo_tipo: 'semana', plazo: hoy() });
    assert.equal(t.estado, 'sin_empezar');
    assert.equal(t.prioridad, 'alta');
    assert.equal(t.plazo_desde, lunesDe(hoy()));
    assert.equal(t.plazo_hasta, sumarDias(lunesDe(hoy()), 6));
    const u = jarvis.actualizarTarea(t.id, { estado: 'en_proceso', titulo: 'Guion del reel v2', plazo_tipo: 'mes', plazo: hoy().slice(0, 7) });
    assert.equal(u.estado, 'en_proceso');
    assert.equal(u.titulo, 'Guion del reel v2');
    assert.equal(u.plazo_desde, `${hoy().slice(0, 7)}-01`);
    const f = jarvis.actualizarTarea(t.id, { estado: 'terminada' });
    assert.equal(f.hecha, 1);
    assert.ok(f.completada);
    assert.equal(jarvis.marcarTarea(t.id, false).estado, 'sin_empezar');
    assert.throws(() => jarvis.actualizarTarea(t.id, { prioridad: 'urgente' }), /Prioridad no válida/);
    assert.deepEqual(jarvis.borrarTarea(t.id), { ok: true });
    assert.throws(() => jarvis.actualizarTarea(t.id, { estado: 'terminada' }), /no existe/);
  });

  test('sin fecha límite, y la forma antigua (fecha) sigue siendo un día', () => {
    const s = jarvis.crearTarea({ titulo: 'Algún día', plazo_tipo: null });
    assert.equal(s.plazo_tipo, null);
    assert.equal(s.plazo_hasta, null);
    const a = jarvis.crearTarea({ titulo: 'Para mañana', fecha: sumarDias(hoy(), 1) });
    assert.equal(a.plazo_tipo, 'dia');
    assert.equal(a.fecha, sumarDias(hoy(), 1));
    jarvis.borrarTarea(s.id); jarvis.borrarTarea(a.id);
  });

  test('filtros por estado, prioridad, fechas y atrasadas', () => {
    const ayer = sumarDias(hoy(), -1);
    const ids = [
      jarvis.crearTarea({ titulo: 'Atrasada', fecha: ayer, prioridad: 'alta' }).id,
      jarvis.crearTarea({ titulo: 'Hoy en proceso', estado: 'en_proceso' }).id,
      jarvis.crearTarea({ titulo: 'Mes que viene', plazo_tipo: 'mes', plazo: rangoPlazo('mes', sumarDias(rangoPlazo('mes', hoy()).hasta, 1)).desde, prioridad: 'baja' }).id,
      jarvis.crearTarea({ titulo: 'Terminada ayer', fecha: ayer, estado: 'terminada' }).id,
      jarvis.crearTarea({ titulo: 'Sin fecha', plazo_tipo: null }).id,
    ];
    const titulos = (f) => jarvis.listarTareas(f).tareas.map((t) => t.titulo);
    assert.deepEqual(titulos({ atrasadas: true }), ['Atrasada']);
    assert.deepEqual(titulos({ estado: 'en_proceso' }), ['Hoy en proceso']);
    assert.deepEqual(titulos({ prioridad: ['alta', 'baja'] }), ['Atrasada', 'Mes que viene']);
    assert.deepEqual(titulos({ desde: hoy(), hasta: hoy() }), ['Hoy en proceso']);
    assert.deepEqual(titulos({ sinFecha: true }), ['Sin fecha']);
    assert.deepEqual(titulos({ texto: 'MES' }), ['Mes que viene']);
    // Orden: en proceso, sin empezar (alta primero), terminadas al final
    assert.equal(titulos({})[0], 'Hoy en proceso');
    assert.equal(titulos({}).at(-1), 'Terminada ayer');
    const { resumen } = jarvis.listarTareas();
    assert.equal(resumen.atrasadas, 1);
    assert.equal(resumen.porEstado.terminada, 1);
    // El plan de hoy: lo de hoy y lo atrasado
    const plan = jarvis.tareas();
    assert.deepEqual(plan.tareas.map((t) => t.titulo), ['Hoy en proceso']);
    assert.deepEqual(plan.atrasadas.map((t) => t.titulo), ['Atrasada']);
    for (const id of ids) jarvis.borrarTarea(id);
  });

  test('una base de datos antigua se migra sin perder tareas', () => {
    const file = path.join(dir, 'antigua.db');
    const vieja = new DatabaseSync(file);
    vieja.exec(`CREATE TABLE tareas (id INTEGER PRIMARY KEY, titulo TEXT NOT NULL, hecha INTEGER NOT NULL DEFAULT 0, fecha TEXT NOT NULL, categoria TEXT NOT NULL DEFAULT 'contenido', origen TEXT NOT NULL DEFAULT 'dashboard', creado TEXT NOT NULL DEFAULT (datetime('now','localtime')), completada TEXT);
      INSERT INTO tareas (titulo, hecha, fecha) VALUES ('Hecha', 1, '2026-01-05'), ('Pendiente', 0, '2026-01-06');`);
    vieja.close();
    const j = nuevoJarvis(openDb(file));
    const { tareas } = j.listarTareas();
    const por = Object.fromEntries(tareas.map((t) => [t.titulo, t]));
    assert.equal(por.Hecha.estado, 'terminada');
    assert.equal(por.Pendiente.estado, 'sin_empezar');
    assert.equal(por.Pendiente.plazo_tipo, 'dia');
    assert.equal(por.Pendiente.plazo_hasta, '2026-01-06');
    assert.equal(por.Pendiente.atrasada, true);
    // Abrirla otra vez no vuelve a migrar (no pisa cambios)
    j.actualizarTarea(por.Hecha.id, { estado: 'en_proceso' });
    assert.equal(nuevoJarvis(openDb(file)).listarTareas({ estado: 'en_proceso' }).tareas.length, 1);
  });
});

describe('contenido', () => {
  test('piezas con hora, caption y archivos; sin fecha = biblioteca', () => {
    const p = jarvis.crearPieza({ titulo: 'Reel errores', formato: 'Reel', fecha: '2026-10-20', hora: '18:30', caption: 'Hola', archivos: [{ path: '2026-10/x', url: '/api/contenido/archivos/2026-10/x', nombre: 'x.mp4', mime: 'video/mp4', tamano: 10 }] });
    assert.equal(p.hora, '18:30');
    assert.equal(p.archivos[0].nombre, 'x.mp4');
    const sinFecha = jarvis.actualizarPieza(p.id, { fecha: '' });
    assert.equal(sinFecha.fecha, null);
    assert.throws(() => jarvis.actualizarPieza(p.id, { hora: '7pm' }), /HH:MM/);
    assert.throws(() => jarvis.actualizarPieza(p.id, { archivos: 'x' }), /lista/);
    jarvis.borrarPieza(p.id);
  });

  test('carpetas: crear, renombrar, mover y borrar sin borrar piezas', () => {
    const a = jarvis.crearPieza({ titulo: 'Foto 1' });
    const b = jarvis.crearPieza({ titulo: 'Foto 2' });
    jarvis.crearCarpeta('Octubre');
    assert.throws(() => jarvis.crearCarpeta('octubre'), /Ya hay una carpeta/);
    assert.throws(() => jarvis.crearCarpeta('  '), /Ponle nombre/);
    jarvis.moverACarpeta([a.id, b.id], 'Octubre');
    assert.deepEqual(jarvis.carpetas(), [{ nombre: 'Octubre', padre: null, etiqueta: 'Octubre', nivel: 0, piezas: 2, total: 2, subcarpetas: 0 }]);
    jarvis.renombrarCarpeta('Octubre', 'Otoño');
    assert.equal(jarvis.listarPiezas().find((p) => p.id === a.id).carpeta, 'Otoño');
    assert.equal(jarvis.borrarCarpeta('Otoño').sueltas, 2);
    assert.deepEqual(jarvis.carpetas(), []);
    assert.equal(jarvis.listarPiezas().find((p) => p.id === b.id).carpeta, null);
    jarvis.borrarPieza(a.id); jarvis.borrarPieza(b.id);
  });

  test('subcarpetas: crear dentro, contar, renombrar y mover con lo de dentro, borrar sube las piezas', () => {
    const a = jarvis.crearPieza({ titulo: 'Story 1' });
    const b = jarvis.crearPieza({ titulo: 'Reel 1' });
    const c = jarvis.crearPieza({ titulo: 'Suelta en Clientes' });
    jarvis.crearCarpeta('Clientes');
    assert.equal(jarvis.crearCarpeta('Andrea', 'Clientes').nombre, 'Clientes/Andrea');
    assert.equal(jarvis.crearCarpeta(' Stories ', 'Clientes / Andrea').nombre, 'Clientes/Andrea/Stories');
    assert.throws(() => jarvis.crearCarpeta('andrea', 'Clientes'), /Ya hay una carpeta/);
    assert.throws(() => jarvis.crearCarpeta('  ', 'Clientes'), /Ponle nombre/);
    assert.throws(() => jarvis.crearCarpeta('a/b/c/d/e/f/g'), /6 niveles/);
    // Guardar solo la de dentro crea también las de arriba
    jarvis.crearCarpeta('Lanzamientos/Octubre');
    jarvis.moverACarpeta([a.id], 'Clientes/Andrea/Stories');
    jarvis.moverACarpeta([b.id], 'Clientes/Andrea');
    jarvis.moverACarpeta([c.id], 'Clientes');
    const l = jarvis.carpetas();
    assert.deepEqual(l.map((x) => x.nombre), ['Clientes', 'Clientes/Andrea', 'Clientes/Andrea/Stories', 'Lanzamientos', 'Lanzamientos/Octubre']);
    const cl = l.find((x) => x.nombre === 'Clientes');
    assert.deepEqual([cl.piezas, cl.total, cl.subcarpetas], [1, 3, 1]);
    assert.deepEqual(l.find((x) => x.nombre === 'Clientes/Andrea/Stories'), { nombre: 'Clientes/Andrea/Stories', padre: 'Clientes/Andrea', etiqueta: 'Stories', nivel: 2, piezas: 1, total: 1, subcarpetas: 0 });

    // Renombrar se lleva las subcarpetas y sus piezas; no se puede meter dentro de sí misma
    jarvis.renombrarCarpeta('Clientes/Andrea', 'Clientes/Andrea Oliver');
    assert.equal(jarvis.listarPiezas().find((p) => p.id === a.id).carpeta, 'Clientes/Andrea Oliver/Stories');
    assert.ok(jarvis.carpetas().some((x) => x.nombre === 'Clientes/Andrea Oliver/Stories'));
    assert.ok(!jarvis.carpetas().some((x) => x.nombre.startsWith('Clientes/Andrea/')));
    assert.throws(() => jarvis.renombrarCarpeta('Clientes', 'Clientes/Andrea Oliver/Otra'), /dentro de sí misma/);
    assert.throws(() => jarvis.renombrarCarpeta('Lanzamientos', 'clientes'), /Ya hay una carpeta/);
    // Mover una carpeta dentro de otra
    jarvis.renombrarCarpeta('Lanzamientos', 'Clientes/Lanzamientos');
    assert.ok(jarvis.carpetas().some((x) => x.nombre === 'Clientes/Lanzamientos/Octubre'));
    assert.ok(!jarvis.carpetas().some((x) => x.nombre === 'Lanzamientos'));

    // Borrar: las piezas suben a la de arriba
    const r = jarvis.borrarCarpeta('Clientes/Andrea Oliver');
    assert.deepEqual([r.sueltas, r.destino], [2, 'Clientes']);
    assert.equal(jarvis.listarPiezas().find((p) => p.id === a.id).carpeta, 'Clientes');
    assert.equal(jarvis.carpetas().find((x) => x.nombre === 'Clientes').piezas, 3);
    jarvis.borrarCarpeta('Clientes');
    assert.deepEqual(jarvis.carpetas(), []);
    assert.equal(jarvis.listarPiezas().find((p) => p.id === b.id).carpeta, null);
    for (const p of [a, b, c]) jarvis.borrarPieza(p.id);
  });

  test('juntar en un carrusel en el orden marcado', () => {
    const arch = (n) => [{ path: `2026-10/${n}`, url: `/u/${n}`, nombre: n, mime: 'image/jpeg', tamano: 1 }];
    const a = jarvis.crearPieza({ titulo: 'Primera', archivos: arch('a.jpg') });
    const b = jarvis.crearPieza({ titulo: 'Segunda', caption: 'El caption', archivos: arch('b.jpg') });
    const c = jarvis.juntarEnCarrusel([b.id, a.id]);
    assert.equal(c.titulo, 'Segunda');
    assert.equal(c.formato, 'Carrusel');
    assert.equal(c.caption, 'El caption');
    assert.deepEqual(c.archivos.map((x) => x.nombre), ['b.jpg', 'a.jpg']);
    assert.ok(!jarvis.listarPiezas().some((p) => p.id === a.id || p.id === b.id));
    assert.throws(() => jarvis.juntarEnCarrusel([c.id]), /al menos dos/);
    jarvis.borrarPieza(c.id);
  });

  test('nombres de archivo seguros', () => {
    assert.equal(nombreSeguro('Mi reel final (1).MP4'), 'Mi_reel_final_1.mp4');
    assert.doesNotMatch(nombreSeguro('../../etc/passwd'), /[/\\]|\.\./);
    assert.equal(nombreSeguro('Canción ñu.jpg'), 'Cancion_nu.jpg');
  });
});

describe('API de tareas y contenido', () => {
  let server, base, archivos;
  before(async () => {
    archivos = createArchivos({ dir: path.join(dir, 'contenido') });
    server = http.createServer();
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
    const port = server.address().port;
    server.on('request', createApp({ jarvis: nuevoJarvis(), archivos, port, status: async () => [] }));
    base = `http://127.0.0.1:${port}`;
  });
  after(() => server.close());
  const api = (p, body, method = body ? 'POST' : 'GET') => fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, data: await r.json() }));

  test('tareas: crear, filtrar, editar y borrar', async () => {
    const { data: t } = await api('/api/tareas', { titulo: 'Montar vídeo', prioridad: 'alta', plazo_tipo: 'semana', plazo: hoy() });
    assert.equal(t.plazo_tipo, 'semana');
    const { data: l } = await api('/api/tareas/lista?prioridad=alta&estado=sin_empezar');
    assert.deepEqual(l.tareas.map((x) => x.id), [t.id]);
    const { data: u } = await api(`/api/tareas/${t.id}`, { estado: 'en_proceso', descripcion: 'Con subtítulos' }, 'PATCH');
    assert.equal(u.estado, 'en_proceso');
    assert.equal(u.descripcion, 'Con subtítulos');
    assert.equal((await api('/api/tareas/lista?estado=urgente')).status, 400);
    assert.equal((await api(`/api/tareas/${t.id}`, null, 'DELETE')).status, 200);
  });

  test('archivos: subir, servir, usar en una pieza y borrar con ella', async () => {
    const r = await fetch(`${base}/api/contenido/archivos?nombre=${encodeURIComponent('mi foto.jpg')}&mime=image/jpeg`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: Buffer.from('jpegfalso') });
    const a = await r.json();
    assert.equal(r.status, 200, JSON.stringify(a));
    assert.equal(a.tamano, 9);
    assert.match(a.url, /^\/api\/contenido\/archivos\/\d{4}-\d{2}\/\d{13}-[a-f0-9]{6}_mi_foto\.jpg$/);
    const g = await fetch(base + a.url);
    assert.equal(g.headers.get('content-type'), 'image/jpeg');
    assert.equal(await g.text(), 'jpegfalso');
    assert.equal((await fetch(`${base}/api/contenido/archivos/2026-10/..%2F..%2Fsecreto`)).status, 404);
    const malo = await fetch(`${base}/api/contenido/archivos?nombre=script.exe`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: 'x' });
    assert.equal(malo.status, 400);

    const { data: p } = await api('/api/piezas', { titulo: 'Con foto', archivos: [a] });
    // Mientras una pieza lo usa, la limpieza del editor no lo borra
    await api(a.url, null, 'DELETE');
    assert.ok(archivos.existe(a.path));
    await api(`/api/piezas/${p.id}`, null, 'DELETE');
    assert.ok(!archivos.existe(a.path), 'al borrar la pieza se borra su archivo');
    const { data: c } = await api('/api/contenido');
    assert.equal(c.archivos, true);
  });

  test('desde otra web no se puede subir nada (CSRF)', async () => {
    const r = await fetch(`${base}/api/contenido/archivos?nombre=a.jpg`, { method: 'POST', headers: { origin: 'https://malo.example', 'content-type': 'application/octet-stream' }, body: 'x' });
    assert.equal(r.status, 403);
    assert.ok(!existsSync(path.join(dir, 'contenido', 'nada')));
  });
});
