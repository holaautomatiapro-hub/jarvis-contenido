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
    assert.throws(() => jarvis.actualizarPieza(p.id, { estado: 'viral' }), /Estado no válido/);
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

  test('inicio calcula KPIs, foco y actividad reales', () => {
    const r = jarvis.inicio();
    assert.equal(r.vacio, false);
    const k = Object.fromEntries(r.kpis.map((x) => [x.id, x]));
    assert.equal(k.tareas.value, 2);
    assert.equal(k.ideas.value, 1); // solo cuentan las notas de 01-Ideas
    assert.ok(k.notas.value >= 5);
    assert.equal(k.tareas.series.length, 12);
    assert.equal(r.foco.reduce((a, f) => a + f.pct, 0) >= 99, true);
    assert.ok(r.actividad.some((a) => a.tag === 'Hermes'));
  });

  test('resumen del día', () => {
    const r = jarvis.resumenDelDia();
    assert.equal(r.fecha, hoy());
    assert.equal(r.tareas.total, 2);
    assert.equal(r.pipeline.idea, 1);
    assert.equal(r.pipeline.guion, 1);
  });
});
