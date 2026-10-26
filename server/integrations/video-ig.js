import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { rutaFfmpeg } from '../diseno/motor.js';

// Deja un vídeo como lo quiere la API de Instagram antes de subirlo: MP4 con H.264 (yuv420p, hasta 1080 de ancho
// y 60 fps) y sonido AAC. Instagram rechaza sin más explicación («Media upload has failed…») los que no cumplen;
// p. ej. un vídeo sin pista de audio en un carrusel. Si ya cumple, se sube tal cual.
// Y que quepa en Supabase, por donde pasa camino de Instagram: el plan gratis no deja subir archivos de más de 50 MB
// (SUPABASE_MAX_MB si tu plan deja más). Si pesa más, se comprime con la calidad justa para que quepa.

const limite = () => (Number(process.env.SUPABASE_MAX_MB) || 50) * 1e6 * 0.96;
const pesa = (f) => { try { return statSync(f).size; } catch { return 0; } };

const correr = (bin, args) => new Promise((ok) => {
  let err = '';
  let p;
  try { p = spawn(bin, args, { windowsHide: true }); } catch (e) { ok({ code: 1, err: e.message }); return; }
  p.stderr.on('data', (d) => { err = (err + d).slice(-20000); });
  p.on('error', (e) => ok({ code: 1, err: e.message }));
  p.on('close', (code) => ok({ code, err }));
});

// Lo que dice ffmpeg al abrirlo: códec, formato de color, tamaño, fps, si tiene audio y de qué tipo
export function analizarVideo(stderr) {
  const linea = /Stream #[^\n]*Video: [^\n]*/.exec(String(stderr))?.[0];
  if (!linea) return null;
  const tam = /\b(\d{2,5})x(\d{2,5})\b/.exec(linea);
  const fps = /([\d.]+) fps/.exec(linea);
  return {
    codec: /Video: (\w+)/.exec(linea)[1], pix: /\b(yuv\w+?|rgb\w+?|nv12|gray)\b(?=[(,\s])/.exec(linea)?.[1] || null,
    ancho: tam ? Number(tam[1]) : null, alto: tam ? Number(tam[2]) : null, fps: fps ? Number(fps[1]) : null,
    audio: /Stream #[^\n]*Audio: (\w+)/.exec(String(stderr))?.[1] || null,
    duracion: (([, h, m, sg]) => (sg ? Number(h) * 3600 + Number(m) * 60 + Number(sg) : null))(/Duration: (\d+):(\d+):([\d.]+)/.exec(String(stderr)) || []),
  };
}

export function cumpleInstagram(info) {
  return Boolean(info && info.codec === 'h264' && info.pix === 'yuv420p' && (info.ancho || 0) <= 1920 && (!info.fps || info.fps <= 60) && info.audio === 'aac');
}

// Devuelve { ruta, limpiar }: la del vídeo ya preparado (temporal) o la original si ya cumplía o no se puede leer
export async function prepararVideoIg(ruta, { ffmpeg = rutaFfmpeg, maxBytes = limite() } = {}) {
  const nada = { ruta, limpiar: () => {}, cambiado: false };
  const bin = await ffmpeg().catch(() => null);
  if (!bin) return nada;
  const info = analizarVideo((await correr(bin, ['-hide_banner', '-i', ruta])).err);
  if (!info || (cumpleInstagram(info) && pesa(ruta) <= maxBytes)) return nada;
  const dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-ig-'));
  const limpiar = () => rmSync(dir, { recursive: true, force: true });
  const formatoOk = info.codec === 'h264' && info.pix === 'yuv420p' && info.ancho <= 1920 && (!info.fps || info.fps <= 60);
  // video: los argumentos del vídeo (copiar, calidad fija o kbps para que quepa)
  const codificar = async (nombre, video) => {
    const salida = path.join(dir, nombre);
    const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', ruta];
    // Sin audio: se le pone una pista en silencio
    if (!info.audio) args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
    args.push('-map', '0:v:0', '-map', info.audio ? '0:a:0' : '1:a:0', ...video);
    args.push('-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2', '-shortest', '-movflags', '+faststart', salida);
    const r = await correr(bin, args);
    return r.code === 0 && existsSync(salida) ? salida : null;
  };
  const h264 = ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-vf', "scale='min(1080,iw)':-2,fps=30", '-profile:v', 'high'];
  let listo = cumpleInstagram(info) ? ruta
    : await codificar('instagram.mp4', formatoOk ? ['-c:v', 'copy'] : [...h264, '-crf', '20', '-maxrate', '12M', '-bufsize', '24M']);
  // Demasiado pesado para Supabase: se calcula cuánto puede ocupar cada segundo y se vuelve a codificar
  if (listo && pesa(listo) > maxBytes && info.duracion) {
    for (const margen of [0.9, 0.75, 0.6]) {
      const kbps = Math.floor((maxBytes * 8 * margen) / info.duracion / 1000) - 128;
      if (kbps < 250) break;
      const ligero = await codificar(`ligero-${margen}.mp4`, [...h264, '-b:v', `${kbps}k`, '-maxrate', `${Math.round(kbps * 1.3)}k`, '-bufsize', `${kbps * 2}k`]);
      if (!ligero) break;
      listo = ligero;
      if (pesa(ligero) <= maxBytes) break;
    }
  }
  if (!listo || listo === ruta) { limpiar(); return nada; }
  return { ruta: listo, limpiar, cambiado: true };
}
