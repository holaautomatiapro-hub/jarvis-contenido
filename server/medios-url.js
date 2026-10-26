// Guarda en la biblioteca una imagen o un vídeo de internet (p. ej. lo que genera Higgsfield, que solo da un enlace),
// para usarlo en un diseño. Solo https y solo direcciones públicas: el servidor no descarga nada de la red local.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';

const TIPOS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' };
const MAX = 300 * 1024 ** 2;

export class MedioUrlError extends Error {
  constructor(m) { super(m); this.publico = true; }
}

// Direcciones que no son de internet (local, red privada, enlace local…)
export function ipPrivada(ip) {
  if (isIP(ip) === 6) {
    const x = ip.toLowerCase();
    if (x === '::1' || x === '::' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80')) return true;
    const m = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return m ? ipPrivada(m[1]) : false;
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

async function comprobar(url, resolver) {
  let u;
  try { u = new URL(url); } catch { throw new MedioUrlError('Ese enlace no es válido'); }
  if (u.protocol !== 'https:') throw new MedioUrlError('Solo enlaces https');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const ips = isIP(host) ? [host] : (await resolver(host, { all: true }).catch(() => { throw new MedioUrlError(`No encuentro ${host}`); })).map((r) => r.address);
  if (!ips.length || ips.some(ipPrivada)) throw new MedioUrlError('Ese enlace no apunta a internet');
  return u;
}

export function createMediosUrl({ jarvis, archivos, fetchImpl = fetch, resolver = lookup }) {
  async function guardar({ url, nombre, carpeta = 'Imágenes IA', titulo } = {}) {
    if (!archivos) throw new MedioUrlError('La biblioteca no está disponible');
    let actual = String(url || '').trim();
    let r;
    // Las redirecciones se siguen a mano para comprobar también a dónde llevan
    for (let saltos = 0; ; saltos++) {
      await comprobar(actual, resolver);
      r = await fetchImpl(actual, { redirect: 'manual', signal: AbortSignal.timeout(120_000) });
      if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
        if (saltos >= 4) throw new MedioUrlError('Demasiadas redirecciones');
        actual = new URL(r.headers.get('location'), actual).toString();
        continue;
      }
      break;
    }
    if (!r.ok) throw new MedioUrlError(`La descarga respondió ${r.status}`);
    const tipo = String(r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const ext = TIPOS[tipo];
    if (!ext) throw new MedioUrlError(`Eso no es una imagen ni un vídeo (${tipo || 'sin tipo'})`);
    if (Number(r.headers.get('content-length')) > MAX) throw new MedioUrlError('Pesa más de 300 MB');
    const datos = Buffer.from(await r.arrayBuffer());
    if (datos.length > MAX) throw new MedioUrlError('Pesa más de 300 MB');
    const base = String(nombre || '').trim().replace(/\.[a-z0-9]+$/i, '').replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 60) || `imagen-${Date.now()}`;
    const a = await archivos.guardar(Readable.from(datos), { nombre: `${base}.${ext}`, mime: tipo });
    const video = tipo.startsWith('video/');
    const pieza = jarvis.crearPieza({ titulo: String(titulo || base).slice(0, 200), formato: video ? 'Vídeo' : 'Foto', estado: 'editar', archivos: [a], carpeta, origen: 'dashboard', origen_ref: `url:${actual.slice(0, 300)}` });
    return { url: a.url, ruta: archivos.ruta(a.path), tipo: video ? 'video' : 'foto', pieza_id: pieza.id };
  }
  return { guardar };
}
