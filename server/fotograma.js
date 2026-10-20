import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { rutaFfmpeg } from './diseno/motor.js';

// La portada de un reel sacada de un fotograma del vídeo (como en Metricool: eliges el momento con la barra).
// Se saca con ffmpeg, así vale para cualquier vídeo aunque el navegador no sepa abrirlo (p. ej. un .mov HEVC del
// iPhone): para ver el momento elegido, una vista previa pequeña; para la portada, un JPG de hasta 1080 px de
// ancho (lo que Instagram acepta), guardado junto a los demás archivos de Contenido.

const publico = (m) => Object.assign(new Error(m), { publico: true });

function correr(bin, args, ejecutar, { conSalida = false } = {}) {
  return new Promise((ok, mal) => {
    const p = ejecutar(bin, args, { stdio: ['ignore', 'ignore', conSalida ? 'pipe' : 'ignore'], windowsHide: true });
    let err = '';
    p.stderr?.on('data', (d) => { if (err.length < 20000) err += d; });
    const t = setTimeout(() => p.kill('SIGKILL'), 60_000);
    p.on('error', (e) => { clearTimeout(t); mal(e); });
    p.on('close', (c) => { clearTimeout(t); if (c === 0 || conSalida) ok(err); else mal(new Error(`ffmpeg ${c}`)); });
  });
}

// Un fotograma a un JPG (en `destino`); si el vídeo no deja saltar justo ahí, se busca leyendo (más lento)
async function sacar({ origen, segundo, ancho, destino, ffmpeg, ejecutar }) {
  const bin = await ffmpeg();
  const s = String(Math.max(0, Number(segundo) || 0));
  const salida = ['-frames:v', '1', '-vf', `scale='min(${ancho},iw)':-2`, '-q:v', ancho > 500 ? '2' : '5', destino];
  const hay = () => existsSync(destino) && statSync(destino).size > 0;
  await correr(bin, ['-v', 'error', '-y', '-ss', s, '-i', origen, ...salida], ejecutar).catch(() => {});
  if (!hay()) await correr(bin, ['-v', 'error', '-y', '-i', origen, '-ss', s, ...salida], ejecutar).catch(() => {});
  if (!hay()) throw publico('No he podido sacar ese fotograma del vídeo. Prueba en otro momento del vídeo o sube una imagen.');
}

const conTmp = async (fn) => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'jarvis-fotograma-'));
  try { return await fn(tmp); } finally { rmSync(tmp, { recursive: true, force: true }); }
};
const videoDe = (archivos, rel) => {
  if (!/\.(mp4|mov|m4v|webm)$/i.test(String(rel || ''))) throw publico('Elige un vídeo');
  const origen = archivos.ruta(rel);
  if (!existsSync(origen)) throw publico('Ese vídeo ya no está');
  return origen;
};

export function createFotogramas({ archivos, ffmpeg = rutaFfmpeg, ejecutar = spawn }) {
  // La portada: se guarda en Contenido y se devuelve como un archivo más
  const comoPortada = (rel, segundo) => conTmp(async (tmp) => {
    const destino = path.join(tmp, 'portada.jpg');
    await sacar({ origen: videoDe(archivos, rel), segundo, ancho: 1080, destino, ffmpeg, ejecutar });
    const base = path.basename(rel).replace(/^\d{13}-[a-f0-9]{6}_/, '').replace(/\.[^.]*$/, '');
    const s = Math.max(0, Number(segundo) || 0);
    return archivos.guardar(createReadStream(destino), { nombre: `portada-${base}-${s.toFixed(1).replace('.', '_')}s.jpg`, mime: 'image/jpeg' });
  });
  // Vista previa (pequeña, no se guarda): los bytes del JPG
  const vistaPrevia = (rel, segundo) => conTmp(async (tmp) => {
    const destino = path.join(tmp, 'previa.jpg');
    await sacar({ origen: videoDe(archivos, rel), segundo, ancho: 360, destino, ffmpeg, ejecutar });
    return readFileSync(destino);
  });
  // Cuánto dura el vídeo (en segundos), leído de lo que cuenta ffmpeg
  const duracion = async (rel) => {
    const err = await correr(await ffmpeg(), ['-hide_banner', '-i', videoDe(archivos, rel)], ejecutar, { conSalida: true }).catch(() => '');
    const m = String(err).match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
  };
  return { comoPortada, vistaPrevia, duracion };
}
