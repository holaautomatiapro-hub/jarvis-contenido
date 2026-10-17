import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { openDb } from '../server/db.js';
import { createVault } from '../server/vault.js';
import { createJarvis } from '../server/jarvis.js';
import { createArchivos } from '../server/archivos.js';
import { createAdjuntos } from '../server/adjuntos.js';
import { createAds, mediosDeSnapshot, motivoSnapshot } from '../server/integrations/ads.js';
import { createApp } from '../server/index.js';

const hace = (d) => new Date(Date.now() - d * 86400000).toISOString();
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

// La vista previa de un anuncio (ad_snapshot_url), como la da Meta: los datos van en JSON dentro de la página
const SNAPSHOT = `<html><body><script>{"videos":[{"video_hd_url":"https:\\/\\/video.fbcdn.net\\/v\\/anuncio-hd.mp4?oh=1\\u0026oe=2","video_sd_url":"https:\\/\\/video.fbcdn.net\\/v\\/anuncio-sd.mp4","video_preview_image_url":"https:\\/\\/scontent.fbcdn.net\\/portada.jpg"}],"images":[]}</script></body></html>`;

describe('anuncios de la competencia (Biblioteca de anuncios)', () => {
  let dir, db, ads, llamadas, activos;
  before(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-anun-'));
    db = openDb(':memory:');
    llamadas = [];
    // Lo que Meta devuelve de los anuncios activos de la página 999 (cambia entre búsquedas)
    activos = [
      { id: 'a1', page_id: '999', page_name: 'Zero Chats', ad_creative_bodies: ['Responde en 5 segundos', 'Otra versión'], ad_creative_link_titles: ['Prueba gratis'], ad_delivery_start_time: hace(90), publisher_platforms: ['instagram', 'facebook'], eu_total_reach: 50000, ad_snapshot_url: 'https://www.facebook.com/ads/archive/render_ad/?id=a1' },
      { id: 'a2', page_id: '999', page_name: 'Zero Chats', ad_creative_bodies: ['Webinar gratis el jueves'], ad_delivery_start_time: hace(5), eu_total_reach: 900000 },
      { id: 'a3', page_id: '999', page_name: 'Zero Chats', ad_creative_bodies: ['Responde en 5 segundos'], ad_delivery_start_time: hace(40), eu_total_reach: 1000 },
    ];
    const fetchImpl = async (url) => {
      const u = new URL(url);
      llamadas.push(u.hostname + u.pathname + u.search);
      if (u.hostname === 'www.facebook.com') return new Response(SNAPSHOT, { status: 200 });
      if (/fbcdn\.net$/.test(u.hostname)) return new Response(u.pathname.endsWith('.mp4') ? 'VIDEO' : 'JPG', { status: 200 });
      const ruta = u.pathname.replace(/^\/v[\d.]+\//, '');
      if (ruta !== 'ads_archive') return json({ error: { code: 803, message: ruta } }, 404);
      if (u.searchParams.get('search_terms') === 'sin verificar') return json({ error: { code: 10, message: 'Application does not have permission for this action' } }, 400);
      if (u.searchParams.get('search_page_ids') === '999') return json({ data: activos });
      return json({ data: [
        { page_id: '555', page_name: 'Agencia Cualquiera' },
        { page_id: '999', page_name: 'Zero Chats' }, { page_id: '999', page_name: 'Zero Chats' },
        { page_id: '777', page_name: 'Otra Página' }, { page_id: '777', page_name: 'Otra Página' }, { page_id: '777', page_name: 'Otra Página' },
      ] });
    };
    const instagram = { conexion: () => ({ tokenUsuario: 'TU' }), estado: () => ({ conectado: true }) };
    ads = createAds({ db, instagram, env: {}, fetchImpl, mediosDir: path.join(dir, 'V', '.jarvis', 'anuncios') });
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  test('el vídeo y las imágenes salen de la vista previa del anuncio', () => {
    const m = mediosDeSnapshot(SNAPSHOT);
    assert.deepEqual(m.videos, ['https://video.fbcdn.net/v/anuncio-hd.mp4?oh=1&oe=2', 'https://video.fbcdn.net/v/anuncio-sd.mp4']);
    assert.deepEqual(m.imagenes, ['https://scontent.fbcdn.net/portada.jpg']);
    assert.deepEqual(mediosDeSnapshot('<div><video class="x" src="https://video.fbcdn.net/a.mp4"></video><img src="https://scontent.fbcdn.net/b.jpg"></div>'), { videos: ['https://video.fbcdn.net/a.mp4'], imagenes: ['https://scontent.fbcdn.net/b.jpg'] });
  });

  test('buscar un anunciante: sus páginas, primero la que coincide con lo que buscas', async () => {
    const { candidatos } = await ads.buscarAnunciante('@zero_chats');
    assert.deepEqual(candidatos.map((c) => [c.nombre, c.anuncios, c.coincide]), [['Zero Chats', 2, true], ['Otra Página', 3, false], ['Agencia Cualquiera', 1, false]]);
    assert.match(llamadas.at(-1), /search_terms=zero\+chats/);
    // Con el enlace de la Biblioteca (o el ID), directo a esa página
    await ads.buscarAnunciante('https://www.facebook.com/ads/library/?active_status=active&view_all_page_id=999');
    assert.match(llamadas.at(-1), /search_page_ids=999/);
    await assert.rejects(ads.buscarAnunciante('sin verificar'), /verifiques tu identidad/);
    await assert.rejects(ads.buscarAnunciante('x'), /Escribe/);
  });

  test('seguirlo trae sus anuncios activos; se ordenan y se filtran por antigüedad, alcance y variantes', async () => {
    assert.deepEqual(await ads.seguirAnunciante({ pagina_id: '999', nombre: 'Zero Chats' }), { pagina_id: '999', anuncios: 3 });
    const porTiempo = ads.anunciosCompetencia();
    assert.deepEqual(porTiempo.anuncios.map((a) => a.id), ['a1', 'a3', 'a2'], 'por defecto, los que más tiempo llevan activos');
    assert.equal(porTiempo.anuncios[0].diasActivo, 90);
    assert.equal(porTiempo.anuncios[0].variantes, 2, 'el mismo texto en dos anuncios: lo están escalando');
    assert.equal(porTiempo.anuncios[0].verEnBiblioteca, 'https://www.facebook.com/ads/library/?id=a1');
    assert.deepEqual(ads.anunciosCompetencia({ orden: 'recientes' }).anuncios.map((a) => a.id), ['a2', 'a3', 'a1']);
    assert.deepEqual(ads.anunciosCompetencia({ orden: 'alcance' }).anuncios.map((a) => a.id), ['a2', 'a1', 'a3']);
    assert.deepEqual(ads.anunciosCompetencia({ minDias: 30 }).anuncios.map((a) => a.id), ['a1', 'a3']);
    assert.equal(ads.anunciosCompetencia().anunciantes[0].activos, 3);
    assert.deepEqual(ads.anuncioCompetencia('a1').cuerpos, ['Responde en 5 segundos', 'Otra versión']);
    // Al volver a buscar, el que ya no sale se da por terminado
    activos = activos.filter((a) => a.id !== 'a3');
    await ads.sincronizarAnunciantes();
    assert.deepEqual(ads.anunciosCompetencia().anuncios.map((a) => a.id), ['a1', 'a2']);
    assert.equal(ads.anunciosCompetencia().anuncios[0].variantes, 1);
  });

  test('vídeo e imágenes del anuncio: se guardan en el vault para verlos, transcribirlos y adaptarlos', async () => {
    const a = await ads.mediosAnuncio('a1');
    assert.equal(a.video, '/api/ads/anuncios/a1/medio/video.mp4');
    assert.equal(a.miniatura, '/api/ads/anuncios/a1/medio/01.jpg', 'la portada del vídeo');
    assert.ok(llamadas.some((l) => l.startsWith('www.facebook.com/ads/archive/render_ad/') && l.includes('access_token=TU')), 'la vista previa se pide con el token');
    assert.ok(llamadas.some((l) => l.endsWith('anuncio-hd.mp4?oh=1&oe=2')), 'primero el vídeo en HD');
    assert.ok(existsSync(ads.rutaMedioAnuncio('a1', 'video.mp4')));
    assert.equal(ads.rutaMedioAnuncio('a1', '../x'), null);
    const antes = llamadas.length;
    await ads.mediosAnuncio('a1');
    assert.equal(llamadas.length, antes, 'la segunda vez, de lo guardado');
    await assert.rejects(ads.mediosAnuncio('a2'), /vista previa/);
    assert.ok(ads.paraAdaptar('a1').video.endsWith('video.mp4'));
  });

  test('dejar de seguir borra sus anuncios', async () => {
    ads.dejarAnunciante('999');
    assert.deepEqual(ads.anunciosCompetencia().anuncios, []);
    await assert.rejects(ads.seguirAnunciante({ pagina_id: 'abc' }), /Elige una página/);
  });
});

describe('vista previa que Meta monta con JavaScript', () => {
  test('JSON escapado dos veces y sin la foto de perfil de la página', () => {
    const doble = String.raw`<script>{\"video_hd_url\":\"https:\\\/\\\/video.xx.fbcdn.net\\\/v\\\/a.mp4?x=1\\u00262\"}</script><img src="https://scontent.xx.fbcdn.net/v/t39.30808-1/p60x60/perfil.jpg"><img src="https://scontent.xx.fbcdn.net/v/t39.35426-6/anuncio.jpg">`;
    assert.deepEqual(mediosDeSnapshot(doble), { videos: ['https://video.xx.fbcdn.net/v/a.mp4?x=1&2'], imagenes: ['https://scontent.xx.fbcdn.net/v/t39.35426-6/anuncio.jpg'] });
    assert.match(motivoSnapshot({ titulo: 'Facebook', texto: 'Inicia sesión en Facebook para continuar' }), /iniciar sesión/);
  });

  test('si el HTML no trae nada se abre en el navegador; la miniatura se saca una vez y se guarda', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-anun3-'));
    const db = openDb(':memory:');
    const pedidas = [];
    const fetchImpl = async (url) => {
      const u = new URL(url);
      pedidas.push(u.hostname + u.pathname);
      if (u.hostname === 'www.facebook.com') return new Response('<html><body><div id="root"></div></body></html>', { status: 200 });
      if (/fbcdn\.net$/.test(u.hostname)) return new Response('x', { status: 200 });
      return json({ data: [
        { id: 'c1', page_id: '4242424', page_name: 'Rival', ad_creative_bodies: ['Hola'], ad_delivery_start_time: hace(10), ad_snapshot_url: 'https://www.facebook.com/ads/archive/render_ad/?id=c1' },
        { id: 'c2', page_id: '4242424', page_name: 'Rival', ad_creative_bodies: ['Otro'], ad_delivery_start_time: hace(10), ad_snapshot_url: 'https://www.facebook.com/ads/archive/render_ad/?id=c2' },
      ] });
    };
    const abiertas = [];
    const renderizar = async (url) => {
      abiertas.push(url);
      if (url.includes('id=c2')) return { html: '<html></html>', videos: [], imagenes: [], titulo: 'Facebook', texto: 'Inicia sesión en Facebook' };
      return { html: '<html></html>', videos: ['https://video.xx.fbcdn.net/v/c1.mp4'], imagenes: ['https://scontent.xx.fbcdn.net/v/c1.jpg'], titulo: '', texto: '' };
    };
    const ads = createAds({ db, instagram: { conexion: () => ({ tokenUsuario: 'TU' }), estado: () => ({ conectado: true }) }, env: {}, fetchImpl, renderizar, mediosDir: path.join(dir, 'anuncios') });
    try {
      await ads.seguirAnunciante({ pagina_id: '4242424', nombre: 'Rival' });
      const c1 = ads.anunciosCompetencia().anuncios.find((a) => a.id === 'c1');
      assert.equal(c1.miniatura, '/api/ads/anuncios/c1/miniatura', 'la tarjeta pide su imagen aunque aún no se haya abierto');
      const f = await ads.miniaturaAnuncio('c1');
      assert.ok(f.endsWith('miniatura.jpg') && existsSync(f));
      assert.match(abiertas[0], /access_token=TU/, 'la vista previa se abre con el token');
      assert.equal(await ads.miniaturaAnuncio('c1'), f);
      assert.equal(abiertas.length, 1, 'la segunda vez, de lo guardado');
      assert.equal(await ads.miniaturaAnuncio('c2'), null);
      assert.equal(await ads.miniaturaAnuncio('c2'), null);
      assert.equal(abiertas.length, 2, 'si no sale, no se vuelve a intentar enseguida');
      const a = await ads.mediosAnuncio('c1');
      assert.equal(a.video, '/api/ads/anuncios/c1/medio/video.mp4');
      assert.ok(pedidas.includes('video.xx.fbcdn.net/v/c1.mp4'));
      await assert.rejects(ads.mediosAnuncio('c2'), /Meta pide iniciar sesión/);
      assert.ok(existsSync(path.join(dir, 'anuncios', 'c2', 'vista-previa.html')), 'se guarda lo que devolvió Meta');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('API: transcribir y adaptar un anuncio', () => {
  test('la transcripción va a su nota en 04-Competencia y adaptar manda a Claude el anuncio completo', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-anun2-'));
    const db = openDb(':memory:');
    const jarvis = createJarvis({ db, vault: createVault(path.join(dir, 'V')) });
    const fetchImpl = async (url) => {
      const u = new URL(url);
      if (u.hostname === 'www.facebook.com') return new Response(SNAPSHOT, { status: 200 });
      if (/fbcdn\.net$/.test(u.hostname)) return new Response('x', { status: 200 });
      return json({ data: [{ id: 'b1', page_id: '4242424', page_name: 'Rival', ad_creative_bodies: ['¿Pierdes leads?'], ad_delivery_start_time: hace(60), ad_snapshot_url: 'https://www.facebook.com/ads/archive/render_ad/?id=b1' }] });
    };
    const ads = createAds({ db, instagram: { conexion: () => ({ tokenUsuario: 'TU' }), estado: () => ({ conectado: true }) }, env: {}, fetchImpl, mediosDir: path.join(dir, 'V', '.jarvis', 'anuncios') });
    const archivos = createArchivos({ dir: path.join(dir, 'contenido') });
    const adjuntos = createAdjuntos({ archivos, vaultPath: path.join(dir, 'V'), env: {}, whisperImpl: async () => 'Si pierdes leads por contestar tarde, esto te interesa' });
    const preguntas = [];
    const asistente = { preguntar: (b) => { preguntas.push(b); return { id: 9 }; }, cancelar() {}, nuevaSesion() {}, estado: () => ({ ocupado: false, eventos: [] }), enMarcha: () => [] };
    const server = http.createServer();
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
    server.on('request', createApp({ jarvis, archivos, asistente, adjuntos, ads, port: server.address().port, status: async () => [] }));
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = async (ruta, body) => { const r = await fetch(`${base}${ruta}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }); return { status: r.status, data: await r.json() }; };
    try {
      const seg = await post('/api/ads/anunciantes', { pagina_id: '4242424', nombre: 'Rival' });
      assert.equal(seg.data.anuncios, 1, JSON.stringify(seg));
      const t = (await post('/api/ads/anuncios/b1/transcribir')).data;
      assert.equal(t.estado, 'listo');
      assert.match(t.transcripcion, /contestar tarde/);
      assert.match(t.nota, /^04-Competencia\//);
      const a = await (await fetch(`${base}/api/ads/anuncios/b1`)).json();
      assert.equal(a.transcrita, true);
      assert.equal((await fetch(`${base}${a.video}`)).status, 200, 'el vídeo se ve desde el dashboard');
      const r = await post('/api/ads/anuncios/b1/adaptar', { formatos: { Reel: 1 }, indicaciones: 'para entrenadores' });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      assert.equal(preguntas[0].conversacion, 'replicar');
      assert.match(preguntas[0].texto, /adaptar A MI ESTILO un anuncio de mi competencia que está funcionando: Rival/);
      assert.match(preguntas[0].texto, /¿Pierdes leads\?/);
      assert.match(preguntas[0].texto, /contestar tarde/);
      assert.match(preguntas[0].texto, /para entrenadores/);
      const lista = await (await fetch(`${base}/api/ads/anuncios?orden=tiempo`)).json();
      assert.deepEqual(lista.anuncios.map((x) => x.id), ['b1']);
    } finally { server.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
