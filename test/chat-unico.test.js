import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { openDb } from '../server/db.js';
import { createVault, ensureVault } from '../server/vault.js';
import { createJarvis } from '../server/jarvis.js';
import { getConfig } from '../server/config.js';
import { buildServer } from '../mcp/jarvis-mcp.js';
import { SKILLS } from '../skills/catalogo.js';

// Un solo chat: el MCP le pasa al Laboratorio del dashboard los testimonios, reels, clips y lead magnets
let dir, jarvis, c, llamadas;
const eventos = [];
before(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-chat-'));
  const cfg = getConfig({});
  ensureVault(path.join(dir, 'V'), cfg.templateDir, cfg.mcpScript);
  jarvis = createJarvis({ db: openDb(':memory:'), vault: createVault(path.join(dir, 'V')) });
  llamadas = [];
  // El dashboard, de mentira
  const servidor = async (metodo, ruta, body) => {
    llamadas.push({ metodo, ruta, body });
    if (ruta === '/api/laboratorio') return { plugin: { instalado: true }, python: true, marca: { verificado: true }, trabajando: false, entrevistas: [{ ruta: 'crudo/Ana.mp4' }], testimonios: [{ cliente: 'Ana', caption: 'testimonios/Ana/_caption.md', portadas: [], grupos: [{ id: 'stories', nombre: 'Stories', archivos: [{ ruta: 'testimonios/Ana/stories/1.mp4', enBiblioteca: true }, { ruta: 'testimonios/Ana/stories/2.mp4' }] }] }], reels: [] };
    if (ruta === '/api/laboratorio/leadmagnets') return { leadmagnets: [{ slug: 'guia', titulo: 'Guía', tipo: 'guia', listo: true }] };
    if (ruta === '/api/laboratorio/imagenes') return { trabajos: [] };
    if (ruta.startsWith('/api/jarvis/estado')) return { ocupadoAqui: true, eventos };
    return { ok: true };
  };
  const subir = async (ruta, o) => { llamadas.push({ subir: ruta, ...o }); return { ruta: 'crudo/x.mp4' }; };
  const [a, b] = InMemoryTransport.createLinkedPair();
  await buildServer(jarvis, { laboratorio: { servidor, subir } }).connect(a);
  c = new Client({ name: 't', version: '1' });
  await c.connect(b);
});
after(() => rmSync(dir, { recursive: true, force: true }));
const llamar = async (name, args = {}) => JSON.parse((await c.callTool({ name, arguments: args })).content[0].text);

describe('chat único', () => {
  test('el estado del Laboratorio llega resumido, con lo que ya está en la biblioteca', async () => {
    const e = await llamar('laboratorio_estado');
    assert.deepEqual(e.listo, { plugin: true, python: true, marca: true });
    assert.deepEqual(e.subidos, ['crudo/Ana.mp4']);
    assert.deepEqual(e.testimonios[0].grupos[0].archivos, [{ ruta: 'testimonios/Ana/stories/1.mp4', enBiblioteca: true }, { ruta: 'testimonios/Ana/stories/2.mp4' }]);
    assert.equal(e.leadmagnets[0].slug, 'guia');
  });

  test('encargar, subir, pasar a la biblioteca, unir el lead magnet y exportar un diseño van al dashboard', async () => {
    await llamar('laboratorio_encargar', { tipo: 'reel', datos: { video: 'crudo/x.mp4', modo: 'clips', clips: 4 } });
    assert.deepEqual(llamadas.at(-1), { metodo: 'POST', ruta: '/api/laboratorio/empezar', body: { tipo: 'reel', datos: { video: 'crudo/x.mp4', modo: 'clips', clips: 4 } } });
    assert.equal((await llamar('laboratorio_subir', { ruta_local: '/tmp/x.mp4', tipo: 'video' })).ruta, 'crudo/x.mp4');
    await llamar('laboratorio_a_biblioteca', { rutas: ['reels/x/pantalla/01.mp4'], formato: 'Reel', padre_id: 7, pilar: 'Automatización', objetivo: 'atraer' });
    assert.deepEqual(llamadas.at(-1).body, { rutas: ['reels/x/pantalla/01.mp4'], formato: 'Reel', padre_id: 7, pilar: 'Automatización', objetivo: 'atraer' });
    await llamar('asignar_leadmagnet', { slug: 'guia', pieza: 3 });
    assert.deepEqual(llamadas.at(-1), { metodo: 'PUT', ruta: '/api/laboratorio/leadmagnets/guia/pieza', body: { pieza: 3 } });
    await llamar('exportar_diseno', { id: 5 });
    assert.deepEqual(llamadas.at(-1), { metodo: 'POST', ruta: '/api/disenos/5/exportar', body: { tipo: 'jpg' } });
  });

  test('lo que enseña el Laboratorio se lee por turnos y la respuesta de la persona se le pasa tal cual', async () => {
    eventos.push(
      { id: 1, tipo: 'pregunta', texto: 'Monta el testimonio de Ana' },
      { id: 1, tipo: 'texto', texto: 'Guion: 1) Antes… ' },
      { id: 1, tipo: 'texto', texto: '¿Te vale?' },
      { id: 1, tipo: 'fin', texto: 'Guion: 1) Antes… ¿Te vale?' },
    );
    const r = await llamar('laboratorio_chat');
    assert.equal(r.trabajando, true);
    assert.deepEqual(r.turnos, [{ pedido: 'Monta el testimonio de Ana', respuesta: 'Guion: 1) Antes… ¿Te vale?', estado: 'terminado' }]);
    await llamar('laboratorio_responder', { texto: 'Sí, adelante' });
    assert.deepEqual(llamadas.at(-1), { metodo: 'POST', ruta: '/api/jarvis/preguntar', body: { conversacion: 'laboratorio', texto: 'Sí, adelante' } });
  });

  test('hay una skill de flujo completo para cada trabajo y usan las herramientas reales', () => {
    const flujos = SKILLS.filter((s) => s.c === 'flujos').map((s) => s.n).sort();
    assert.deepEqual(flujos, ['flujo-carrusel-stories', 'flujo-clips', 'flujo-lead-magnet', 'flujo-reel', 'flujo-replicar', 'flujo-testimonio']);
    const texto = (n) => SKILLS.find((s) => s.n === n).p.join(' ');
    assert.match(texto('flujo-carrusel-stories'), /exportar_diseno/);
    assert.match(texto('flujo-testimonio'), /laboratorio_responder/);
    assert.match(texto('flujo-testimonio'), /Nunca des tú el visto bueno/);
    assert.match(texto('flujo-clips'), /padre_id/);
    assert.match(texto('flujo-lead-magnet'), /asignar_leadmagnet/);
  });
});
