import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createWriteStream, mkdirSync, rmSync, statSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';

// Fotos y vídeos de la sección Contenido. Se guardan en tu PC (data/contenido/AAAA-MM/…) y solo se sirven en localhost.

export const MAX_ARCHIVO = 4 * 1024 ** 3; // 4 GB: un vídeo largo en 4K cabe
const EXTENSIONES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', webm: 'video/webm' };
const MES = /^\d{4}-\d{2}$/;
const FICHERO = /^\d{13}-[a-f0-9]{6}_[A-Za-z0-9._-]{1,120}$/;

export class ArchivoError extends Error {}

export const mimeDe = (nombre, mime = '') => {
  if (/^(image|video)\//.test(mime)) return mime;
  return EXTENSIONES[String(nombre).split('.').pop().toLowerCase()] || '';
};

// "Mi reel final (1).MP4" → "Mi_reel_final_1.mp4" (sin tildes ni espacios: nombres seguros en Windows)
export function nombreSeguro(nombre) {
  const limpio = String(nombre || 'archivo').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const ext = (limpio.match(/\.([A-Za-z0-9]{1,5})$/)?.[1] || '').toLowerCase();
  const base = limpio.replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 100) || 'archivo';
  return ext ? `${base}.${ext}` : base;
}

export function createArchivos({ dir }) {
  const ruta = (rel) => {
    const [mes, fichero, ...resto] = String(rel || '').split('/');
    if (resto.length || !MES.test(mes || '') || !FICHERO.test(fichero || '')) throw new ArchivoError('Archivo no válido');
    return path.join(dir, mes, fichero);
  };

  async function guardar(stream, { nombre, mime }) {
    const tipo = mimeDe(nombre, mime);
    if (!tipo) throw new ArchivoError(`«${nombre}» no es una foto ni un vídeo`);
    const ahora = new Date();
    const mes = ahora.toLocaleDateString('sv-SE').slice(0, 7);
    const fichero = `${ahora.getTime()}-${randomBytes(3).toString('hex')}_${nombreSeguro(nombre)}`;
    mkdirSync(path.join(dir, mes), { recursive: true });
    const destino = path.join(dir, mes, fichero);
    let tamano = 0;
    try {
      await pipeline(stream, async function* (fuente) {
        for await (const trozo of fuente) {
          tamano += trozo.length;
          if (tamano > MAX_ARCHIVO) throw new ArchivoError(`«${nombre}» pesa más de 4 GB`);
          yield trozo;
        }
      }, createWriteStream(destino));
    } catch (e) {
      rmSync(destino, { force: true });
      throw e instanceof ArchivoError ? e : new ArchivoError(`No se pudo guardar «${nombre}»`);
    }
    if (!tamano) { rmSync(destino, { force: true }); throw new ArchivoError(`«${nombre}» está vacío`); }
    const rel = `${mes}/${fichero}`;
    return { path: rel, url: `/api/contenido/archivos/${rel}`, nombre: String(nombre).slice(0, 200), mime: tipo, tamano };
  }

  const borrar = (rel) => { try { rmSync(ruta(rel), { force: true }); } catch { /* ruta ajena: no se toca */ } };
  const existe = (rel) => { try { return statSync(ruta(rel)).isFile(); } catch { return false; } };

  return { dir, ruta, guardar, borrar, existe };
}
