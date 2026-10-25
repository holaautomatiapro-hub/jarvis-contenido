import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createReadStream, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { openDb } from '../server/db.js';
import { createVault } from '../server/vault.js';
import { createJarvis } from '../server/jarvis.js';
import { createArchivos } from '../server/archivos.js';
import { createAdjuntos, duracionDe, lineasSubtitulos, textoAdjuntos } from '../server/adjuntos.js';
import { rutaFfmpeg } from '../server/diseno/motor.js';
import { createApp } from '../server/index.js';

let dir, archivos, adjuntos, ffmpeg, video;
const stt = [];
before(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-adj-'));
  archivos = createArchivos({ dir: path.join(dir, 'contenido') });
  adjuntos = createAdjuntos({ archivos, vaultPath: path.join(dir, 'V'), env: { ELEVENLABS_API_KEY: 'x' }, sttImpl: async (buf, { nombre }) => { stt.push(nombre); return `Hola, soy el vídeo ${nombre} (${buf.length > 0 ? 'con audio' : 'vacío'})`; } });
  ffmpeg = await rutaFfmpeg();
  video = path.join(dir, 'prueba.mp4');
  const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=4:size=320x240:rate=10', '-pix_fmt', 'yuv420p', video]);
  if (r.status !== 0) video = null;
});
after(() => rmSync(dir, { recursive: true, force: true }));

describe('adjuntos del chat', () => {
  test('duración desde lo que escribe ffmpeg', () => {
    assert.equal(duracionDe('  Duration: 00:01:02.50, start: 0'), 62.5);
    assert.equal(duracionDe('sin nada'), null);
  });

  test('un vídeo: fotogramas en el vault, transcripción y su url para usarlo en un diseño', async (t) => {
    if (!video) return t.skip('No hay ffmpeg');
    const a = await archivos.guardar(createReadStream(video), { nombre: 'mi reel.mp4', mime: 'video/mp4' });
    const p = await adjuntos.preparar(a);
    assert.equal(p.tipo, 'video');
    assert.equal(Math.round(p.duracion), 4);
    assert.ok(p.fotogramas.length >= 3 && p.fotogramas.length <= 8, `${p.fotogramas.length} fotogramas`);
    assert.ok(p.fotogramas.every((f) => f.includes(path.join('V', '.jarvis', 'adjuntos')) && existsSync(f)));
    assert.match(p.transcripcion, /soy el vídeo mi reel\.mp4/);
    const txt = textoAdjuntos([p]);
    assert.match(txt, /^\n\n\[Adjuntos\]\n/);
    assert.match(txt, /- Vídeo «mi reel\.mp4» \(0:04\)\. Para verlo, sus fotogramas en orden \(léelos con Read\): .*01\.jpg/);
    assert.match(txt, /<video src>\): \/api\/contenido\/archivos\//);
    assert.match(txt, /Lo que se dice:\n"""\nHola/);
  });

  test('una foto: copia en el vault para verla', async () => {
    writeFileSync(path.join(dir, 'f.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const a = await archivos.guardar(createReadStream(path.join(dir, 'f.jpg')), { nombre: 'portada.jpg', mime: 'image/jpeg' });
    const p = await adjuntos.preparar(a);
    assert.equal(p.tipo, 'foto');
    assert.ok(existsSync(p.fotogramas[0]));
    assert.match(textoAdjuntos([p]), /- Foto «portada\.jpg»\. Para verla: Read .*foto\.jpg\. Para usarla en un diseño: \/api\/contenido\/archivos\//);
  });

  test('ver una pieza de la biblioteca: foto copiada y, de cada vídeo, cómo queda al final (y su animación si se pide)', async (t) => {
    if (!video) return t.skip('No hay ffmpeg');
    const v1 = await archivos.guardar(createReadStream(video), { nombre: 'slide-01.mp4', mime: 'video/mp4' });
    const v2 = await archivos.guardar(createReadStream(video), { nombre: 'slide-02.mp4', mime: 'video/mp4' });
    writeFileSync(path.join(dir, 'p.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const f = await archivos.guardar(createReadStream(path.join(dir, 'p.jpg')), { nombre: 'portada.jpg', mime: 'image/jpeg' });
    const pieza = { id: 131, titulo: 'portada carrusel', formato: 'Carrusel', carpeta: 'Testimonio Alfonso / Storytelling carrusel', archivos: [f, v1, v2] };
    const r = await adjuntos.verPieza(pieza);
    assert.equal(r.pieza.diapositivas, 3);
    assert.deepEqual(r.archivos.map((a) => [a.n, a.tipo]), [[1, 'foto'], [2, 'video'], [3, 'video']]);
    assert.ok(r.archivos.every((a) => a.ver.every((x) => x.includes(path.join('V', '.jarvis', 'vistas', '131')) && existsSync(x))));
    assert.deepEqual(r.archivos[1].ver.map((x) => path.basename(x)), ['final.jpg'], 'de toda la pieza, solo cómo queda cada vídeo');
    assert.equal(r.archivos[1].duracion, 4);
    assert.match(r.como_verlo, /Read/);
    // Una diapositiva: su animación (6 repartidos por defecto) y el final
    const una = await adjuntos.verPieza(pieza, { diapositiva: 3 });
    assert.equal(una.archivos.length, 1);
    assert.equal(una.archivos[0].n, 3);
    assert.ok(una.archivos[0].ver.length >= 4 && una.archivos[0].ver.at(-1).endsWith('final.jpg'), una.archivos[0].ver.join(','));
    assert.equal((await adjuntos.verPieza(pieza, { diapositiva: 2, transcribir: true })).archivos[0].transcripcion.includes('slide-01.mp4'), true);
    await assert.rejects(adjuntos.verPieza(pieza, { diapositiva: 9 }), /no tiene la diapositiva 9/);
    // Un vídeo con voz (una entrevista): se transcribe solo su audio, que pesa mucho menos
    const conVoz = path.join(dir, 'entrevista.mp4');
    spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=3:size=320x240:rate=10', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-shortest', '-pix_fmt', 'yuv420p', conVoz]);
    const v3 = await archivos.guardar(createReadStream(conVoz), { nombre: 'entrevista completa.mp4', mime: 'video/mp4' });
    const e = await adjuntos.verPieza({ id: 170, titulo: 'entrevista completa', formato: 'Reel', archivos: [v3] }, { transcribir: true });
    assert.match(e.archivos[0].transcripcion, /soy el vídeo audio\.mp3/);
  });

  test('si ElevenLabs falla (sin créditos) se transcribe gratis con Whisper; al subir un adjunto, solo ElevenLabs', async (t) => {
    if (!video) return t.skip('No hay ffmpeg');
    const usados = [];
    const sinCreditos = async () => { usados.push('ElevenLabs'); throw new Error('Se han acabado los créditos de ElevenLabs'); };
    const whisperImpl = async (ruta) => { usados.push('Whisper'); return `texto de Whisper (${path.basename(ruta)})`; };
    const ad = createAdjuntos({ archivos, vaultPath: path.join(dir, 'W'), env: { ELEVENLABS_API_KEY: 'x' }, sttImpl: sinCreditos, whisperImpl });
    const v = await archivos.guardar(createReadStream(video), { nombre: 'entrevista.mp4', mime: 'video/mp4' });
    const r = await ad.transcribirPieza({ id: 7, titulo: 'Entrevista', archivos: [v] });
    assert.deepEqual(usados, ['ElevenLabs', 'Whisper']);
    assert.match(r.transcripciones[0].texto, /texto de Whisper/);
    assert.equal(r.transcripciones[0].con, 'Whisper');
    // Al subirlo al chat no se espera a Whisper: se avisa de cómo hacerlo después
    usados.length = 0;
    const p = await ad.preparar(await archivos.guardar(createReadStream(video), { nombre: 'adjunto.mp4', mime: 'video/mp4' }));
    assert.deepEqual(usados, ['ElevenLabs']);
    assert.equal(p.transcripcion, null);
    assert.match(textoAdjuntos([p]), /créditos.*transcribir_video con url \/api\/contenido\/archivos\//s);
    // …y transcribir_video lo hace por su url
    usados.length = 0;
    const tv = await ad.transcribirVideo(`${p.url}`);
    assert.match(tv.texto, /texto de Whisper/);
    await assert.rejects(ad.transcribirVideo('/api/contenido/archivos/no/existe.mp4'), /No encuentro/);
    // Con JARVIS_TRANSCRIPCION=whisper, primero Whisper (gratis)
    usados.length = 0;
    const gratis = createAdjuntos({ archivos, vaultPath: path.join(dir, 'W2'), env: { ELEVENLABS_API_KEY: 'x', JARVIS_TRANSCRIPCION: 'whisper' }, sttImpl: sinCreditos, whisperImpl });
    await gratis.transcribirPieza({ id: 8, titulo: 'Otra', archivos: [v] });
    assert.deepEqual(usados, ['Whisper']);
    // Sin clave ni Whisper: lo dice
    const nada = createAdjuntos({ archivos, vaultPath: path.join(dir, 'W3'), env: {} });
    const sin = await nada.transcribirPieza({ id: 9, titulo: 'Nada', archivos: [v] });
    assert.match(sin.transcripciones[0].aviso, /No hay con qué transcribir/);
  });

  test('una transcripción larga va en segundo plano: se pregunta cómo va, sale en «Trabajando» y se puede parar', async (t) => {
    if (!video) return t.skip('No hay ffmpeg');
    // Un Whisper de mentira que tarda hasta que se le deja acabar (o lo paran)
    let acabar;
    const lento = (ruta, tarea) => new Promise((ok, ko) => {
      tarea.progreso = 40;
      acabar = () => ok('la entrevista entera');
      tarea.abort.signal.addEventListener('abort', () => ko(new Error('Parada')));
    });
    const ad = createAdjuntos({ archivos, vaultPath: path.join(dir, 'L'), env: {}, whisperImpl: lento });
    const db = openDb(':memory:');
    const jarvis = createJarvis({ db, vault: createVault(path.join(dir, 'L')) });
    const asistente = { preguntar() {}, cancelar() {}, nuevaSesion() {}, estado: () => ({ ocupado: false, eventos: [] }), enMarcha: () => [] };
    const server = http.createServer();
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
    server.on('request', createApp({ jarvis, archivos, asistente, adjuntos: ad, port: server.address().port, status: async () => [] }));
    const base = `http://127.0.0.1:${server.address().port}`;
    const pedir = async (metodo, ruta, body) => { const r = await fetch(`${base}${ruta}`, { method: metodo, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, data: await r.json() }; };
    try {
      const v = await archivos.guardar(createReadStream(video), { nombre: 'entrevista.mp4', mime: 'video/mp4' });
      const e = jarvis.crearPieza({ titulo: 'entrevista completa', formato: 'Reel', archivos: [v] });
      const r1 = (await pedir('POST', `/api/piezas/${e.id}/transcribir?esperar=200`, {})).data;
      assert.equal(r1.estado, 'haciendo');
      assert.equal(r1.motor, 'Whisper');
      assert.match(r1.aviso, /pregunta otra vez/);
      // Sale en «Trabajando» con su avance y se puede parar
      let { trabajos } = (await pedir('GET', '/api/trabajos')).data;
      const tr = trabajos.find((x) => x.tipo === 'transcribir');
      assert.equal(tr.titulo, 'Transcribiendo «entrevista completa»');
      assert.match(tr.detalle, /Whisper \(gratis\)/);
      assert.equal(tr.progreso, 40);
      assert.equal(tr.parable, true);
      // Pedirla otra vez no la duplica
      assert.equal((await pedir('POST', `/api/piezas/${e.id}/transcribir?esperar=50`, {})).data.inicio, r1.inicio);
      acabar();
      await new Promise((ok) => setTimeout(ok, 50));
      const r2 = (await pedir('GET', `/api/transcripciones?clave=${encodeURIComponent(r1.clave)}`)).data;
      assert.equal(r2.estado, 'listo');
      assert.equal(r2.transcripciones[0].texto, 'la entrevista entera');
      assert.equal(r2.transcripciones[0].con, 'Whisper');
      assert.match(r2.nota, /03-Transcripciones/);
      ({ trabajos } = (await pedir('GET', '/api/trabajos')).data);
      assert.ok(!trabajos.some((x) => x.tipo === 'transcribir'), 'ya no está trabajando');
      // Un vídeo adjunto (por url), parado a medias desde «Trabajando»
      const adj = await archivos.guardar(createReadStream(video), { nombre: 'video1250624609.mp4', mime: 'video/mp4' });
      const r3 = (await pedir('POST', '/api/archivos/transcribir?esperar=100', { url: adj.url })).data;
      assert.equal(r3.estado, 'haciendo');
      assert.equal(r3.titulo, 'Transcribiendo «video1250624609.mp4»');
      assert.equal((await pedir('POST', '/api/trabajos/parar', { id: `transcribir-${r3.clave}` })).status, 200);
      await new Promise((ok) => setTimeout(ok, 50));
      const r4 = await pedir('GET', `/api/transcripciones?clave=${encodeURIComponent(r3.clave)}`);
      assert.equal(r4.status, 400);
      assert.match(r4.data.error, /Has parado/);
      assert.match((await pedir('GET', '/api/transcripciones?clave=nada')).data.error, /vuelve a pedirla/);
    } finally { server.close(); }
  });

  test('subtítulos: se transcribe con los tiempos de cada palabra y salen líneas cortas de un trozo del vídeo', async (t) => {
    if (!video) return t.skip('No hay ffmpeg');
    const palabras = [[94.9, 95.2, 'Bueno,'], [95.6, 95.9, 'antes'], [95.9, 96.3, 'trabajaba'], [96.3, 96.6, 'doce'], [96.6, 97, 'horas.'], [97.3, 97.6, 'Ahora'], [97.6, 98.1, 'tengo'], [98.1, 98.6, 'tiempo'], [130, 131, 'fuera']];
    const llamadas = [];
    const whisperImpl = async (ruta, tarea, { palabras: destino }) => { llamadas.push(destino); if (destino) writeFileSync(destino, JSON.stringify(palabras)); return 'Bueno, antes trabajaba doce horas. Ahora tengo tiempo'; };
    const ad = createAdjuntos({ archivos, vaultPath: path.join(dir, 'S'), env: {}, whisperImpl });
    const v = await archivos.guardar(createReadStream(video), { nombre: 'clip miguel.mp4', mime: 'video/mp4' });
    // Transcrito sin palabras: al pedir subtítulos hay que volver a transcribir (con palabras)
    await ad.transcribirVideo(v.url);
    assert.throws(() => ad.subtitulosVideo(v.url), /aún no está transcrito con los tiempos/);
    await ad.transcribirVideo(v.url, { palabras: true });
    assert.equal(llamadas.length, 2);
    assert.ok(llamadas[1].endsWith('palabras.json'));
    const r = ad.subtitulosVideo(v.url, { desde: 95.5, hasta: 99 });
    assert.deepEqual(r.lineas.map((l) => l.slice(0, 3)), [[0.1, 1.8, 'antes trabajaba doce horas.'], [1.8, 3.5, 'Ahora tengo tiempo']]);
    assert.deepEqual(r.lineas[0][3][0], [0.1, 0.4, 'antes'], 'y cada palabra con su momento, contando desde «desde»');
    assert.match(r.como_usarlas, /subtitulos\(/);
    await ad.transcribirVideo(v.url, { palabras: true });
    assert.equal(llamadas.length, 2, 'con las palabras ya guardadas no se vuelve a transcribir');
    assert.throws(() => ad.subtitulosVideo(v.url, { desde: 200 }), /No se dice nada/);
  });

  test('líneas de subtítulos: cortas, sin pasar de una frase y aguantando hasta la siguiente', () => {
    const l = lineasSubtitulos([[0, 0.3, 'Uno'], [0.3, 0.6, 'dos'], [0.6, 0.9, 'tres'], [0.9, 1.2, 'cuatro'], [1.2, 1.5, 'cinco'], [1.5, 1.8, 'seis.'], [3, 3.4, 'Siete']]);
    assert.deepEqual(l.map((x) => x[2]), ['Uno dos tres cuatro cinco', 'seis.', 'Siete']);
    assert.equal(l[0][1], 1.5, 'se queda hasta que empieza la siguiente');
    assert.equal(l[1][1], 2.2, 'como mucho 0,4 s más si hay un silencio');
  });

  test('API: se sube, se prepara y el mensaje a Claude lleva los adjuntos por su id', async () => {
    const preguntas = [];
    const asistente = { preguntar: (b) => { preguntas.push(b); return { id: 1 }; }, cancelar() {}, nuevaSesion() {}, estado: () => ({ ocupado: false, eventos: [] }) };
    const db = openDb(':memory:');
    const jarvis = createJarvis({ db, vault: createVault(path.join(dir, 'V')) });
    const server = http.createServer();
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
    server.on('request', createApp({ jarvis, archivos, asistente, adjuntos, port: server.address().port, status: async () => [] }));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const r = await fetch(`${base}/api/jarvis/adjuntos?nombre=ref.jpg&mime=image/jpeg`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) });
      const a = await r.json();
      assert.equal(r.status, 200, JSON.stringify(a));
      assert.equal(a.tipo, 'foto');
      const post0 = (ruta, body) => fetch(`${base}${ruta}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const post = (body) => fetch(`${base}/api/jarvis/preguntar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      assert.equal((await post({ texto: '[Diseño #3] usa esta foto en la 2', conversacion: 'diseno', adjuntos: [a.id] })).status, 200);
      assert.match(preguntas[0].texto, /^\[Diseño #3\] usa esta foto en la 2\n\n\[Adjuntos\]\n[\s\S]*Foto «ref\.jpg»/);
      assert.equal(preguntas[0].adjuntos, undefined, 'a Claude solo le llega el texto');
      const caducado = await post({ texto: 'hola', adjuntos: ['nada'] });
      assert.equal(caducado.status, 400);
      assert.match((await caducado.json()).error, /caducado/);
      assert.equal((await fetch(`${base}/api/jarvis/adjuntos?nombre=doc.pdf&mime=application/pdf`, { method: 'POST', body: Readable.from([Buffer.from('x')]), duplex: 'half' })).status, 400, 'solo fotos y vídeos');
      // Ver una pieza por la API (lo que usa la herramienta ver_pieza)
      const foto = await archivos.guardar(Readable.from([Buffer.from([0xff, 0xd8, 0xff, 0xd9])]), { nombre: 'una.jpg', mime: 'image/jpeg' });
      const p = jarvis.crearPieza({ titulo: 'Con foto', formato: 'Post', archivos: [foto] });
      const ver = await (await post0(`/api/piezas/${p.id}/ver`, {})).json();
      assert.equal(ver.archivos[0].tipo, 'foto');
      assert.equal((await post0('/api/piezas/99999/ver', {})).status, 400);
      // Transcribir una pieza: devuelve el texto y lo deja como nota en 03-Transcripciones (una sola vez)
      assert.match((await (await post0(`/api/piezas/${p.id}/transcribir`, {})).json()).error, /no tiene vídeos/);
      if (video) {
        const v = await archivos.guardar(createReadStream(video), { nombre: 'entrevista.mp4', mime: 'video/mp4' });
        const e = jarvis.crearPieza({ titulo: 'entrevista completa', formato: 'Reel', carpeta: 'Miguel/Youtube', archivos: [v] });
        const t1 = await (await post0(`/api/piezas/${e.id}/transcribir`, {})).json();
        assert.match(t1.transcripciones[0].texto, /Hola, soy el vídeo/);
        assert.match(t1.nota, /03-Transcripciones/);
        const notas = () => jarvis.vault.list().filter((n) => /03-Transcripciones/.test(n.ruta || n.path || JSON.stringify(n))).length;
        const antes = notas();
        assert.equal(antes, 1);
        const llamadas = stt.length;
        const t2 = await (await post0(`/api/piezas/${e.id}/transcribir`, {})).json();
        assert.equal(t2.transcripciones[0].texto, t1.transcripciones[0].texto);
        assert.equal(stt.length, llamadas, 'la segunda vez no se vuelve a mandar a ElevenLabs');
        assert.equal(t2.nota, undefined, 'ni se repite la nota');
        assert.equal(notas(), antes);
      }
    } finally { server.close(); }
  });
});
