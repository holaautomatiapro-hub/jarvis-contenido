import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, ajustes } from '../server/db.js';
import { createVault, ensureVault } from '../server/vault.js';
import { createJarvis } from '../server/jarvis.js';
import { getConfig } from '../server/config.js';
import { createCompetencia, calcular, limpiarUsuario } from '../server/integrations/competencia.js';
import { buildServer } from '../mcp/jarvis-mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const hace = (d) => new Date(Date.now() - d * 86400000).toISOString();

// Simulador de Business Discovery
function metaFalsa() {
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  const PERFILES = {
    marcauno: { username: 'marcauno', name: 'Marca Uno', biography: 'Chatbots', followers_count: 10000, media_count: 3, media: { data: [
      { id: 'z1', caption: 'Tu competencia ya responde en 5 segundos. ¿Y tú?', like_count: 900, comments_count: 100, media_type: 'VIDEO', media_product_type: 'REELS', timestamp: hace(1), permalink: 'https://ig/z1', thumbnail_url: 'https://cdn/z1.jpg' },
      { id: 'z2', caption: '5 respuestas que cierran ventas', like_count: 300, comments_count: 50, media_type: 'CAROUSEL_ALBUM', timestamp: hace(8), permalink: 'https://ig/z2', media_url: 'https://cdn/z2.jpg' },
    ] } },
    marcados: { username: 'marcados', name: 'Marca Dos', followers_count: 20000, media_count: 1, media: { data: [
      { id: 's1', caption: 'Así automatizamos 300 DMs al día.', like_count: 500, comments_count: 100, media_type: 'VIDEO', media_product_type: 'REELS', timestamp: hace(3), permalink: 'https://ig/s1' },
    ] } },
  };
  let pedidas = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    const campos = u.searchParams.get('fields') || '';
    const m = campos.match(/business_discovery\.username\(([^)]+)\)/);
    pedidas.push(m?.[1]);
    if (u.searchParams.get('access_token') !== 'TP') return json({ error: { code: 190, message: 'expired' } }, 400);
    if (!m || !PERFILES[m[1]]) return json({ error: { code: 110, message: 'Invalid user id' } }, 400);
    return json({ business_discovery: PERFILES[m[1]], id: 'ig1' });
  };
  return { fetchImpl, pedidas: () => pedidas };
}

let dir, db, vault, comp, meta, conectado = true;
const instagramFalso = { conexion: () => (conectado ? { token: 'TP', igUserId: 'ig1' } : null), estado: () => ({ conectado }) };

before(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-comp-'));
  const cfg = getConfig({});
  ensureVault(path.join(dir, 'V'), cfg.templateDir, cfg.mcpScript);
  db = openDb(':memory:');
  vault = createVault(path.join(dir, 'V'));
  meta = metaFalsa();
  comp = createCompetencia({ db, instagram: instagramFalso, vault, env: { COMPETIDORES: '@marcauno, marcados,  mal usuario!' }, fetchImpl: meta.fetchImpl });
});
after(() => rmSync(dir, { recursive: true, force: true }));

describe('perfiles', () => {
  test('limpia usuarios y enlaces', () => {
    assert.equal(limpiarUsuario('@MarcaUno'), 'marcauno');
    assert.equal(limpiarUsuario('https://www.instagram.com/marcados/?hl=es'), 'marcados');
  });

  test('carga los competidores de .env la primera vez (ignorando los no válidos)', () => {
    assert.deepEqual(comp.resumen().perfiles.map((p) => p.username), ['marcauno', 'marcados']);
    // Si la persona los borra, no vuelven a aparecer al reiniciar
    const otra = createCompetencia({ db, instagram: instagramFalso, vault, env: { COMPETIDORES: 'marcauno' }, fetchImpl: meta.fetchImpl });
    assert.equal(otra.resumen().perfiles.length, 2);
    assert.equal(ajustes(db).leer('comp_sembrado'), true);
  });

  test('sin datos reales: ejemplo con perfiles ficticios, nunca con los reales', () => {
    const r = comp.resumen();
    assert.equal(r.demo, true);
    assert.ok(r.perfilesDemo.every((p) => p.username.startsWith('ejemplo.')));
    assert.ok(r.mejoresGanchos.every((g) => g.username.startsWith('ejemplo.')));
  });

  test('añadir valida el usuario', () => {
    assert.throws(() => comp.anadir('no vale!'), /usuario de Instagram válido/);
    assert.equal(comp.anadir('@NoExiste').username, 'noexiste');
  });
});

describe('sincronización', () => {
  test('sin Instagram conectado da un error claro', async () => {
    conectado = false;
    await assert.rejects(comp.sincronizar(), /Conecta tu Instagram/);
    conectado = true;
  });

  test('trae los datos públicos y marca los perfiles que no se pueden analizar', async () => {
    const r = await comp.sincronizar();
    assert.equal(r.perfiles, 2);
    assert.equal(r.publicaciones, 3);
    assert.equal(r.errores[0].username, 'noexiste');
    assert.match(r.errores[0].error, /cuenta profesional/);
    const res = comp.resumen();
    assert.equal(res.demo, false);
    assert.equal(res.perfiles.find((p) => p.username === 'marcauno').seguidores, 10000);
  });

  test('engagement, mejores ganchos, formatos y frecuencia', () => {
    const r = comp.resumen();
    assert.equal(r.mejoresGanchos[0].id, 'z1'); // 1000/10000 = 10 %
    assert.equal(r.mejoresGanchos[0].engagement, 10);
    assert.equal(r.mejoresGanchos[0].gancho, 'Tu competencia ya responde en 5 segundos.');
    const reels = r.formatos.find((f) => f.formato === 'Reels');
    assert.equal(reels.piezas, 2);
    assert.equal(reels.engagementMedio, (10 + 3) / 2);
    assert.ok(r.frecuencia.find((f) => f.username === 'marcauno').porSemana > 0);
  });

  test('excluir un perfil lo saca del análisis', () => {
    comp.activar('marcados', false);
    assert.ok(!comp.resumen().mejoresGanchos.some((g) => g.username === 'marcados'));
    assert.ok(!comp.datosParaAnalisis().perfiles.some((p) => p.username === 'marcados'));
    comp.activar('marcados', true);
  });

  test('quitar borra el perfil y sus publicaciones', async () => {
    comp.quitar('noexiste');
    assert.ok(!comp.resumen().perfiles.some((p) => p.username === 'noexiste'));
  });
});

describe('análisis de JARVIS (MCP)', () => {
  test('competencia_datos y guardar_analisis_competencia → dashboard y nota en 04-Competencia', async () => {
    const [a, b] = InMemoryTransport.createLinkedPair();
    await buildServer(createJarvis({ db, vault }), { competencia: comp }).connect(a);
    const c = new Client({ name: 't', version: '1' });
    await c.connect(b);
    const datos = JSON.parse((await c.callTool({ name: 'competencia_datos', arguments: {} })).content[0].text);
    assert.equal(datos.publicaciones[0].id, 'z1');
    const r = await c.callTool({ name: 'guardar_analisis_competencia', arguments: {
      perfiles: ['marcauno', 'marcados'], resumen: 'Ganan los vídeos de velocidad de respuesta.',
      temas: [{ tema: 'Velocidad de respuesta', pct: 60, detalle: 'Comparar tiempos' }],
      patrones: [{ titulo: 'Comparación', detalle: '"Tu competencia ya…"' }],
      ideas: [{ titulo: 'Mido cuánto tardan 10 negocios en responder', formato: 'Reel', gancho: 'Solo 2 de 10 contestaron.', porque: 'Experimento propio', inspiradoEn: 'z1' }],
    } });
    assert.ok(!r.isError, r.content[0].text);
    const res = comp.resumen();
    assert.equal(res.analisis.temas[0].tema, 'Velocidad de respuesta');
    assert.equal(res.analisis.ideas[0].inspiradoEn, 'z1');
    const nota = vault.read(res.analisis.nota).contenido;
    assert.match(nota, /perfiles: @marcauno, @marcados/);
    assert.match(nota, /## Ideas adaptadas a mi negocio/);
  });
});

describe('cálculo', () => {
  test('sin seguidores no inventa engagement', () => {
    const r = calcular([{ username: 'x', seguidores: 0 }], [{ id: '1', username: 'x', likes: 10, comentarios: 1, formato: 'Reels', fecha: hace(1), gancho: 'Hola' }]);
    assert.equal(r.publicaciones[0].engagement, null);
  });
});

describe('mejores publicaciones, slides, transcripción y replicar', () => {
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  const jpg = () => new Response(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), { status: 200 });
  let c2, db2, vault2, pedidos;
  before(async () => {
    db2 = openDb(':memory:');
    vault2 = createVault(path.join(dir, 'V2'));
    pedidos = [];
    const fetchImpl = async (url) => {
      const u = String(url);
      if (u.startsWith('https://cdn/')) return u.includes('caducado') ? new Response('', { status: 403 }) : jpg();
      const campos = new URL(u).searchParams.get('fields') || '';
      pedidos.push(campos.includes('view_count') ? 'con-vistas' : campos.includes('children') ? 'con-slides' : 'basico');
      // Esta versión de la API no deja pedir view_count de otros perfiles
      if (campos.includes('view_count')) return json({ error: { code: 100, message: '(#100) Tried accessing nonexisting field (view_count) on node type (ShadowIGMedia)' } }, 400);
      return json({ business_discovery: { username: 'zerochats', followers_count: 1000, media: { data: [
        { id: 'k1', caption: 'Carrusel top', like_count: 50, comments_count: 70, media_type: 'CAROUSEL_ALBUM', timestamp: hace(2), permalink: 'https://ig/k1', media_url: 'https://cdn/k1.jpg',
          children: { data: [{ media_type: 'IMAGE', media_url: 'https://cdn/k1-1.jpg' }, { media_type: 'VIDEO', media_url: 'https://cdn/k1-2.mp4', thumbnail_url: 'https://cdn/k1-2.jpg' }] } },
        { id: 'k2', caption: 'Reel con más likes', like_count: 300, comments_count: 5, media_type: 'VIDEO', media_product_type: 'REELS', timestamp: hace(1), media_url: 'https://cdn/k2.mp4', thumbnail_url: 'https://cdn/k2.jpg' },
      ] } } });
    };
    const sttImpl = async () => 'Hola, esto es lo que dice el reel.';
    c2 = createCompetencia({ db: db2, instagram: instagramFalso, vault: vault2, env: { COMPETIDORES: 'zerochats', ELEVENLABS_API_KEY: 'x' }, fetchImpl, sttImpl });
    await c2.sincronizar();
  });

  test('si la API no deja pedir visualizaciones, baja un nivel de campos y lo recuerda', async () => {
    assert.deepEqual(pedidos, ['con-vistas', 'con-slides']);
    assert.equal(ajustes(db2).leer('comp_nivel_campos'), 1);
    await c2.sincronizar();
    assert.deepEqual(pedidos.slice(2), ['con-slides'], 'la segunda vez ya no pide view_count');
  });

  test('ordena por la métrica que elijas', () => {
    assert.deepEqual(c2.mejores({ orden: 'likes' }).map((m) => m.id), ['k2', 'k1']);
    assert.deepEqual(c2.mejores({ orden: 'comentarios' }).map((m) => m.id), ['k1', 'k2']);
    assert.deepEqual(c2.mejores({ formato: 'Reels' }).map((m) => m.id), ['k2']);
    const r = c2.resumen();
    assert.equal(r.publicaciones.find((m) => m.id === 'k1').slides, 2);
    assert.equal(r.publicaciones[0].transcripcion, undefined, 'la lista va sin textos largos');
  });

  test('slides del carrusel al vault (de un vídeo, su miniatura) y transcripción del reel a 04-Competencia', async () => {
    const slides = await c2.descargarSlides('k1');
    assert.deepEqual(slides.map((f) => path.basename(f)), ['01.jpg', '02.jpg']);
    assert.equal(c2.detalle('k1').slides.length, 2);
    assert.equal(c2.rutaSlide('k1', '../x.jpg'), null);
    const t = await c2.transcribir('k2');
    assert.match(t.nota, /^04-Competencia\/@zerochats /);
    assert.match(vault2.read(t.nota).contenido, /lo que dice el reel/);
    assert.equal(c2.detalle('k2').transcripcion, 'Hola, esto es lo que dice el reel.');
    await assert.rejects(() => c2.transcribir('demo-c1'), /ejemplo/);
  });

  test('replicar: el prompt lleva caption, transcripción, slides y formatos', async () => {
    const { promptReplicarCompetencia, promptReplicarPropia, normalizarFormatos } = await import('../server/replicar.js');
    const { m, slides } = await c2.paraReplicar('k1');
    const p = promptReplicarCompetencia(m, { formatos: { Carrusel: 2, Reel: 0, Inventado: 3 }, indicaciones: 'para clínicas', slides });
    assert.match(p, /Carrusel × 2/);
    assert.doesNotMatch(p, /Reel ×|Inventado/);
    assert.match(p, /\.jarvis\/competencia\/k1\/01\.jpg/);
    assert.match(p, /para clínicas/);
    assert.match(p, /NO la copies/);
    const r = await c2.paraReplicar('k2');
    assert.match(promptReplicarCompetencia(r.m, { formatos: { Reel: 1 } }), /Transcripción del reel/);
    assert.throws(() => normalizarFormatos({ Reel: 0 }), /al menos un formato/);
    assert.match(promptReplicarPropia({ formato: 'Reels', caption: 'Mi reel', guardados: 90, nota: '03-Transcripciones/x.md' }, { formatos: { Story: 1 } }), /guardados: 90[\s\S]*leer_nota/);
  });
});
