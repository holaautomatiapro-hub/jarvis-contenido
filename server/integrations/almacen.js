import { createReadStream, openSync, readSync, closeSync, statSync } from 'node:fs';
import { Readable } from 'node:stream';

// Para publicar, Instagram descarga el vídeo o la foto desde un enlace público: no puede entrar en tu PC.
// Por eso, justo antes de publicar, JARVIS sube el archivo a Supabase Storage (el bucket público del CRM).
// Se guarda en la carpeta jarvis/ del bucket y se borra cuando Instagram ya lo ha publicado.

export class AlmacenError extends Error {}

export function createAlmacen({ env = process.env, fetchImpl = fetch, reintentos = 3, esperaMs = 3000 }) {
  const base = () => String(env.CRM_SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const clave = () => String(env.CRM_SUPABASE_ANON_KEY || '').trim();
  const bucket = () => env.SUPABASE_BUCKET || 'contenido';
  const configurado = () => /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(base()) && Boolean(clave());
  const cabeceras = () => ({ apikey: clave(), Authorization: `Bearer ${clave()}` });
  const urlPublica = (ruta) => `${base()}/storage/v1/object/public/${bucket()}/${ruta}`;

  // Lo que dice Supabase cuando falla, sin la página HTML de error de Cloudflare (520, 502…)
  const motivo = (status, t) => (/^\s*</.test(t) ? `Supabase respondió ${status} (un fallo suyo, normalmente pasajero)` : `Supabase respondió ${status} al subir el archivo: ${t.slice(0, 200)}`);
  const pasajero = (status) => status === 408 || status === 429 || status >= 500;
  const esperar = (ms) => new Promise((ok) => { setTimeout(ok, ms).unref?.(); });

  // Subida normal (archivos pequeños)
  async function subidaSimple(rutaLocal, ruta, mime) {
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
      throw Object.assign(new AlmacenError('No he podido subir el archivo a Supabase. Revisa tu conexión a internet.'), { reintentar: true });
    }
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      if (r.status === 413 || /too large|exceeded the maximum/i.test(t)) throw new AlmacenError('El archivo pesa más de lo que admite tu Supabase (el plan gratis deja 50 MB por archivo) y ni comprimiéndolo cabe. Acórtalo o súbelo más ligero; si tu plan deja más, pon cuánto en SUPABASE_MAX_MB.');
      if (r.status === 401 || r.status === 403) throw new AlmacenError('Supabase no deja subir archivos con esa clave al bucket. Revisa CRM_SUPABASE_ANON_KEY o las políticas del bucket.');
      throw Object.assign(new AlmacenError(motivo(r.status, t)), { reintentar: pasajero(r.status) });
    }
  }

  // Subida por trozos de 6 MB (TUS, la que recomienda Supabase para archivos grandes: la normal da 520 con vídeos)
  const TROZO = 6 * 1024 * 1024;
  async function subidaPorTrozos(rutaLocal, ruta, mime) {
    const tam = statSync(rutaLocal).size;
    const b64 = (v) => Buffer.from(String(v)).toString('base64');
    const tus = { ...cabeceras(), 'tus-resumable': '1.0.0' };
    const fallo = (r, t) => {
      if (r.status === 413 || /too large|exceeded the maximum/i.test(t)) return new AlmacenError('El archivo pesa más de lo que admite tu Supabase (el plan gratis deja 50 MB por archivo) y ni comprimiéndolo cabe. Acórtalo o súbelo más ligero; si tu plan deja más, pon cuánto en SUPABASE_MAX_MB.');
      if (r.status === 401 || r.status === 403) return new AlmacenError('Supabase no deja subir archivos con esa clave al bucket. Revisa CRM_SUPABASE_ANON_KEY o las políticas del bucket.');
      return Object.assign(new AlmacenError(motivo(r.status, t)), { reintentar: pasajero(r.status) });
    };
    let r;
    try {
      r = await fetchImpl(`${base()}/storage/v1/upload/resumable`, {
        method: 'POST',
        headers: { ...tus, 'upload-length': String(tam), 'x-upsert': 'true', 'upload-metadata': `bucketName ${b64(bucket())},objectName ${b64(ruta)},contentType ${b64(mime || 'application/octet-stream')},cacheControl ${b64('3600')}` },
        signal: AbortSignal.timeout(60000),
      });
    } catch { throw Object.assign(new AlmacenError('No he podido subir el archivo a Supabase. Revisa tu conexión a internet.'), { reintentar: true }); }
    if (r.status !== 201) throw fallo(r, await r.text().catch(() => ''));
    const loc = r.headers.get('location');
    if (!loc) throw new AlmacenError('Supabase no ha dado dónde subir el archivo');
    const destino = new URL(loc, base()).toString();
    const fd = openSync(rutaLocal, 'r');
    try {
      let offset = 0;
      let fallos = 0;
      while (offset < tam) {
        const largo = Math.min(TROZO, tam - offset);
        const buf = Buffer.alloc(largo);
        readSync(fd, buf, 0, largo, offset);
        try {
          r = await fetchImpl(destino, { method: 'PATCH', headers: { ...tus, 'upload-offset': String(offset), 'content-type': 'application/offset+octet-stream' }, body: buf, signal: AbortSignal.timeout(10 * 60000) });
          if (r.status !== 204) throw fallo(r, await r.text().catch(() => ''));
          offset = Number(r.headers.get('upload-offset')) || offset + largo;
          fallos = 0;
        } catch (e) {
          if ((e instanceof AlmacenError && !e.reintentar) || ++fallos > 3) throw e instanceof AlmacenError ? e : new AlmacenError('No he podido subir el archivo a Supabase. Revisa tu conexión a internet.');
          await esperar(esperaMs * fallos);
          // ¿Hasta dónde llegó? Se sigue desde ahí
          try {
            const h = await fetchImpl(destino, { method: 'HEAD', headers: tus, signal: AbortSignal.timeout(30000) });
            if (h.ok && h.headers.get('upload-offset') != null) offset = Number(h.headers.get('upload-offset'));
          } catch { /* se repite el mismo trozo */ }
        }
      }
    } finally { closeSync(fd); }
  }

  // ruta local (data/contenido/…) → enlace público. Si Supabase falla por algo pasajero (520, 502, 503…), se reintenta.
  async function subir(rutaLocal, { destino, mime }) {
    if (!configurado()) throw new AlmacenError('Falta configurar dónde se suben los archivos para Instagram: npm run claves → CRM_SUPABASE_URL y CRM_SUPABASE_ANON_KEY.');
    const ruta = `jarvis/${destino}`;
    const grande = statSync(rutaLocal).size > TROZO;
    for (let intento = 1; ; intento++) {
      try {
        await (grande ? subidaPorTrozos : subidaSimple)(rutaLocal, ruta, mime);
        return { ruta, url: urlPublica(ruta) };
      } catch (e) {
        if (!e.reintentar || intento >= reintentos) {
          if (e.reintentar && intento > 1) e.message = `${e.message}. Lo he intentado ${intento} veces: vuelve a probar en unos minutos.`;
          throw e;
        }
        await esperar(esperaMs * intento);
      }
    }
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
