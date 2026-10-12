import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createVault, ensureVault, nombreArchivo } from '../server/vault.js';
import { createJarvis, hoy } from '../server/jarvis.js';
import { getConfig } from '../server/config.js';

let dir, jarvis;
before(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-test-'));
  const cfg = getConfig({});
  ensureVault(path.join(dir, 'Vault'), cfg.templateDir, cfg.mcpScript);
  jarvis = createJarvis({ db: openDb(':memory:'), vault: createVault(path.join(dir, 'Vault')) });
});
after(() => rmSync(dir, { recursive: true, force: true }));

describe('vault', () => {
  test('se crea desde la plantilla con carpetas, CLAUDE.md y .mcp.json', () => {
    const v = path.join(dir, 'Vault');
    for (const f of ['CLAUDE.md', '_voz.md', '01-Ideas', '07-Diario', '.mcp.json']) assert.ok(existsSync(path.join(v, f)), f);
    const mcp = JSON.parse(readFileSync(path.join(v, '.mcp.json'), 'utf8'));
    assert.match(mcp.mcpServers.jarvis.args.at(-1), /jarvis-mcp\.js$/);
  });

  test('no deja salir del vault ni leer archivos que no son notas', () => {
    assert.throws(() => jarvis.vault.read('../secreto.md'), /fuera del vault/);
    assert.throws(() => jarvis.vault.read('..\\..\\x.md'), /fuera del vault/);
    assert.throws(() => jarvis.vault.read('.mcp.json'), /\.md/);
    assert.throws(() => jarvis.vault.read('.obsidian/x.md'), /no permitida/);
  });

  test('nombres de archivo válidos en Windows', () => {
    assert.equal(nombreArchivo('¿Qué es: JARVIS? <v2>'), '¿Qué es JARVIS v2');
    assert.equal(nombreArchivo('con'), 'Nota con');
    assert.equal(nombreArchivo('  fin.  '), 'fin');
  });

  test('no pisa notas con el mismo título', () => {
    const a = jarvis.crearNota({ titulo: 'Repetida' }).nota;
    const b = jarvis.crearNota({ titulo: 'Repetida' }).nota;
    assert.notEqual(a, b);
    assert.equal(b, '00-Inbox/Repetida 2.md');
  });

  test('busca sin distinguir tildes ni mayúsculas', () => {
    jarvis.crearNota({ titulo: 'Guion automatización', contenido: 'Cómo AUTOMATIZAR respuestas' });
    const r = jarvis.vault.search('automatizacion');
    assert.ok(r.some((n) => n.titulo === 'Guion automatización'));
    assert.ok(jarvis.vault.search('automatizar')[0].fragmento.includes('AUTOMATIZAR'));
    assert.ok(!jarvis.vault.search('Guion automatización')[0].fragmento.includes('tipo:'), 'sin frontmatter en el fragmento');
  });
});

describe('ideas y pipeline', () => {
  test('capturar una idea crea nota en 01-Ideas y tarjeta en Idea', () => {
    const { pieza, nota } = jarvis.capturarIdea({ texto: 'Reel: 3 errores al automatizar WhatsApp\ncon ejemplos reales', origen: 'hermes' });
    assert.equal(pieza.estado, 'idea');
    assert.equal(pieza.titulo, 'Reel: 3 errores al automatizar WhatsApp');
    assert.match(nota, /^01-Ideas\//);
    const md = jarvis.vault.read(nota).contenido;
    assert.match(md, /origen: hermes/);
    assert.match(md, /con ejemplos reales/);
  });

  test('mover pieza cambia de columna y valida el estado', () => {
    const p = jarvis.crearPieza({ titulo: 'Carrusel herramientas', formato: 'carrusel', plataformas: ['instagram', 'linkedin'] });
    assert.equal(p.plataformas, 'instagram, linkedin');
    const m = jarvis.actualizarPieza(p.id, { estado: 'guion' });
    assert.equal(m.estado, 'guion');
    assert.throws(() => jarvis.actualizarPieza(p.id, { estado: 'viral' }), /Fase no válida/);
    assert.throws(() => jarvis.actualizarPieza(9999, { estado: 'guion' }), /no existe/);
  });

  test('el campo obligatorio vacío da un error claro', () => {
    assert.throws(() => jarvis.capturarIdea({ texto: '   ' }), /Falta "texto"/);
  });
});

describe('tareas e inicio', () => {
  test('crear, completar y listar tareas de hoy', () => {
    const t = jarvis.crearTarea({ titulo: 'Grabar reel', categoria: 'contenido' });
    jarvis.crearTarea({ titulo: 'Facturas', categoria: 'administracion' });
    assert.equal(jarvis.marcarTarea(t.id, true).hecha, 1);
    const { tareas } = jarvis.tareas();
    assert.equal(tareas.length, 2);
    assert.equal(tareas.at(-1).titulo, 'Grabar reel'); // las hechas al final
    assert.throws(() => jarvis.crearTarea({ titulo: 'x', categoria: 'otra' }), /Categoría/);
    assert.throws(() => jarvis.crearTarea({ titulo: 'x', fecha: '10/10/2026' }), /AAAA-MM-DD/);
  });

  test('inicio: KPIs de contenido (publicado, programado, listo sin fecha e ideas)', () => {
    const fecha = hoy();
    const lista = jarvis.crearPieza({ titulo: 'Lista sin día', estado: 'listo' });
    const prog = jarvis.crearPieza({ titulo: 'Para mañana', estado: 'listo', fecha });
    const hecha = jarvis.crearPieza({ titulo: 'Ya salió', estado: 'publicado', fecha });
    const k = Object.fromEntries(jarvis.inicio({ fecha }).kpis.map((x) => [x.id, x]));
    assert.equal(k.publicadas.value, 1);
    assert.equal(k.programadas.value, 1, 'lo publicado no cuenta como programado');
    assert.equal(k.listas.value, 1);
    assert.equal(k.ideas.value, jarvis.listarPiezas({ estado: 'idea' }).length);
    assert.equal(k.publicadas.series.length, 12);
    for (const p of [lista, prog, hecha]) jarvis.borrarPieza(p.id);
  });

  test('estrategia de la pieza: pilar, objetivo, gancho y CTA, y los pilares en uso', () => {
    const p = jarvis.crearPieza({ titulo: 'Reel de setter', formato: 'Reel', pilar: '  Automatización ', objetivo: 'Atraer', gancho: 'Nadie te cuenta esto', cta: 'Comenta SETTER' });
    assert.equal(p.pilar, 'Automatización');
    assert.equal(p.objetivo, 'atraer');
    assert.equal(p.gancho, 'Nadie te cuenta esto');
    assert.throws(() => jarvis.actualizarPieza(p.id, { objetivo: 'viral' }), /Objetivo no válido/);
    const otra = jarvis.crearPieza({ titulo: 'Otro', pilar: 'Automatización' });
    assert.deepEqual(jarvis.pilares().find((x) => x.nombre === 'Automatización'), { nombre: 'Automatización', piezas: 2 });
    assert.equal(jarvis.actualizarPieza(p.id, { objetivo: '' }).objetivo, null, 'se puede quitar');
    jarvis.borrarPieza(otra.id);
    jarvis.borrarPieza(p.id);
  });

  test('pieza madre: lo que sale de otra pieza, sin círculos, y al borrar sube al abuelo', () => {
    const video = jarvis.crearPieza({ titulo: 'Directo de 1 hora', formato: 'Reel' });
    const clip = jarvis.crearPieza({ titulo: 'Clip 1', padre_id: video.id });
    const carrusel = jarvis.crearPieza({ titulo: 'Carrusel del clip', padre_id: clip.id });
    assert.equal(clip.padre_id, video.id);
    assert.throws(() => jarvis.actualizarPieza(video.id, { padre_id: carrusel.id }), /no puede salir de sí misma/);
    assert.throws(() => jarvis.crearPieza({ titulo: 'x', padre_id: 999999 }), /no existe/);
    assert.equal(jarvis.duplicarPieza(clip.id).padre_id, video.id, 'la copia para republicar sale de lo mismo');
    jarvis.borrarPieza(clip.id);
    assert.equal(jarvis.leerPieza(carrusel.id).padre_id, video.id);
    for (const x of jarvis.listarPiezas().filter((x) => x.padre_id === video.id)) jarvis.borrarPieza(x.id);
    jarvis.borrarPieza(video.id);
  });

  test('mi semana: huecos, días cubiertos, ritmo, reserva y lo que falta producir', () => {
    const antes = new Set(jarvis.listarPiezas().map((p) => p.id));
    const lunes = '2030-01-07'; // un lunes lejos de las fechas de los demás tests
    const dia = (n) => { const d = new Date(`${lunes}T12:00:00`); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv-SE'); };
    assert.throws(() => jarvis.guardarRitmo({ dias: [] }), /al menos un día/);
    assert.throws(() => jarvis.guardarRitmo({ objetivos: { Reel: 99 } }), /de 0 a 50/);
    assert.deepEqual(jarvis.guardarRitmo({ objetivos: { Reel: 3, Carrusel: 1, Story: 0 }, dias: [1, 2, 3, 4, 5] }), { objetivos: { Reel: 3, Carrusel: 1 }, dias: [1, 2, 3, 4, 5] });

    jarvis.crearPieza({ titulo: 'Reel lunes', formato: 'reel', estado: 'publicado', fecha: dia(0) });
    jarvis.crearPieza({ titulo: 'Reel martes', formato: 'Reel', estado: 'listo', fecha: dia(1) });
    const grabar = jarvis.crearPieza({ titulo: 'Carrusel miércoles', formato: 'Carrusel', estado: 'grabar', fecha: dia(2) });
    jarvis.crearPieza({ titulo: 'Reel sábado', formato: 'Reel', estado: 'listo', fecha: dia(5) });
    const reserva = jarvis.listarPiezas().filter((p) => p.estado === 'listo' && !p.fecha && p.estado !== 'publicado').length;
    jarvis.crearPieza({ titulo: 'De reserva', formato: 'Reel', estado: 'listo' });

    const m = jarvis.miSemana({ fecha: dia(1) }); // martes
    assert.equal(m.desde, lunes);
    assert.deepEqual(m.dias.map((d) => d.piezas.length), [1, 1, 1, 0, 0, 1, 0]);
    assert.deepEqual(m.dias.filter((d) => d.hueco).map((d) => d.fecha), [dia(3), dia(4)], 'jueves y viernes; el sábado no publica y el lunes ya pasó');
    assert.deepEqual(m.colchon, { dias: 2, hasta: dia(2) }, 'martes y miércoles cubiertos; el jueves es hueco');
    assert.equal(m.huecos[0], dia(3));
    const reel = m.progreso.find((x) => x.tipo === 'Reel');
    assert.deepEqual([reel.publicadas, reel.programadas, reel.faltan], [1, 2, 0]);
    assert.equal(m.progreso.find((x) => x.tipo === 'Carrusel').faltan, 0);
    assert.equal(m.reserva, reserva + 1);
    assert.deepEqual(m.producir.map((p) => [p.id, p.dias, p.urgente]), [[grabar.id, 1, true]]);
    assert.match(jarvis.resumenDelDia().semana.diasCubiertos, /días de publicación cubiertos|nada programado/);
    for (const p of jarvis.listarPiezas()) if (!antes.has(p.id)) jarvis.borrarPieza(p.id);
    jarvis.guardarRitmo({ objetivos: {}, dias: [1, 2, 3, 4, 5] });
  });

  test('resumen del día', () => {
    const r = jarvis.resumenDelDia();
    assert.equal(r.fecha, hoy());
    assert.equal(r.tareas.total, 2);
    assert.equal(r.pipeline.idea, 1);
    assert.equal(r.pipeline.guion, 1);
  });
});
