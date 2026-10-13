import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { openDb } from '../server/db.js';
import { createVault } from '../server/vault.js';
import { createJarvis } from '../server/jarvis.js';
import { createApp } from '../server/index.js';

test('«Trabajando en…» junta diseños, portadas, Claude y la actualización, sin repetir el diseño que ya sale', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-trab-'));
  const jarvis = createJarvis({ db: openDb(':memory:'), vault: createVault(path.join(dir, 'V')) });
  const ahora = Date.now();
  const asistente = {
    enMarcha: () => [
      { id: 7, conversacion: 'diseno', desde: ahora - 60_000, texto: 'Diseña el diseño #3', modelo: 'A fondo' },
      { id: 8, conversacion: 'laboratorio', desde: ahora - 5000, texto: '[Laboratorio]\nMonta el testimonio de Andrea', modelo: 'A fondo' },
    ],
    estado: () => ({ ocupado: true, eventos: [] }), preguntar() {}, cancelar() {}, nuevaSesion() {},
  };
  const disenos = {
    trabajos: () => [
      { id: 3, titulo: 'Tu Claude es un pelota', uso: null, estado: 'generando', trabajo: { conversacion: 'diseno', inicio: ahora - 60_000, texto: 'Escribiendo las diapositivas', paso: 'escribiendo', desde: 30, hasta: 72, senal: ahora, estimado: 300_000 } },
      { id: 4, titulo: 'Contraté un setter IA', uso: 'portada', pieza_origen: 12, estado: 'exportando', progreso: 40, trabajo: null },
    ],
    listar: () => [],
  };
  const actualizar = { enCurso: () => ({ estado: 'actualizando', inicio: new Date(ahora - 30_000).toISOString() }) };
  const server = http.createServer();
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  server.on('request', createApp({ jarvis, asistente, disenos, actualizar, port: server.address().port, status: async () => [] }));
  try {
    const { trabajos } = await (await fetch(`http://127.0.0.1:${server.address().port}/api/trabajos`)).json();
    assert.deepEqual(trabajos.map((t) => t.titulo), ['Diseño: Tu Claude es un pelota', 'Portada: Contraté un setter IA', 'Laboratorio', 'Actualizando JARVIS']);
    assert.equal(trabajos[0].detalle, 'Escribiendo las diapositivas');
    assert.deepEqual(trabajos[0].ir, { tab: 'laboratorio', seccion: 'diseno', diseno: 3 });
    assert.equal(trabajos[1].progreso, 40);
    assert.deepEqual(trabajos[1].ir, { tab: 'contenido', pieza: 12 }, 'la portada lleva a su pieza');
    assert.equal(trabajos[2].detalle, 'Monta el testimonio de Andrea');
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
