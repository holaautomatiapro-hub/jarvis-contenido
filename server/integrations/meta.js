// Cliente mínimo de la Graph API de Meta (Instagram y, más adelante, Ads).

export const VERSION = () => process.env.META_GRAPH_VERSION || 'v23.0';
const BASE = 'https://graph.facebook.com';

export class MetaError extends Error {
  constructor(mensaje, { codigo, subcodigo, estado } = {}) {
    super(mensaje);
    this.codigo = codigo;
    this.subcodigo = subcodigo;
    this.estado = estado;
  }
  get caducado() { return this.codigo === 190; }
}

// Traduce los errores de Meta a mensajes que se entienden
function traducir(err, estado) {
  const c = err?.code;
  if (c === 190) return 'La conexión con Instagram ha caducado o se ha revocado. Vuelve a conectar Instagram.';
  if (c === 10 || c === 200) return `Falta un permiso en la app de Meta (${err.message}).`;
  if (c === 4 || c === 17 || c === 32 || c === 613) return 'Meta ha limitado las peticiones por ahora. JARVIS lo reintentará más tarde.';
  return err?.message ? `Meta: ${err.message}` : `Meta respondió ${estado}`;
}

export function createGraph({ token, fetchImpl = fetch, version = VERSION() } = {}) {
  async function get(ruta, params = {}, { tokenPropio } = {}) {
    const url = new URL(ruta.startsWith('http') ? ruta : `${BASE}/${version}/${ruta.replace(/^\//, '')}`);
    for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, Array.isArray(v) ? v.join(',') : String(v));
    if (!url.searchParams.has('access_token') && (tokenPropio || token)) url.searchParams.set('access_token', tokenPropio || token);
    let r;
    try {
      r = await fetchImpl(url, { signal: AbortSignal.timeout(30000) });
    } catch (e) {
      throw new MetaError(e.name === 'TimeoutError' ? 'Meta no responde (tiempo agotado). Inténtalo en un rato.' : 'No puedo conectar con Meta. Revisa tu conexión a internet.', { codigo: 'red' });
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.error) {
      const e = data.error || {};
      throw new MetaError(traducir(e, r.status), { codigo: e.code, subcodigo: e.error_subcode, estado: r.status });
    }
    return data;
  }

  // POST con el cuerpo como formulario (lo que espera la Marketing API)
  async function post(ruta, params = {}) {
    const url = `${BASE}/${version}/${ruta.replace(/^\//, '')}`;
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v != null) body.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    if (token && !body.has('access_token')) body.set('access_token', token);
    let r;
    try {
      r = await fetchImpl(url, { method: 'POST', body, signal: AbortSignal.timeout(30000) });
    } catch {
      throw new MetaError('No puedo conectar con Meta. Revisa tu conexión a internet.', { codigo: 'red' });
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.error) {
      const e = data.error || {};
      const detalle = e.error_user_msg || e.error_user_title;
      throw new MetaError(detalle ? `Meta: ${detalle}` : traducir(e, r.status), { codigo: e.code, subcodigo: e.error_subcode, estado: r.status });
    }
    return data;
  }

  // Recorre la paginación de Meta hasta `max` elementos
  async function todo(ruta, params = {}, max = 200) {
    const out = [];
    let pagina = await get(ruta, params);
    while (true) {
      out.push(...(pagina.data || []));
      if (out.length >= max || !pagina.paging?.next) break;
      pagina = await get(pagina.paging.next);
    }
    return out.slice(0, max);
  }

  return { get, post, todo };
}
