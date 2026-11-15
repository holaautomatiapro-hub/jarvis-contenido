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

// La cuadrícula del perfil enseña la franja 3:4 del centro de la portada (1080×1440 de 1080×1920). «encuadre» dice qué
// franja quieres que salga ahí: 0 = la de arriba del todo, 0,5 = la del centro (sin tocar nada), 1 = la de abajo.
// Para que se vea esa franja, la imagen se desplaza hasta dejarla en el centro y el hueco que queda arriba o abajo
// se rellena con el mismo fotograma difuminado.
export const ALTO = 1920;
export const FRANJA = 1440;
export function normalizarEncuadre(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5;
}
export function desplazamiento(encuadre) {
  const recorrido = ALTO - FRANJA; // 480
  return Math.round(recorrido / 2 - normalizarEncuadre(encuadre) * recorrido);
}
export function filtroEncuadre(encuadre, ancho = 1080) {
  const alto = Math.round((ancho * ALTO) / 1080 / 2) * 2;
  const dy = Math.round((desplazamiento(encuadre) * alto) / ALTO);
  return `[0:v]scale=${ancho}:${alto}:force_original_aspect_ratio=decrease,pad=${ancho}:${alto}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,split[fondo][foto];`
    + `[fondo]boxblur=40:4[difuminado];[difuminado][foto]overlay=0:${dy}`;
}
const centrado = (encuadre) => encuadre == null || Math.abs(normalizarEncuadre(encuadre) - 0.5) < 0.01;

// Un fotograma a un JPG (en `destino`); si el vídeo no deja saltar justo ahí, se busca leyendo (más lento)
async function sacar({ origen, segundo, ancho, destino, ffmpeg, ejecutar, encuadre = null }) {
  const bin = await ffmpeg();
  const s = String(Math.max(0, Number(segundo) || 0));
  const filtro = centrado(encuadre) ? ['-vf', `scale='min(${ancho},iw)':-2`] : ['-filter_complex', filtroEncuadre(encuadre, ancho)];
  const salida = ['-frames:v', '1', ...filtro, '-q:v', ancho > 500 ? '2' : '5', destino];
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
  // encuadre: qué franja del vídeo sale en la cuadrícula del perfil (0 arriba, 0,5 centro, 1 abajo)
  const comoPortada = (rel, segundo, encuadre = null) => conTmp(async (tmp) => {
    const destino = path.join(tmp, 'portada.jpg');
    await sacar({ origen: videoDe(archivos, rel), segundo, ancho: 1080, destino, ffmpeg, ejecutar, encuadre });
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
  // Una imagen que no es JPG (PNG, WebP, HEIC…) pasa a JPG: Instagram solo publica JPG. La de antes se borra.
  // (El navegador ya las convierte al subirlas; esto es para lo que llega de fuera, p. ej. desde Claude Code.)
  const aJpg = (a) => conTmp(async (tmp) => {
    if (!/^image\//.test(a.mime || '') || /^image\/jpe?g$/.test(a.mime)) return a;
    const destino = path.join(tmp, 'imagen.jpg');
    const bin = await ffmpeg();
    await correr(bin, ['-v', 'error', '-y', '-i', archivos.ruta(a.path), '-frames:v', '1', '-q:v', '2', destino], ejecutar).catch(() => {});
    if (!existsSync(destino) || !statSync(destino).size) throw publico(`No he podido pasar «${a.nombre}» a JPG (Instagram solo publica JPG)`);
    const nuevo = await archivos.guardar(createReadStream(destino), { nombre: `${String(a.nombre).replace(/\.[^.]*$/, '')}.jpg`, mime: 'image/jpeg' });
    archivos.borrar(a.path);
    return nuevo;
  });
  return { comoPortada, vistaPrevia, duracion, aJpg };
}
