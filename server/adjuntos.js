import path from 'node:path';
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { rutaFfmpeg } from './diseno/motor.js';
import { sttConfigurado, transcribir as transcribirElevenLabs } from './stt.js';

// Adjuntos del chat: fotos y vídeos que la persona manda a JARVIS para que los tenga en cuenta (p. ej. al cambiar
// un carrusel). Se guardan en la biblioteca de archivos (así se pueden poner en un diseño con su url) y, para que
// Claude los «vea», se deja en el vault (.jarvis/adjuntos/) la foto o unos fotogramas del vídeo, y su transcripción.

const FOTOGRAMAS = 8;
const MAX_TRANSCRIBIR = 300 * 1024 ** 2; // más grande no se manda a transcribir
const MAX_TEXTO = 6000;

// Ejecuta ffmpeg y devuelve lo que escribe en stderr (ahí dice la duración)
function ejecutar(bin, args) {
  return new Promise((ok, ko) => {
    let err = '';
    let p;
    try { p = spawn(bin, args, { windowsHide: true }); } catch (e) { ko(e); return; }
    p.stderr.on('data', (d) => { err += d; if (err.length > 200_000) err = err.slice(-100_000); });
    p.on('error', ko);
    p.on('close', (code) => ok({ code, err }));
  });
}
export const duracionDe = (stderr) => {
  const m = String(stderr).match(/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
};
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

export function createAdjuntos({ archivos, vaultPath, env = process.env, ffmpeg = rutaFfmpeg, sttImpl = transcribirElevenLabs, fetchImpl = fetch }) {
  const base = path.join(vaultPath, '.jarvis', 'adjuntos');

  async function fotogramas(origen, dir) {
    const bin = await ffmpeg();
    const info = await ejecutar(bin, ['-hide_banner', '-i', origen]).catch(() => null);
    if (!info) return { fotos: [], duracion: null, aviso: 'No encuentro ffmpeg: JARVIS no puede sacar fotogramas del vídeo' };
    const duracion = duracionDe(info.err);
    // Fotogramas repartidos por todo el vídeo (en uno corto, uno por segundo como mucho)
    const fps = duracion ? Math.min(1, FOTOGRAMAS / duracion) : 0.5;
    await ejecutar(bin, ['-hide_banner', '-loglevel', 'error', '-y', '-i', origen, '-vf', `fps=${fps.toFixed(4)},scale=720:-2`, '-frames:v', String(FOTOGRAMAS), '-q:v', '4', path.join(dir, '%02d.jpg')]).catch(() => null);
    const fotos = readdirSync(dir).filter((f) => /^\d{2}\.jpg$/.test(f)).sort().map((f) => path.join(dir, f));
    return { fotos, duracion, aviso: fotos.length ? null : 'No he podido sacar fotogramas del vídeo' };
  }

  // a: lo que devuelve archivos.guardar. Devuelve lo que necesita Claude para tenerlo en cuenta.
  async function preparar(a) {
    const origen = archivos.ruta(a.path);
    const dir = path.join(base, path.basename(a.path).replace(/\.[^.]+$/, '').replace(/[^\w-]/g, '_'));
    mkdirSync(dir, { recursive: true });
    const r = { nombre: a.nombre, url: a.url, mime: a.mime, tipo: a.mime.startsWith('video/') ? 'video' : 'foto', fotogramas: [], transcripcion: null, duracion: null, avisos: [] };
    if (r.tipo === 'foto') {
      const copia = path.join(dir, `foto${path.extname(origen) || '.jpg'}`);
      copyFileSync(origen, copia);
      r.fotogramas = [copia];
      return r;
    }
    const f = await fotogramas(origen, dir);
    Object.assign(r, { fotogramas: f.fotos, duracion: f.duracion });
    if (f.aviso) r.avisos.push(f.aviso);
    if (!sttConfigurado(env)) r.avisos.push('Sin clave de ElevenLabs no se transcribe lo que se dice en el vídeo');
    else if (statSync(origen).size > MAX_TRANSCRIBIR) r.avisos.push('El vídeo es demasiado grande para transcribirlo');
    else {
      try { r.transcripcion = (await sttImpl(readFileSync(origen), { nombre: a.nombre, tipo: a.mime, env, fetchImpl })) || null; } catch (e) { r.avisos.push(`No se ha podido transcribir: ${e.message}`); }
    }
    return r;
  }

  return { preparar };
}

// El bloque que se añade al mensaje para Claude. La interfaz lo reconoce por «[Adjuntos]» y enseña solo los nombres.
export function textoAdjuntos(lista = []) {
  if (!lista.length) return '';
  const lineas = lista.map((a) => {
    if (a.tipo === 'foto') return `- Foto «${a.nombre}». Para verla: Read ${a.fotogramas[0]}. Para usarla en un diseño: ${a.url}`;
    const partes = [`- Vídeo «${a.nombre}»${a.duracion ? ` (${mmss(a.duracion)})` : ''}.`];
    if (a.fotogramas.length) partes.push(`Para verlo, sus fotogramas en orden (léelos con Read): ${a.fotogramas.join(', ')}.`);
    partes.push(`Para usarlo en un diseño (en <video src>): ${a.url}.`);
    if (a.transcripcion) partes.push(`Lo que se dice:\n"""\n${String(a.transcripcion).slice(0, MAX_TEXTO)}\n"""`);
    else if (a.avisos?.length) partes.push(`(${a.avisos.join('; ')})`);
    return partes.join(' ');
  });
  return `\n\n[Adjuntos]\nTenlos en cuenta para lo que te pido. Míralos antes de responder.\n${lineas.join('\n')}`;
}
