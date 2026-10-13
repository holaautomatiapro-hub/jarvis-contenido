import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, ajustes } from '../server/db.js';
import { createVault, ensureVault } from '../server/vault.js';
import { createJarvis } from '../server/jarvis.js';
import { getConfig } from '../server/config.js';
import { createCompetencia, calcular, limpiarUsuario, leerEnlace, usuarioDePagina } from '../server/integrations/competencia.js';
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
    assert.match(p, /misma idea en cada uno[\s\S]*Nunca frases literales/);
    assert.doesNotMatch(p, /crear_diseno/, 'sin diseñar si no se pide');
    const conDiseno = promptReplicarCompetencia(m, { formatos: { Carrusel: 1, Reel: 1 }, slides, disenar: true });
    assert.match(conDiseno, /ver_kit_diseno[\s\S]*crear_diseno[\s\S]*pieza_id[\s\S]*exportar_diseno/);
    assert.match(conDiseno, /6\. No publiques nada/);
    assert.doesNotMatch(promptReplicarCompetencia(m, { formatos: { Reel: 1 }, disenar: true }), /crear_diseno/, 'un reel no se diseña');
    const r = await c2.paraReplicar('k2');
    assert.match(promptReplicarCompetencia(r.m, { formatos: { Reel: 1 } }), /Transcripción del reel/);
    assert.throws(() => normalizarFormatos({ Reel: 0 }), /al menos un formato/);
    assert.match(promptReplicarPropia({ formato: 'Reels', caption: 'Mi reel', guardados: 90, nota: '03-Transcripciones/x.md' }, { formatos: { Story: 1 } }), /guardados: 90[\s\S]*leer_nota/);
  });
});

describe('replicar desde un enlace', () => {
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  const media = (n) => ({ id: `e${n}`, caption: `Publicación ${n}`, like_count: n, comments_count: 1, media_type: n === 77 ? 'CAROUSEL_ALBUM' : 'IMAGE', timestamp: hace(n), permalink: `https://www.instagram.com/p/COD${n}xx/`, media_url: `https://cdn/e${n}.jpg` });
  let c3, db3, paginas, paginaPublica;
  before(() => {
    db3 = openDb(':memory:');
    paginas = [];
    paginaPublica = '<meta property="og:description" content="1,234 likes, 56 comments - laura.setter on October 1, 2026: &quot;Hola&quot;">';
    const fetchImpl = async (url) => {
      const u = String(url);
      if (u.startsWith('https://www.instagram.com/')) return new Response(paginaPublica, { status: 200 });
      const campos = new URL(u).searchParams.get('fields') || '';
      const usuario = campos.match(/business_discovery\.username\(([^)]+)\)/)?.[1];
      if (usuario === 'personal') return json({ error: { code: 110, message: 'Invalid user id' } }, 400);
      // Una cuenta con carruseles muy largos: Meta no deja pedir más de 10 a la vez
      const limite = Number(campos.match(/limit\((\d+)\)/)?.[1]);
      if (usuario === 'pesada' && limite > 10) return json({ error: { code: 1, message: "Please reduce the amount of data you're asking for, then retry your request" } }, 500);
      const despues = campos.match(/media\.after\(([^)]+)\)/)?.[1] || null;
      paginas.push(`${usuario}:${despues || 'inicio'}`);
      // Dos páginas: en la segunda está el carrusel COD77xx
      const data = despues ? [media(77), media(78)] : [media(1), media(2)];
      return json({ business_discovery: { username: usuario, followers_count: 2000, media: { data, paging: despues ? {} : { cursors: { after: 'CUR1' }, next: 'https://graph/next' } } } });
    };
    c3 = createCompetencia({ db: db3, instagram: instagramFalso, vault: createVault(path.join(dir, 'V3')), env: {}, fetchImpl });
  });

  test('lee los enlaces de Instagram', () => {
    assert.deepEqual(leerEnlace('https://www.instagram.com/reel/ABC123x/?igsh=xyz'), { codigo: 'ABC123x', usuario: null });
    assert.deepEqual(leerEnlace('instagram.com/Laura.Setter/p/ABC123x'), { codigo: 'ABC123x', usuario: 'laura.setter' });
    assert.equal(leerEnlace('https://www.instagram.com/stories/laura/123'), null);
    assert.equal(leerEnlace('https://tiktok.com/@x/video/1'), null);
    assert.equal(usuarioDePagina('<meta property="og:title" content="Laura (@laura.setter) • Instagram">'), 'laura.setter');
    assert.equal(usuarioDePagina('<html>Inicia sesión</html>'), null);
  });

  test('busca la publicación entre las de su cuenta (con varias páginas) y la guarda para replicarla', async () => {
    const d = await c3.porEnlace({ url: 'https://www.instagram.com/p/COD77xx/?igsh=1' });
    assert.equal(d.id, 'e77');
    assert.equal(d.username, 'laura.setter', 'la cuenta sale de su página pública');
    assert.equal(d.formato, 'Carruseles');
    assert.equal(d.seguidores, 2000);
    assert.equal(d.engagement, 3.9, '(77 + 1) / 2000');
    assert.deepEqual(paginas, ['laura.setter:inicio', 'laura.setter:CUR1']);
    assert.deepEqual(c3.traidas().map((m) => m.id), ['e77']);
    assert.equal(c3.resumen().demo, true, 'no se mezcla con la competencia');
    // La segunda vez no vuelve a preguntar a Instagram
    await c3.porEnlace({ url: 'https://instagram.com/p/COD77xx' });
    assert.equal(paginas.length, 2);
  });

  test('si Meta dice que son demasiados datos, pide menos publicaciones por página', async () => {
    paginas = [];
    const d = await c3.porEnlace({ url: 'https://www.instagram.com/pesada/p/COD78xx/' });
    assert.equal(d.id, 'e78');
    assert.deepEqual(paginas, ['pesada:inicio', 'pesada:CUR1'], 'la segunda página ya va con el tamaño que funcionó');
  });

  test('si no sabe de quién es, la pide; las cuentas personales no se pueden traer', async () => {
    paginaPublica = '<html>Inicia sesión</html>';
    await assert.rejects(() => c3.porEnlace({ url: 'https://www.instagram.com/reel/NUEVO99/' }), (e) => e.campo === 'usuario' && /@usuario/.test(e.message));
    await assert.rejects(() => c3.porEnlace({ url: 'https://www.instagram.com/reel/NUEVO99/', usuario: '@personal' }), /no es una cuenta profesional/);
    await assert.rejects(() => c3.porEnlace({ url: 'https://www.instagram.com/reel/NUEVO99/', usuario: 'laura.setter' }), /No encuentro esa publicación entre las últimas de @laura\.setter/);
    await assert.rejects(() => c3.porEnlace({ url: 'hola' }), /enlace de una publicación/);
  });

  test('un reel sin vídeo de Instagram se transcribe con el vídeo subido a mano', async () => {
    db3.prepare("INSERT INTO comp_media (id, username, formato, caption, fecha) VALUES ('r1', 'laura.setter', 'Reels', 'Reel', ?)").run(hace(1));
    const c4 = createCompetencia({ db: db3, instagram: instagramFalso, vault: createVault(path.join(dir, 'V3')), env: { ELEVENLABS_API_KEY: 'x' }, sttImpl: async (buf) => `Dice ${buf.length} bytes` });
    assert.equal(c4.detalle('r1').puedeTranscribir, false);
    await assert.rejects(() => c4.transcribir('r1'), /descárgalo y súbelo/);
    assert.equal((await c4.transcribir('r1', { video: Buffer.from('abcd') })).transcripcion, 'Dice 4 bytes');
  });

  test('MCP: traer_publicacion', async () => {
    const [a, b] = InMemoryTransport.createLinkedPair();
    await buildServer(createJarvis({ db: db3, vault: createVault(path.join(dir, 'V3')) }), { competencia: c3 }).connect(a);
    const cli = new Client({ name: 't', version: '1' });
    await cli.connect(b);
    const r = await cli.callTool({ name: 'traer_publicacion', arguments: { url: 'https://www.instagram.com/p/COD77xx/' } });
    const d = JSON.parse(r.content[0].text);
    assert.equal(d.username, 'laura.setter');
    assert.equal(d.slides.length, 1, 'baja las imágenes del carrusel para leerlas');
  });
});
