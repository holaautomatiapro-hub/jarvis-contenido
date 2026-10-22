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
import { createKit } from '../server/diseno/kit.js';
import { createDisenos } from '../server/diseno/disenos.js';
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

  test('tu guía de estilo (Stories/CLAUDE.md): se guarda en el vault y JARVIS la sigue al escribir', () => {
    const { jarvis, stories, preguntas, limpiar } = nuevo();
    try {
      assert.equal(stories.estilo().texto, '');
      const e = stories.guardarEstilo({ texto: '# Mi estilo\n- Máximo 12 palabras por story\n- Siempre cierro con «responde YO»' });
      assert.equal(e.ruta, 'Stories/CLAUDE.md');
      assert.match(jarvis.vault.read('Stories/CLAUDE.md').contenido, /responde YO/);
      // Si se cambió en Obsidian mientras se editaba, no se pisa
      assert.throws(() => stories.guardarEstilo({ texto: 'otro', modificado: '2000-01-01T00:00:00.000Z' }), /ha cambiado/);
      stories.guardarEstilo({ texto: `${e.texto}- Fondo con foto mía\n`, modificado: e.modificado });
      stories.crear({ tema: 'Mis 3 errores al vender' });
      assert.match(preguntas[0].texto, /Tema: Mis 3 errores[\s\S]*Mi guía de estilo de stories \(Stories\/CLAUDE\.md\)[\s\S]*Máximo 12 palabras[\s\S]*Fondo con foto mía/);
    } finally { limpiar(); }
  });

  test('al diseñar stories, Claude lee tu CLAUDE.md y mira tus stories de ejemplo', () => {
    const { db, jarvis, stories, limpiar } = nuevo();
    try {
      stories.guardarEstilo({ texto: '# Mi estilo\n- Fondo negro' });
      stories.subirEjemplo({ nombre: 'ejemplo.png', datos: Buffer.from([0x89, 0x50, 0x4e, 0x47]) });
      const textos = [];
      const asistente = { estado: () => ({ ocupado: false }), nuevaSesion() {}, preguntar: (b) => { textos.push(b.texto); return { id: 1 }; } };
      const kit = createKit({ vaultPath: jarvis.vault.base });
      const disenos = createDisenos({ db, jarvis, kit, motor: {}, previasDir: path.join(jarvis.vault.base, '..', 'previas'), asistente });
      const plantilla = kit.leer().plantillas.find((p) => p.formatos.includes('story'));
      disenos.crear({ formato: 'story', plantilla: plantilla.id, guion: '## Story 1 · texto\nTexto en pantalla: hola' });
      assert.match(textos[0], /Stories\/CLAUDE\.md[\s\S]*Mis stories de ejemplo[^\n]*Stories\/ejemplos\/\d+-ejemplo\.png/);
      // En un carrusel, no
      disenos.crear({ formato: 'carrusel', guion: 'Slide 1' });
      assert.doesNotMatch(textos[1], /stories de ejemplo|Stories\/CLAUDE/);
    } finally { limpiar(); }
  });

  test('API: desde un tema o escrito a mano, y se cambia a mano', async () => {
    const { jarvis, stories, preguntas, asistente, limpiar } = nuevo();
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
      const est = await pedir('/api/stories/estilo', 'PUT', { texto: '# Mi estilo\n- Corto' });
      assert.equal(est.status, 200);
      assert.match((await pedir('/api/stories/estilo')).texto, /Corto/);
      // Stories de ejemplo: imágenes en el vault (Stories/ejemplos) que Claude mira para copiar el estilo
      const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
      const sube = (nombre, cuerpo = jpg) => fetch(`${base}/api/stories/ejemplos?nombre=${encodeURIComponent(nombre)}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: cuerpo }).then(async (r) => ({ status: r.status, json: await r.json() }));
      const s1 = await sube('Mi story ñandú.JPG');
      assert.equal(s1.status, 200);
      assert.match(s1.json[0].fichero, /^\d+-Mi-story-nandu\.jpg$/);
      assert.equal((await sube('video.mp4')).status, 400);
      const img = await fetch(base + s1.json[0].url);
      assert.equal(Buffer.from(await img.arrayBuffer()).length, jpg.length);
      asistente.acabar();
      stories.crear({ tema: 'Con ejemplos' });
      assert.match(preguntas.at(-1).texto, /Mis stories de ejemplo[^\n]*Stories\/ejemplos\/\d+-Mi-story-nandu\.jpg/);
      assert.equal((await fetch(`${base}/api/stories/ejemplos/${s1.json[0].fichero}`, { method: 'DELETE' }).then((r) => r.json())).length, 0);
      assert.equal((await fetch(base + s1.json[0].url)).status, 404);
      const l = await pedir('/api/stories');
      assert.match(l.estilo.texto, /Corto/);
      assert.equal(l.guiones.length, 3);
      assert.deepEqual(l.ejemplos, []);
      assert.ok(l.objetivos.lm);
      assert.equal((await pedir(`/api/stories/${b.id}`, 'DELETE')).ok, true);
      assert.equal((await pedir(`/api/stories/${b.id}`)).status, 400);
    } finally { server.close(); limpiar(); }
  });
});
