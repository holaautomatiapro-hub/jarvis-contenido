import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { openDb } from '../server/db.js';
import { createVault } from '../server/vault.js';
import { createJarvis } from '../server/jarvis.js';
import { createEstrategia, lunesDe } from '../server/estrategia.js';
import { createApp } from '../server/index.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from '../mcp/jarvis-mcp.js';

const nuevo = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-est-'));
  const db = openDb(':memory:');
  const jarvis = createJarvis({ db, vault: createVault(path.join(dir, 'V')) });
  return { dir, db, jarvis, estrategia: createEstrategia({ db, jarvis, hoy: () => '2026-10-18' }), limpiar: () => rmSync(dir, { recursive: true, force: true }) };
};

describe('estrategia de contenido', () => {
  test('sin marcar, cada semana es la semana tipo (atraer); el objetivo decide la estructura', () => {
    const { estrategia, limpiar } = nuevo();
    try {
      assert.equal(lunesDe('2026-10-18'), '2026-10-12');
      const anio = estrategia.anio(2026);
      assert.equal(anio[0].lunes, '2025-12-29', 'la semana del 1 de enero');
      assert.equal(anio.at(-1).lunes, '2026-12-28');
      assert.ok(anio.every((s) => s.tipo === 'atraer' && s.porDefecto));
      assert.deepEqual(anio[0].filas.post, [[{ c: 'Viral' }], [{ c: 'LM' }], [{ c: 'Viral' }], [{ c: 'Educar' }], [{ c: 'Viral' }], [{ c: 'Viral' }], [{ c: 'Testimonio' }]]);

      // Como el calendario de marketing: educación, anuncio de la oferta y venta
      estrategia.guardarSemana('2026-01-07', { objetivo: 'educacion', tactica: 'Tráfico frío + contenido orgánico' });
      estrategia.guardarSemana('2026-01-14', { objetivo: 'anuncio', detalle: 'Propósito de Año Nuevo', tactica: 'Retargeting + contenido orgánico', campana: 'Estrategia de Año Nuevo' });
      const venta = estrategia.guardarSemana('2026-01-22', { objetivo: 'venta' });
      assert.equal(venta.lunes, '2026-01-19');
      assert.equal(venta.tipo, 'vender');
      assert.equal(estrategia.semana('2026-01-12').tipo, 'educar');
      assert.equal(estrategia.semana('2026-01-12').detalle, 'Propósito de Año Nuevo');
      // La estructura se puede elegir aparte del objetivo
      assert.equal(estrategia.guardarSemana('2026-01-26', { objetivo: 'valor', tipo: 'educar' }).tipo, 'educar');

      const dias = estrategia.plan({ desde: '2026-01-19', dias: 7 });
      assert.deepEqual(dias.map((d) => d.botones.post.map((x) => x.c)), [['Educar'], ['Educar'], ['Educar'], ['Testimonio'], ['Educar'], ['Testimonio'], ['Testimonio']]);
      assert.equal(dias[1].post, 'Educar (FAQs (racional))');
      assert.equal(dias[6].stories, 'Educar (cierre de la estrategia (urgencia))');
      assert.equal(dias[3].directo, 'Q&A');
      assert.equal(dias[0].objetivo, 'Venta');
      assert.equal(estrategia.borrarSemana('2026-01-20').porDefecto, true);
      assert.throws(() => estrategia.guardarSemana('ayer', {}), /Fecha/);
    } finally { limpiar(); }
  });

  test('una semana puede tener su propia tabla y las estructuras se cambian y se restauran', () => {
    const { estrategia, limpiar } = nuevo();
    try {
      const filas = estrategia.estructuras().educar.filas;
      const propia = { ...filas, post: filas.post.map((x, i) => (i === 0 ? [{ c: 'Educar', n: 'Por qué no te contestan los leads' }, { c: 'LM' }] : x)) };
      const s = estrategia.guardarSemana('2026-02-16', { tipo: 'educar', celdas: propia });
      assert.equal(s.propia, true);
      assert.equal(estrategia.plan({ desde: '2026-02-16', dias: 1 })[0].post, 'Educar (Por qué no te contestan los leads) + LM');
      // Las tablas antiguas (un texto por hueco) se pasan a botones
      const vieja = estrategia.guardarSemana('2026-02-23', { tipo: 'atraer', celdas: { post: ['Atraer', 'LM'], stories: ['Testimonio con CTA'], directo: [] } });
      assert.deepEqual(vieja.filas.post.slice(0, 3), [[{ c: 'Viral', n: 'Atraer' }], [{ c: 'LM' }], []]);
      assert.deepEqual(vieja.filas.stories[0], [{ c: 'Testimonio', n: 'Testimonio con CTA' }]);
      assert.equal(estrategia.guardarSemana('2026-02-16', { celdas: null }).propia, false);

      const e = estrategia.guardarEstructura('atraer', { filas: { ...estrategia.estructuras().atraer.filas, directo: [[], [], [{ c: 'Valor' }], [], [], [], [{ c: 'Q&A' }]] }, tipos: [{ nombre: 'Atraer', descripcion: 'Valor para nivel 1-2' }] });
      assert.equal(e.atraer.cambiada, true);
      assert.deepEqual(e.atraer.filas.directo[6], [{ c: 'Q&A' }]);
      assert.equal(estrategia.plan({ desde: '2026-03-08', dias: 1 })[0].directo, 'Q&A', 'las semanas sin tabla propia usan la estructura');
      assert.equal(estrategia.restaurarEstructura('atraer').atraer.cambiada, false);
      assert.throws(() => estrategia.guardarEstructura('otra', {}), /no existe/);
      // Los botones de cada fila se añaden y se quitan
      assert.deepEqual(estrategia.categorias().post, ['LM', 'Viral', 'Testimonio', 'Educar', 'Conexión']);
      assert.deepEqual(estrategia.categorias().stories, ['Educar', 'LM', 'Testimonio', 'Q&A', 'Comunidad', 'Personal']);
      assert.deepEqual(estrategia.guardarCategorias({ post: ['LM', 'Viral', 'Humor', 'Viral'] }).post, ['LM', 'Viral', 'Humor']);
      assert.throws(() => estrategia.guardarCategorias({ stories: [] }), /al menos/);
      assert.equal(estrategia.guardarCategorias({ post: null }).post.length, 5);
    } finally { limpiar(); }
  });

  test('pasar al calendario: un hueco por botón, en su día, desde hoy y sin repetir', () => {
    const { estrategia, jarvis, limpiar } = nuevo();
    try {
      estrategia.guardarSemana('2026-11-16', { objetivo: 'venta' });
      const r = estrategia.crearPiezas('2026-11-16', [{ dia: 0, fila: 'post' }, { dia: 0, fila: 'stories' }, { dia: 0, fila: 'directo' }, { dia: 1, fila: 'directo' }]);
      assert.equal(r.creadas, 3, 'el lunes no hay directo');
      const p = jarvis.listarPiezas().find((x) => x.fecha === '2026-11-17');
      assert.equal(p.titulo, 'Directo · Testimonio · con cliente');
      assert.equal(p.categoria, 'Testimonio');
      assert.equal(p.objetivo, 'convertir');
      assert.equal(jarvis.listarPiezas().find((x) => x.titulo.startsWith('Stories')).formato, 'Story');
      // Toda la semana: el resto (lo ya pasado no se repite)
      const toda = estrategia.crearPiezas('2026-11-16');
      assert.equal(toda.creadas, 19 - 3, '7 posts + 7 stories + 5 directos = 19 botones');
      assert.equal(estrategia.crearPiezas('2026-11-16').creadas, 0);
      // Los días que ya han pasado no se pasan (hoy es el 18 de octubre)
      assert.equal(estrategia.crearPiezas('2026-10-12').creadas, 2, 'solo el domingo: su post y su story');
      // Un mes entero
      const mes = estrategia.pasarMes(2026, 12);
      assert.equal(mes.semanas, 5);
      assert.ok(mes.creadas > 50);
      assert.throws(() => estrategia.pasarMes(2026, 13), /Mes/);
      const prompt = estrategia.promptSemana('2026-11-16', { indicaciones: 'Oferta: programa 1:1' });
      assert.match(prompt, /Semana de venta/);
      assert.match(prompt, /Lunes 2026-11-16: Post: Educar \(info de la oferta\)/);
      assert.match(prompt, /huecos pasados al calendario/);
      assert.match(prompt, /Oferta: programa 1:1/);
    } finally { limpiar(); }
  });

  test('API: el año, una semana con lo que ya hay en Contenido, y JARVIS planificándola', async () => {
    const { estrategia, jarvis, limpiar } = nuevo();
    const server = http.createServer();
    try {
      jarvis.crearPieza({ titulo: 'Reel del lunes', fecha: '2026-10-12' });
      const preguntas = [];
      let ocupado = false;
      const asistente = { preguntar: (b) => { preguntas.push(b); ocupado = true; return { id: 3 }; }, cancelar() {}, nuevaSesion() {}, estado: () => ({ ocupado, ocupadoAqui: ocupado, eventos: [] }), enMarcha: () => [] };
      await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
      server.on('request', createApp({ jarvis, estrategia, asistente, port: server.address().port, status: async () => [] }));
      const base = `http://127.0.0.1:${server.address().port}`;
      const pedir = (ruta, metodo = 'GET', body) => fetch(base + ruta, { method: metodo, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
      const a = await pedir('/api/estrategia?anio=2026');
      assert.equal(a.semanas.length, 53);
      assert.deepEqual(Object.keys(a.estructuras), ['atraer', 'educar', 'vender']);
      assert.equal(a.objetivos.find((o) => o.id === 'anuncio').tipo, 'educar');
      await pedir('/api/estrategia/semana/2026-10-12', 'PUT', { objetivo: 'educacion', notas: 'Problemas: no contestan, no agendan' });
      const s = await pedir('/api/estrategia/semana/2026-10-14');
      assert.equal(s.semana.tipo, 'educar');
      assert.deepEqual(s.piezas.map((p) => p.titulo), ['Reel del lunes']);
      const j = await pedir('/api/estrategia/semana/2026-10-12/jarvis', 'POST', { indicaciones: 'Lanzo el programa el lunes 19' });
      assert.equal(j.status, 200);
      assert.equal(preguntas[0].conversacion, 'guiones');
      assert.match(preguntas[0].texto, /Semana educativa[\s\S]*Problemas: no contestan[\s\S]*Lanzo el programa/);
      assert.equal((await pedir('/api/estrategia/semana/2026-10-12')).planificando, true);
      const plan = await pedir('/api/estrategia/plan?desde=2026-10-12&dias=2');
      assert.equal(plan.status, 200);
    } finally { server.close(); limpiar(); }
  });

  test('MCP: JARVIS ve qué toca cada día y puede marcar una semana', async () => {
    const { estrategia, jarvis, limpiar } = nuevo();
    try {
      const [a, b] = InMemoryTransport.createLinkedPair();
      await buildServer(jarvis, { calendario: estrategia }).connect(a);
      const client = new Client({ name: 't', version: '1' });
      await client.connect(b);
      const m = await client.callTool({ name: 'marcar_semana_estrategia', arguments: { fecha: '2026-01-21', objetivo: 'venta', campana: 'Año Nuevo' } });
      assert.equal(JSON.parse(m.content[0].text).tipo, 'vender');
      const v = JSON.parse((await client.callTool({ name: 'ver_estrategia', arguments: { desde: '2026-01-19', dias: 2 } })).content[0].text);
      assert.equal(v.dias[1].post, 'Educar (FAQs (racional))');
      assert.equal(v.dias[1].campana, 'Año Nuevo');
      assert.ok(v.estructuras.educar.tipos.length > 0);
    } finally { limpiar(); }
  });
});
