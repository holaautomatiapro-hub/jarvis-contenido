import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { openDb } from '../server/db.js';
import { createVault } from '../server/vault.js';
import { createJarvis } from '../server/jarvis.js';
import { createReferencias } from '../server/referencias.js';
import { createApp } from '../server/index.js';

const nuevo = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-ideas-'));
  const jarvis = createJarvis({ db: openDb(':memory:'), vault: createVault(path.join(dir, 'V')) });
  return { dir, jarvis, limpiar: () => rmSync(dir, { recursive: true, force: true }) };
};

describe('guardar como idea una referencia de la competencia', () => {
  test('solo la idea: título, enlace y caption; la segunda vez no se duplica', async () => {
    const { jarvis, limpiar } = nuevo();
    try {
      const competencia = { detalle: () => ({ id: 'm1', username: 'rival', formato: 'Reels', fecha: '2026-10-01T10:00:00', permalink: 'https://instagram.com/reel/abc/', caption: 'Cómo cerrar 30 clientes\nsin ads', likes: 900, transcripcion: 'Hola, hoy te cuento…' }) };
      const ref = createReferencias({ jarvis, competencia, vaultPath: jarvis.vault.base });
      const r = await ref.guardarComoIdea({ fuente: 'competencia', id: 'm1' });
      assert.equal(r.pieza.estado, 'idea');
      assert.equal(r.pieza.formato, 'Reel');
      assert.equal(r.pieza.titulo, '@rival: Cómo cerrar 30 clientes');
      const nota = jarvis.vault.read(r.nota).contenido;
      assert.match(nota, /https:\/\/instagram\.com\/reel\/abc\//);
      assert.match(nota, /## Caption\n\nCómo cerrar 30 clientes/);
      assert.doesNotMatch(nota, /Transcripción/, 'solo la idea: sin transcripción');
      // Con la transcripción después: la misma idea, y se le añade
      const r2 = await ref.guardarComoIdea({ fuente: 'competencia', id: 'm1', conTranscripcion: true });
      assert.equal(r2.ya, true);
      assert.equal(r2.pieza.id, r.pieza.id);
      assert.match(jarvis.vault.read(r.nota).contenido, /## Transcripción\n\nHola, hoy te cuento…/);
      assert.equal(jarvis.listarPiezas().length, 1);
    } finally { limpiar(); }
  });

  test('carrusel: las imágenes van a la nota y JARVIS lee el texto de cada slide', async () => {
    const { jarvis, limpiar } = nuevo();
    try {
      const slides = [1, 2].map((n) => path.join(jarvis.vault.base, '04-Competencia', 'slides', `${n}.jpg`));
      mkdirSync(path.dirname(slides[0]), { recursive: true });
      for (const s of slides) writeFileSync(s, 'x');
      const competencia = { detalle: () => ({ id: 'm2', username: 'rival', formato: 'Carrusel', hijos: [{}, {}], fecha: '2026-10-01', caption: '5 errores' }), descargarSlides: async () => slides };
      const preguntas = [];
      const asistente = { preguntar: (b) => { preguntas.push(b); return { id: 3 }; } };
      const r = await createReferencias({ jarvis, competencia, asistente, vaultPath: jarvis.vault.base }).guardarComoIdea({ fuente: 'competencia', id: 'm2', conTranscripcion: true });
      assert.equal(r.leyendo, true);
      assert.equal(r.pieza.formato, 'Carrusel');
      assert.match(jarvis.vault.read(r.nota).contenido, /## Slides\n\n!\[\[04-Competencia\/slides\/1\.jpg\]\]\n!\[\[04-Competencia\/slides\/2\.jpg\]\]/);
      assert.equal(preguntas[0].conversacion, 'sistema');
      assert.ok(preguntas[0].texto.includes(slides[1]) && preguntas[0].texto.includes(r.nota) && /Texto de los slides/.test(preguntas[0].texto));
    } finally { limpiar(); }
  });

  test('anuncio con vídeo: se transcribe en segundo plano y se añade a la idea al terminar', async () => {
    const { jarvis, limpiar } = nuevo();
    try {
      const guardadas = [];
      const ads = {
        anuncioCompetencia: () => ({ id: 'a1', pagina: 'Zero Chats', inicio: '2026-07-01', cuerpos: ['Responde en 5 s'], verEnBiblioteca: 'https://www.facebook.com/ads/library/?id=a1', diasActivo: 90, video: '/api/ads/anuncios/a1/medio/video.mp4', imagenes: [] }),
        paraAdaptar: () => ({ video: '/tmp/a1/video.mp4', imagenes: [] }),
        mediosAnuncio: async () => {},
        guardarTranscripcionAnuncio: (id, texto, nota) => guardadas.push([id, texto, nota]),
      };
      let trabajo;
      const adjuntos = {
        encargar: (clave, titulo, fn) => { trabajo = fn({}); return { clave, titulo, estado: 'haciendo' }; },
        verTarea: (t) => ({ clave: t.clave, estado: t.estado }),
        transcribirRuta: async (ruta) => ({ texto: `Lo que se dice en ${path.basename(ruta)}` }),
      };
      const r = await createReferencias({ jarvis, ads, adjuntos, vaultPath: jarvis.vault.base }).guardarComoIdea({ fuente: 'anuncio', id: 'a1', conTranscripcion: true });
      assert.equal(r.tarea.clave, 'idea-anuncio-a1');
      assert.equal(r.pieza.titulo, 'Anuncio Zero Chats: Responde en 5 s');
      await trabajo;
      assert.match(jarvis.vault.read(r.nota).contenido, /## Texto del anuncio\n\nResponde en 5 s[\s\S]*## Transcripción\n\nLo que se dice en video\.mp4/);
      assert.deepEqual(guardadas, [['a1', 'Lo que se dice en video.mp4', r.nota]]);
    } finally { limpiar(); }
  });
});

describe('la ficha de una idea de la competencia y «Replicar» en ella', () => {
  test('se ve el post, el caption y la transcripción; replicar escribe el guion en la misma pieza', async () => {
    const { jarvis, limpiar } = nuevo();
    try {
      const slides = [path.join(jarvis.vault.base, '04-Competencia', 's1.jpg')];
      const m = { id: 'm9', username: 'rival', formato: 'Carrusel', hijos: [{}, {}], fecha: '2026-10-01', permalink: 'https://www.instagram.com/p/DdT0v/', caption: 'Si te preguntas si nos hemos vuelto locos', likes: 165, slides: ['01.jpg', '02.jpg'] };
      const competencia = { detalle: () => m, idPorEnlace: (u) => (u === m.permalink ? 'm9' : null), descargarSlides: async () => slides };
      const preguntas = [];
      let ocupado = false;
      const asistente = { preguntar: (b) => { preguntas.push(b); ocupado = true; return { id: 4 }; }, estado: () => ({ ocupado, ocupadoAqui: ocupado }) };
      const kit = { estado: () => ({ plantillas: [{ id: 'educativo', nombre: 'Educativo', formatos: ['carrusel'] }, { id: 'story-x', nombre: 'Story', formatos: ['story'] }] }) };
      const ref = createReferencias({ jarvis, competencia, asistente, kit, vaultPath: jarvis.vault.base });
      const { pieza } = await ref.guardarComoIdea({ fuente: 'competencia', id: 'm9' });
      jarvis.vault.append(pieza.nota, '\n## Texto de los slides\n\n**Slide 1:** ADS RESEARCH\n');
      const r = ref.referenciaDePieza(pieza.id);
      assert.equal(r.fuente, 'competencia');
      assert.equal(r.enlace, m.permalink);
      assert.equal(r.caption, m.caption);
      assert.equal(r.textoSlides, '**Slide 1:** ADS RESEARCH');
      assert.deepEqual(r.imagenes, ['/api/competencia/publicaciones/m9/slides/01.jpg', '/api/competencia/publicaciones/m9/slides/02.jpg']);
      assert.equal(r.puedeDisenar, true);
      assert.deepEqual(r.plantillas.map((x) => x.id), ['educativo'], 'solo las de carrusel');

      await assert.rejects(ref.replicarEnPieza(pieza.id, { modo: 'completo', plantilla: 'no-existe' }), /no está en tu kit/);
      const x = await ref.replicarEnPieza(pieza.id, { modo: 'completo', plantilla: 'educativo', indicaciones: 'Para entrenadores', cta: { tipo: 'otro', texto: 'Comenta RESEARCH' } });
      const t = preguntas[0].texto;
      assert.equal(preguntas[0].conversacion, 'replicar');
      assert.equal(preguntas[0].modelo, 'opus', 'diseñar va con el modelo grande');
      assert.ok(t.includes(x.ruta) && t.includes(pieza.nota) && t.includes(slides[0]));
      assert.match(t, /plantilla «Educativo» \(id educativo\)/);
      assert.match(t, /pieza_id \d+/);
      assert.match(t, /usa este: «Comenta RESEARCH»/);
      assert.match(t, /Para entrenadores/);
      assert.match(t, /mover_pieza \(id \d+\)/);
      assert.match(t, /No crees otras piezas/);
      assert.equal(ref.referenciaDePieza(pieza.id).replicando, true);
      await assert.rejects(ref.replicarEnPieza(pieza.id, { modo: 'guion' }), /terminando otra petición/);
      ocupado = false;
      await ref.replicarEnPieza(pieza.id, { modo: 'guion' });
      assert.doesNotMatch(preguntas[1].texto, /crear_diseno/, 'solo el guion: sin diseño');
      assert.match(preguntas[1].texto, /el mismo tipo de CTA que la referencia/);
      assert.equal(preguntas[1].modelo, undefined);
    } finally { limpiar(); }
  });

  test('de un reel no se puede replicar completo', async () => {
    const { jarvis, limpiar } = nuevo();
    try {
      const competencia = { detalle: () => ({ id: 'r1', username: 'rival', formato: 'Reels', permalink: 'https://www.instagram.com/reel/x/', caption: 'Hola', transcripcion: 'Lo que dice' }), idPorEnlace: () => 'r1' };
      const asistente = { preguntar: () => ({ id: 1 }), estado: () => ({ ocupado: false }) };
      const ref = createReferencias({ jarvis, competencia, asistente, vaultPath: jarvis.vault.base });
      const { pieza } = await ref.guardarComoIdea({ fuente: 'competencia', id: 'r1' });
      const r = ref.referenciaDePieza(pieza.id);
      assert.equal(r.transcripcion, 'Lo que dice');
      assert.equal(r.esVideo, true);
      assert.equal(r.puedeDisenar, false);
      await assert.rejects(ref.replicarEnPieza(pieza.id, { modo: 'completo' }), /posts y carruseles/);
    } finally { limpiar(); }
  });
});

describe('el guion de una pieza', () => {
  test('el de Replicar se ve y se edita; sin guion se crea su nota en 02-Guiones', () => {
    const { jarvis, limpiar } = nuevo();
    try {
      const nota = jarvis.vault.create('02-Guiones', 'Reel: Mi gancho', '---\ntipo: guion\n---\n# Reel: Mi gancho\n\nGANCHO: hola\n');
      const p = jarvis.crearPieza({ titulo: 'Mi gancho', estado: 'guion', formato: 'Reel', nota });
      const g = jarvis.guionDePieza(p.id);
      assert.equal(g.ruta, nota);
      assert.equal(g.texto, 'GANCHO: hola');
      assert.equal(g.referencia, null);
      jarvis.guardarGuion(p.id, { texto: 'GANCHO: otro\n\nCTA: comenta', modificado: g.modificado });
      assert.equal(readFileSync(path.join(jarvis.vault.base, nota), 'utf8'), '---\ntipo: guion\n---\n# Reel: Mi gancho\n\nGANCHO: otro\n\nCTA: comenta\n', 'la cabecera se conserva');
      // Una idea: su nota es la referencia y el guion va aparte
      const { pieza: idea, nota: notaIdea } = jarvis.guardarIdea({ titulo: '@rival: 5 errores', contenido: 'Referencia', formato: 'Carrusel' });
      assert.equal(jarvis.guionDePieza(idea.id).ruta, null);
      const g2 = jarvis.guardarGuion(idea.id, { texto: 'Slide 1: …' });
      assert.match(g2.ruta, /^02-Guiones\/Carrusel @rival 5 errores\.md$/);
      assert.equal(g2.texto, 'Slide 1: …');
      assert.deepEqual(g2.referencia, { ruta: notaIdea, texto: 'Referencia' });
      assert.equal(jarvis.leerPieza(idea.id).nota, notaIdea, 'la nota de la idea no se pierde');
    } finally { limpiar(); }
  });

  test('API: con IA, JARVIS lo escribe en su nota partiendo de la idea', async () => {
    const { jarvis, limpiar } = nuevo();
    const server = http.createServer();
    try {
      const { pieza } = jarvis.guardarIdea({ titulo: '@rival: 5 errores', contenido: 'Referencia', formato: 'Reel' });
      const preguntas = [];
      let ocupado = false;
      const asistente = { preguntar: (b) => { preguntas.push(b); ocupado = true; return { id: 7 }; }, cancelar() {}, nuevaSesion() {}, estado: () => ({ ocupado, ocupadoAqui: ocupado, eventos: [] }), enMarcha: () => [] };
      await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
      server.on('request', createApp({ jarvis, asistente, port: server.address().port, status: async () => [] }));
      const base = `http://127.0.0.1:${server.address().port}`;
      const pedir = (ruta, metodo = 'GET', body) => fetch(base + ruta, { method: metodo, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
      const r = await pedir(`/api/piezas/${pieza.id}/guion/ia`, 'POST', { indicaciones: 'Más corto' });
      assert.equal(r.status, 200);
      assert.equal(preguntas[0].conversacion, 'guiones');
      assert.ok(preguntas[0].texto.includes(r.ruta) && preguntas[0].texto.includes(pieza.nota) && preguntas[0].texto.includes('Más corto'));
      assert.match(preguntas[0].texto, /Escribe el guion/);
      assert.equal((await pedir(`/api/piezas/${pieza.id}/guion`)).escribiendo, true);
      assert.equal((await pedir(`/api/piezas/${pieza.id}/guion/ia`, 'POST', {})).status, 409, 'una a la vez');
      const g = await pedir(`/api/piezas/${pieza.id}/guion`, 'PUT', { texto: 'A mano' });
      assert.equal(g.texto, 'A mano');
    } finally { server.close(); limpiar(); }
  });
});
