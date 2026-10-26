import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { openDb } from '../server/db.js';
import { createJarvis } from '../server/jarvis.js';
import { createVault } from '../server/vault.js';
import { createArchivos } from '../server/archivos.js';
import { createKit } from '../server/diseno/kit.js';
import { createMediosUrl, ipPrivada } from '../server/medios-url.js';
import { buildServer } from '../mcp/jarvis-mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

let dir;
before(() => { dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-medios-')); });
after(() => rmSync(dir, { recursive: true, force: true }));

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const respuesta = (status, headers = {}, cuerpo = PNG) => new Response(status >= 300 && status < 400 ? null : cuerpo, { status, headers });
const resolverPublico = async () => [{ address: '104.18.1.1', family: 4 }];

function montar({ fetchImpl, resolver = resolverPublico } = {}) {
  const vault = mkdtempSync(path.join(dir, 'v-'));
  const jarvis = createJarvis({ db: openDb(':memory:'), vault: createVault(vault) });
  const archivos = createArchivos({ dir: mkdtempSync(path.join(dir, 'c-')) });
  return { jarvis, archivos, medios: createMediosUrl({ jarvis, archivos, fetchImpl, resolver }) };
}

describe('Imágenes de un enlace (Higgsfield → biblioteca)', () => {
  test('ipPrivada reconoce la red local y deja pasar internet', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '192.168.1.10', '172.20.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) assert.equal(ipPrivada(ip), true, ip);
    for (const ip of ['104.18.1.1', '8.8.8.8', '172.32.0.1', '2606:4700::1111']) assert.equal(ipPrivada(ip), false, ip);
  });

  test('descarga la imagen y la deja en la biblioteca, carpeta «Imágenes IA»', async () => {
    const pedidas = [];
    const { jarvis, archivos, medios } = montar({ fetchImpl: async (u) => { pedidas.push(u); return respuesta(200, { 'content-type': 'image/png' }); } });
    const r = await medios.guardar({ url: 'https://cdn.higgsfield.ai/x/abc.png?firma=1', nombre: 'Jose en Bali.png', titulo: 'Jose en Bali' });
    assert.deepEqual(pedidas, ['https://cdn.higgsfield.ai/x/abc.png?firma=1']);
    assert.equal(r.tipo, 'foto');
    assert.match(r.url, /Jose-en-Bali\.png$/);
    assert.deepEqual(readFileSync(r.ruta), PNG);
    const p = jarvis.leerPieza(r.pieza_id);
    assert.equal(p.titulo, 'Jose en Bali');
    assert.equal(p.formato, 'Foto');
    assert.equal(p.carpeta, 'Imágenes IA');
    assert.ok(archivos.ruta(p.archivos[0].path));
  });

  test('los vídeos se guardan como vídeo', async () => {
    const { jarvis, medios } = montar({ fetchImpl: async () => respuesta(200, { 'content-type': 'video/mp4; codecs=avc1' }) });
    const r = await medios.guardar({ url: 'https://cdn.higgsfield.ai/v.mp4' });
    assert.equal(r.tipo, 'video');
    assert.match(r.url, /\.mp4$/);
    assert.equal(jarvis.leerPieza(r.pieza_id).formato, 'Vídeo');
  });

  test('rechaza http, enlaces a la red local y lo que no es imagen ni vídeo', async () => {
    let descargas = 0;
    const fetchImpl = async () => { descargas++; return respuesta(200, { 'content-type': 'text/html' }, 'hola'); };
    const { medios } = montar({ fetchImpl });
    await assert.rejects(medios.guardar({ url: 'http://cdn.higgsfield.ai/a.png' }), /Solo enlaces https/);
    await assert.rejects(medios.guardar({ url: 'https://127.0.0.1/a.png' }), /no apunta a internet/);
    await assert.rejects(medios.guardar({ url: 'no es un enlace' }), /no es válido/);
    const local = montar({ fetchImpl, resolver: async () => [{ address: '192.168.1.20', family: 4 }] });
    await assert.rejects(local.medios.guardar({ url: 'https://router.casa/a.png' }), /no apunta a internet/);
    assert.equal(descargas, 0);
    await assert.rejects(medios.guardar({ url: 'https://cdn.higgsfield.ai/pagina' }), /no es una imagen ni un vídeo \(text\/html\)/);
  });

  test('comprueba también a dónde llevan las redirecciones', async () => {
    const resolver = async (host) => [{ address: host === 'interno.ejemplo' ? '10.0.0.7' : '104.18.1.1', family: 4 }];
    const pedidas = [];
    const { medios } = montar({ resolver, fetchImpl: async (u) => { pedidas.push(u); return u.includes('cdn') ? respuesta(302, { location: 'https://interno.ejemplo/secreto.png' }) : respuesta(200, { 'content-type': 'image/png' }); } });
    await assert.rejects(medios.guardar({ url: 'https://cdn.higgsfield.ai/a.png' }), /no apunta a internet/);
    assert.deepEqual(pedidas, ['https://cdn.higgsfield.ai/a.png']);

    const bien = montar({ fetchImpl: async (u) => (u.endsWith('/a.png') ? respuesta(301, { location: '/b.png' }) : respuesta(200, { 'content-type': 'image/png' })) });
    const r = await bien.medios.guardar({ url: 'https://cdn.higgsfield.ai/a.png' });
    assert.equal(r.tipo, 'foto');
  });

  test('MCP guardar_imagen_url lo manda al dashboard', async () => {
    const llamadas = [];
    const servidor = async (m, ruta, body) => { llamadas.push([m, ruta, body]); return { url: '/api/contenido/archivos/2026-10/a.png', tipo: 'foto', pieza_id: 3 }; };
    const vault = mkdtempSync(path.join(dir, 'v-'));
    const s = buildServer(createJarvis({ db: openDb(':memory:'), vault: createVault(vault) }), { diseno: { kit: createKit({ vaultPath: vault }), servidor, cadaMs: 1 } });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await s.connect(a);
    const c = new Client({ name: 't', version: '1' });
    await c.connect(b);
    const r = await c.callTool({ name: 'guardar_imagen_url', arguments: { url: 'https://cdn.higgsfield.ai/a.png', nombre: 'portada' } });
    assert.deepEqual(llamadas, [['POST', '/api/biblioteca/desde-url', { url: 'https://cdn.higgsfield.ai/a.png', nombre: 'portada' }]]);
    assert.equal(JSON.parse(r.content[0].text).pieza_id, 3);
  });
});
