import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { rutaFfmpeg } from './diseno/motor.js';

// Miniaturas de la biblioteca de Contenido y del Laboratorio: una imagen pequeña (JPG de 360 px) de cada foto y del
// primer fotograma de cada vídeo. Las tarjetas cargan esto en vez del archivo entero: con 100 vídeos en la
// biblioteca, el navegador abría 100 vídeos a la vez y la pestaña se quedaba pillada.
// Se hacen la primera vez que se piden (como mucho 2 a la vez) y se guardan en <dir>; si el archivo cambia
// (mismo nombre, otra fecha), se hace otra.

export const ANCHO_MINIATURA = 360;

// resolver(rel) → ruta absoluta del archivo (o lanza si no es válido)
export function createMiniaturas({ dir, resolver, ffmpeg = rutaFfmpeg, simultaneas = 2, log = () => {} }) {
  const fallos = new Map(); // clave → cuándo falló (no se reintenta en una hora)
  const enCurso = new Map(); // clave → promesa
  let activas = 0;
  const cola = [];
  const turno = () => new Promise((ok) => { if (activas < simultaneas) { activas += 1; ok(); } else cola.push(ok); });
  const soltar = () => { const sig = cola.shift(); if (sig) sig(); else activas -= 1; };

  const correr = (bin, args) => new Promise((ok, mal) => {
    const p = spawn(bin, args, { stdio: 'ignore', windowsHide: true });
    const t = setTimeout(() => p.kill('SIGKILL'), 60_000);
    p.on('error', (e) => { clearTimeout(t); mal(e); });
    p.on('close', (c) => { clearTimeout(t); if (c === 0) ok(); else mal(new Error(`ffmpeg ${c}`)); });
  });

  async function hacer(origen, final) {
    const bin = await ffmpeg();
    const tmp = `${final}.${process.pid}.tmp.jpg`;
    const escala = ['-vf', `scale='min(${ANCHO_MINIATURA},iw)':-2`, '-frames:v', '1', '-q:v', '5', tmp];
    const video = /\.(mp4|mov|m4v|webm|mkv)$/i.test(origen);
    try {
      // En un vídeo, un fotograma del principio (algunos vídeos cortos o raros no dejan saltar: entonces el primero)
      if (video) await correr(bin, ['-v', 'error', '-y', '-ss', '0.1', '-i', origen, ...escala]).catch(() => correr(bin, ['-v', 'error', '-y', '-i', origen, ...escala]));
      else await correr(bin, ['-v', 'error', '-y', '-i', origen, ...escala]);
      if (!existsSync(tmp) || statSync(tmp).size === 0) throw new Error('vacía');
      renameSync(tmp, final);
    } finally { rmSync(tmp, { force: true }); }
  }

  // Dónde va la miniatura de un archivo (depende de su ruta y de cuándo cambió)
  function destino(rel) {
    let origen;
    try { origen = resolver(rel); } catch { return null; }
    if (!origen || !existsSync(origen)) return null;
    const clave = createHash('sha1').update(`${rel}|${Math.round(statSync(origen).mtimeMs)}`).digest('hex').slice(0, 20);
    return { origen, clave, final: path.join(dir, `${clave}.jpg`) };
  }

  // La ruta de la miniatura (la hace si no está) o null si no se puede (HEIC, archivo dañado…)
  async function ruta(rel) {
    const d = destino(rel);
    if (!d) return null;
    if (existsSync(d.final)) return d.final;
    if (Date.now() - (fallos.get(d.clave) || 0) < 3600_000) return null;
    if (!enCurso.has(d.clave)) {
      enCurso.set(d.clave, (async () => {
        await turno();
        try {
          if (existsSync(d.final)) return d.final;
          mkdirSync(dir, { recursive: true });
          await hacer(d.origen, d.final);
          return d.final;
        } catch (e) {
          fallos.set(d.clave, Date.now());
          log(`Sin miniatura para ${rel}: ${e.message}`);
          return null;
        } finally { soltar(); enCurso.delete(d.clave); }
      })());
    }
    return enCurso.get(d.clave);
  }

  // Al arrancar: las que falten, de una en una y sin prisa (así la primera visita ya va rápida)
  async function preparar(rels) {
    for (const rel of rels) {
      try {
        const d = destino(rel);
        if (!d || existsSync(d.final)) continue;
        await ruta(rel);
        await new Promise((ok) => { setTimeout(ok, 150).unref?.(); });
      } catch { /* la siguiente */ }
    }
  }

  return { ruta, preparar };
}
