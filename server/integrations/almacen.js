import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';

// Para publicar, Instagram descarga el vídeo o la foto desde un enlace público: no puede entrar en tu PC.
// Por eso, justo antes de publicar, JARVIS sube el archivo a Supabase Storage (el bucket público del CRM).
// Se guarda en la carpeta jarvis/ del bucket y se borra cuando Instagram ya lo ha publicado.

export class AlmacenError extends Error {}

export function createAlmacen({ env = process.env, fetchImpl = fetch }) {
  const base = () => String(env.CRM_SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const clave = () => String(env.CRM_SUPABASE_ANON_KEY || '').trim();
  const bucket = () => env.SUPABASE_BUCKET || 'contenido';
  const configurado = () => /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(base()) && Boolean(clave());
  const cabeceras = () => ({ apikey: clave(), Authorization: `Bearer ${clave()}` });
  const urlPublica = (ruta) => `${base()}/storage/v1/object/public/${bucket()}/${ruta}`;

  // ruta local (data/contenido/…) → enlace público
  async function subir(rutaLocal, { destino, mime }) {
    if (!configurado()) throw new AlmacenError('Falta configurar dónde se suben los archivos para Instagram: npm run claves → CRM_SUPABASE_URL y CRM_SUPABASE_ANON_KEY.');
    const ruta = `jarvis/${destino}`;
    let r;
    try {
      r = await fetchImpl(`${base()}/storage/v1/object/${bucket()}/${ruta}`, {
        method: 'POST',
        headers: { ...cabeceras(), 'content-type': mime || 'application/octet-stream', 'content-length': String(statSync(rutaLocal).size), 'x-upsert': 'true', 'cache-control': '3600' },
        body: Readable.toWeb(createReadStream(rutaLocal)),
        duplex: 'half',
        signal: AbortSignal.timeout(30 * 60000),
      });
    } catch {
      throw new AlmacenError('No he podido subir el archivo a Supabase. Revisa tu conexión a internet.');
    }
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      if (r.status === 413 || /too large|exceeded the maximum/i.test(t)) throw new AlmacenError('El archivo pesa más de lo que admite tu Supabase (el plan gratis deja 50 MB). Exporta el vídeo más ligero.');
      if (r.status === 401 || r.status === 403) throw new AlmacenError('Supabase no deja subir archivos con esa clave al bucket. Revisa CRM_SUPABASE_ANON_KEY o las políticas del bucket.');
      throw new AlmacenError(`Supabase respondió ${r.status} al subir el archivo: ${t.slice(0, 200)}`);
    }
    return { ruta, url: urlPublica(ruta) };
  }

  // Limpieza: si falla, se queda en el bucket (no es grave)
  async function borrar(rutas) {
    if (!configurado() || !rutas?.length) return;
    try {
      await fetchImpl(`${base()}/storage/v1/object/${bucket()}`, {
        method: 'DELETE', headers: { ...cabeceras(), 'content-type': 'application/json' }, body: JSON.stringify({ prefixes: rutas }), signal: AbortSignal.timeout(30000),
      });
    } catch { /* se queda */ }
  }

  return { configurado, subir, borrar, urlPublica };
}
