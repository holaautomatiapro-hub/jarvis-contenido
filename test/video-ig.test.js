import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync, statSync } from 'node:fs';
import { rutaFfmpeg } from '../server/diseno/motor.js';
import { analizarVideo, cumpleInstagram, prepararVideoIg } from '../server/integrations/video-ig.js';

test('un vídeo se deja como lo quiere Instagram (H.264 + audio AAC) antes de subirlo', async (t) => {
  const ffmpeg = await rutaFfmpeg();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-vig-'));
  const hacer = (nombre, args) => { const r = path.join(dir, nombre); return spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args, r]).status === 0 ? r : null; };
  const info = (ruta) => analizarVideo(spawnSync(ffmpeg, ['-hide_banner', '-i', ruta]).stderr.toString());
  try {
    // Como los que exportaba el diseño: H.264 sin audio → se le añade una pista en silencio sin volver a codificar
    const sinAudio = hacer('diseno.mp4', ['-f', 'lavfi', '-i', 'testsrc=duration=3:size=1080x1350:rate=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an']);
    if (!sinAudio) return t.skip('No hay ffmpeg con H.264');
    assert.deepEqual({ ...info(sinAudio), fps: Math.round(info(sinAudio).fps), duracion: Math.round(info(sinAudio).duracion) }, { codec: 'h264', pix: 'yuv420p', ancho: 1080, alto: 1350, fps: 30, audio: null, duracion: 3 });
    assert.equal(cumpleInstagram(info(sinAudio)), false);
    const r1 = await prepararVideoIg(sinAudio);
    assert.equal(r1.cambiado, true);
    assert.equal(cumpleInstagram(info(r1.ruta)), true, 'ya lleva audio AAC');
    assert.ok(Math.abs(Number(/Duration: 00:00:([\d.]+)/.exec(spawnSync(ffmpeg, ['-hide_banner', '-i', r1.ruta]).stderr.toString())[1]) - 3) < 0.2, 'misma duración');
    r1.limpiar();
    assert.ok(!existsSync(r1.ruta), 'el temporal se borra');
    // Otro códec y 60+ fps → se vuelve a codificar en H.264 a 30 fps
    const raro = hacer('raro.mp4', ['-f', 'lavfi', '-i', 'testsrc=duration=2:size=1280x720:rate=90', '-c:v', 'mpeg4', '-an']);
    const r2 = await prepararVideoIg(raro);
    const i2 = info(r2.ruta);
    assert.equal(i2.codec, 'h264');
    assert.equal(Math.round(i2.fps), 30);
    assert.ok(cumpleInstagram(i2));
    r2.limpiar();
    // Si ya cumple, se sube tal cual
    const bueno = hacer('bueno.mp4', ['-f', 'lavfi', '-i', 'testsrc=duration=2:size=720x1280:rate=30', '-f', 'lavfi', '-i', 'sine=duration=2', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac']);
    const r3 = await prepararVideoIg(bueno);
    assert.equal(r3.ruta, bueno);
    assert.equal(r3.cambiado, false);
    // Ya cumple pero pesa más de lo que deja Supabase → se comprime hasta que quepa, con la misma duración
    const pesado = hacer('pesado.mp4', ['-f', 'lavfi', '-i', 'testsrc2=duration=6:size=720x1280:rate=30', '-f', 'lavfi', '-i', 'sine=duration=6', '-shortest', '-vf', 'noise=alls=80:allf=t', '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p', '-c:a', 'aac']);
    const max = 1_500_000;
    assert.ok(statSync(pesado).size > max, `el de prueba pesa ${statSync(pesado).size}`);
    assert.ok(cumpleInstagram(info(pesado)));
    const r4 = await prepararVideoIg(pesado, { maxBytes: max });
    assert.equal(r4.cambiado, true);
    assert.ok(statSync(r4.ruta).size <= max, `comprimido pesa ${statSync(r4.ruta).size}`);
    assert.ok(cumpleInstagram(info(r4.ruta)));
    assert.ok(Math.abs(info(r4.ruta).duracion - 6) < 0.3, 'misma duración');
    r4.limpiar();
    // Si cabe, no se toca
    assert.equal((await prepararVideoIg(pesado, { maxBytes: 500_000_000 })).cambiado, false);
    // Lo que no es un vídeo se deja estar (que lo diga Instagram)
    writeFileSync(path.join(dir, 'nada.mp4'), 'x');
    assert.equal((await prepararVideoIg(path.join(dir, 'nada.mp4'))).cambiado, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
