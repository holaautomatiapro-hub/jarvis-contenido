import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createFotogramas, desplazamiento, filtroEncuadre, normalizarEncuadre } from '../server/fotograma.js';
import { rutaFfmpeg } from '../server/diseno/motor.js';

describe('Portada del reel: franja del perfil (encuadre)', () => {
  test('encuadre: 0 arriba, 0,5 centro, 1 abajo (en una portada de 1920 de alto, la franja 3:4 mide 1440)', () => {
    assert.equal(desplazamiento(0.5), 0);
    assert.equal(desplazamiento(0), 240); // la franja de arriba baja 240 px hasta el centro
    assert.equal(desplazamiento(1), -240);
    assert.equal(normalizarEncuadre('x'), 0.5);
    assert.equal(normalizarEncuadre(7), 1);
    assert.match(filtroEncuadre(0), /overlay=0:240$/);
    assert.match(filtroEncuadre(0, 360), /scale=360:640.*overlay=0:80$/);
  });

  test('con ffmpeg: la parte elegida acaba en el centro de la portada', async (t) => {
    let bin;
    try { bin = await rutaFfmpeg(); } catch { bin = null; }
    if (!bin) return t.skip('sin ffmpeg');
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'fotograma-test-'));
    try {
      // Vídeo 1080×1920 verde con una franja roja arriba (0–480)
      const video = path.join(tmp, 'reel.mp4');
      spawnSync(bin, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=green:s=1080x1920:d=1', '-vf', 'drawbox=x=0:y=0:w=1080:h=480:color=red:t=fill', '-pix_fmt', 'yuv420p', video]);
      assert.ok(existsSync(video));
      let n = 0;
      const archivos = {
        ruta: (rel) => path.join(tmp, rel),
        guardar: async (stream, { nombre }) => { const f = path.join(tmp, `${n++}-${nombre}`); await pipeline(stream, createWriteStream(f)); return { path: path.basename(f), nombre }; },
      };
      const f = createFotogramas({ archivos });
      // Color de un píxel de la portada
      const pixel = (rel, y) => {
        const r = spawnSync(bin, ['-v', 'error', '-i', path.join(tmp, rel), '-frames:v', '1', '-vf', `crop=w=2:h=2:x=540:y=${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
        const [rr, g] = r.stdout;
        return rr > 150 && g < 100 ? 'rojo' : g > 90 && rr < 100 ? 'verde' : 'otro';
      };
      const centro = await f.comoPortada('reel.mp4', 0.1);
      assert.equal(pixel(centro.path, 500), 'verde'); // sin mover: en el centro hay verde
      const arriba = await f.comoPortada('reel.mp4', 0.1, 0);
      assert.equal(pixel(arriba.path, 500), 'rojo'); // con el recuadro arriba, lo rojo baja a la franja del perfil
      assert.equal(pixel(arriba.path, 1700), 'verde');
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });
});
