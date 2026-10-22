import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { openDb } from '../server/db.js';
import { createVault } from '../server/vault.js';
import { createJarvis } from '../server/jarvis.js';
import { createStories } from '../server/stories.js';
import { createApp } from '../server/index.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from '../mcp/jarvis-mcp.js';

const nuevo = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-stories-'));
  const db = openDb(':memory:');
  const jarvis = createJarvis({ db, vault: createVault(path.join(dir, 'V')) });
  const preguntas = [];
  let ocupado = false;
  const asistente = { preguntar: (b) => { preguntas.push(b); ocupado = true; return { id: preguntas.length }; }, estado: () => ({ ocupado, ocupadoAqui: ocupado }), acabar: () => { ocupado = false; } };
  const creados = [];
  const disenos = { crear: (d) => { creados.push(d); return { id: 7 }; }, obtener: (id) => ({ id, estado: 'generando', diapositivas: 0, previas: [] }) };
  const stories = createStories({ db, jarvis, asistente, disenos });
  return { db, jarvis, asistente, preguntas, creados, stories, limpiar: () => rmSync(dir, { recursive: true, force: true }) };
};

describe('guiones de stories', () => {
  test('de un carrusel: JARVIS escribe el guion, lo guarda con su herramienta y después se diseña', async () => {
    const { jarvis, asistente, preguntas, creados, stories, limpiar } = nuevo();
    try {
      const p = jarvis.crearPieza({ titulo: 'Deja de contestar DMs a mano', formato: 'Carrusel', caption: 'Comenta SETTER y te lo mando' });
      jarvis.guardarGuion(p.id, { texto: 'Slide 1: el problema\nSlide 2: la solución' });
      assert.throws(() => stories.crear({}), /Elige un carrusel/);
      const s = stories.crear({ pieza_id: p.id, objetivo: 'promo', cantidad: 4 });
      assert.equal(s.estado, 'escribiendo');
      assert.equal(s.titulo, 'Stories · Deja de contestar DMs a mano');
      assert.equal(s.pieza.formato, 'Carrusel');
      assert.equal(preguntas[0].conversacion, 'guiones');
      assert.match(preguntas[0].texto, /secuencia de 4 stories[\s\S]*Slide 1: el problema[\s\S]*Comenta SETTER[\s\S]*Llevar tráfico[\s\S]*guardar_guion_stories \(id 1\)/);
      // Mientras escribe no se puede diseñar
      assert.throws(() => stories.disenar(s.id, {}), /Primero escribe|Espera/);

      // JARVIS lo guarda por el MCP
      const [a, b] = InMemoryTransport.createLinkedPair();
      await buildServer(jarvis, { stories }).connect(a);
      const client = new Client({ name: 't', version: '1' });
      await client.connect(b);
      const r = JSON.parse((await client.callTool({ name: 'guardar_guion_stories', arguments: { id: s.id, titulo: 'DMs en piloto automático', guion: '## Story 1 · texto\nTexto en pantalla: ¿Sigues contestando a mano?\n\n## Story 2 · encuesta\nTexto en pantalla: ¿Cuántos DMs al día?' } })).content[0].text);
      assert.equal(r.stories, 2);
      asistente.acabar();
      stories.alEventoClaude({ conversacion: 'guiones', tipo: 'fin' });
      const listo = stories.obtener(s.id);
      assert.equal(listo.estado, 'listo');
      assert.equal(listo.titulo, 'DMs en piloto automático');
      assert.equal(listo.error, null);

      // Diseñar: un diseño de stories con el guion y enlazado a la pieza
      const d = stories.disenar(s.id, { plantilla: 'story-1', indicaciones: 'fondo oscuro' });
      assert.equal(d.diseno.id, 7);
      assert.equal(creados[0].formato, 'story');
      assert.equal(creados[0].pieza_id, p.id);
      assert.match(creados[0].guion, /Story 2 · encuesta/);
      assert.match(creados[0].indicaciones, /una diapositiva por cada «## Story»[\s\S]*fondo oscuro/);

      // Pedir un cambio: va con el guion actual
      stories.escribir(s.id, { indicaciones: 'más corto' });
      assert.match(preguntas[1].texto, /^Cambia el GUION DE STORIES[\s\S]*más corto[\s\S]*Sigues contestando a mano/);
      // Si termina sin guardar, se avisa (y el guion de antes sigue)
      asistente.acabar();
      stories.alEventoClaude({ conversacion: 'guiones', tipo: 'fin' });
      assert.match(stories.obtener(s.id).error, /sin guardar/);
      assert.match(stories.obtener(s.id).guion, /Story 1/);
    } finally { limpiar(); }
  });

  test('API: desde un tema o escrito a mano, y se cambia a mano', async () => {
    const { jarvis, stories, preguntas, limpiar } = nuevo();
    const server = http.createServer();
    try {
      await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
      server.on('request', createApp({ jarvis, stories, port: server.address().port, status: async () => [] }));
      const base = `http://127.0.0.1:${server.address().port}`;
      const pedir = (ruta, metodo = 'GET', body) => fetch(base + ruta, { method: metodo, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
      const a = await pedir('/api/stories', 'POST', { tema: 'Cómo preparo una llamada de venta', cantidad: 50 });
      assert.equal(a.cantidad, 15);
      assert.match(preguntas[0].texto, /Tema: Cómo preparo una llamada de venta/);
      const b = await pedir('/api/stories', 'POST', { titulo: 'Mis stories', escribirConJarvis: false });
      assert.equal(b.estado, 'listo');
      const c = await pedir(`/api/stories/${b.id}`, 'PUT', { guion: '## Story 1 · texto\nTexto en pantalla: hola' });
      assert.match(c.guion, /hola/);
      const l = await pedir('/api/stories');
      assert.equal(l.guiones.length, 2);
      assert.ok(l.objetivos.lm);
      assert.equal((await pedir(`/api/stories/${b.id}`, 'DELETE')).ok, true);
      assert.equal((await pedir(`/api/stories/${b.id}`)).status, 400);
    } finally { server.close(); limpiar(); }
  });
});
