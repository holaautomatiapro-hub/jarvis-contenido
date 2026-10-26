import os from 'node:os';
import path from 'node:path';
import { readFileSync, realpathSync, statSync } from 'node:fs';

// Las fotos y vídeos que le mandas a JARVIS por Telegram: Hermes los guarda en su caché (~/.hermes/cache) y le pasa
// a la IA la ruta. Para meterlos en la biblioteca solo se aceptan archivos de ESA carpeta (o de las que pongas en
// JARVIS_MEDIOS_PERMITIDOS, separadas por «:») y solo fotos o vídeos: así nadie puede colar en una publicación un
// archivo cualquiera del servidor (el .env, la base de datos…) pidiéndoselo a la IA.

const TIPOS = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v' };
const MAX = 1024 ** 3; // 1 GB

export function raicesPermitidas(env = process.env) {
  const hermes = env.HERMES_HOME || path.join(os.homedir(), '.hermes');
  // cache/ en las versiones nuevas de Hermes; image_cache/, video_cache/… en las instalaciones antiguas, que las siguen usando
  return [path.join(hermes, 'cache'), ...['image_cache', 'video_cache', 'audio_cache', 'document_cache'].map((d) => path.join(hermes, d)), ...String(env.JARVIS_MEDIOS_PERMITIDOS || '').split(':').filter(Boolean)]
    .map((r) => { try { return realpathSync(r); } catch { return null; } }).filter(Boolean);
}

// Devuelve { ruta, nombre, mime, tamano } si se puede usar; si no, un error que se entiende
export function medioPermitido(ruta, { raices = raicesPermitidas() } = {}) {
  let real;
  try { real = realpathSync(String(ruta || '')); } catch { throw new Error(`No encuentro el archivo ${path.basename(String(ruta || ''))}`); }
  if (!raices.some((r) => real.startsWith(r + path.sep))) throw new Error('Solo puedo guardar las fotos y vídeos que te llegan por Telegram (los que Hermes guarda en su caché).');
  const ext = path.extname(real).slice(1).toLowerCase();
  const mime = TIPOS[ext];
  if (!mime) throw new Error(`«${path.basename(real)}» no es una foto ni un vídeo (jpg, png, webp, heic, mp4 o mov).`);
  const st = statSync(real);
  if (!st.isFile() || !st.size) throw new Error(`«${path.basename(real)}» está vacío`);
  if (st.size > MAX) throw new Error(`«${path.basename(real)}» pesa más de 1 GB`);
  return { ruta: real, nombre: path.basename(real), mime, tamano: st.size };
}

// ¿Este proceso lo ha arrancado Hermes? Por si su config.yaml no lleva JARVIS_ORIGEN=hermes (configuraciones antiguas
// o hechas a mano). Se mira el programa (no sus argumentos: el prompt de Claude puede nombrar a Hermes) del proceso
// padre y del abuelo. Solo en Linux y WSL; en el resto no se sabe y se dice que no.
const esHermes = (arg) => /(^|\/)hermes(\.exe)?$|\/\.hermes\/|hermes[_-]agent/i.test(arg);
export function lanzadoPorHermes({ pid = process.ppid, leer = (f) => readFileSync(f, 'utf8') } = {}) {
  for (let i = 0, p = pid; i < 2 && p > 1; i++) {
    try {
      if (leer(`/proc/${p}/cmdline`).split('\0').slice(0, 2).some(esHermes)) return true;
      p = Number(leer(`/proc/${p}/stat`).replace(/^.*\)\s+/s, '').split(/\s+/)[1]);
    } catch { return false; }
  }
  return false;
}
