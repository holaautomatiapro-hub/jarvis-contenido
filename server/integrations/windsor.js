// Windsor.ai: otra forma de traer las métricas de Instagram sin crear una app de Meta.
// Windsor ya tiene conectada tu cuenta; JARVIS solo lee su API REST con tu WINDSOR_API_KEY.
//
// Se piden tres consultas por separado, porque mezclar métricas de cuenta, de publicación y de
// historias en una sola hace que Windsor cruce las filas:
//   · publicaciones (una fila por post, con sus métricas)
//   · cuenta (una fila por día: alcance, seguidores, visitas al perfil, clics…)
//   · historias (una fila por story)
// "Todas las posibles": se piden todos los campos que conocemos. Los que tu plan o tu cuenta no
// tengan se descartan solos la primera vez (Windsor rechaza la consulta) y se recuerda cuáles
// valen durante un mes para no gastar peticiones.

export const API_WINDSOR = 'https://connectors.windsor.ai';

export const GRUPOS = {
  media: {
    // Imprescindibles solo el id y la fecha; el resto se comprueba uno a uno
    base: ['media_id', 'timestamp'],
    extra: [
      // Los que usa el CRM, que se sabe que funcionan
      'media_type', 'media_caption', 'media_permalink', 'media_thumbnail_url', 'media_views', 'media_reach', 'media_like_count', 'media_comments_count', 'media_saved', 'media_shares',
      'media_product_type', 'media_url', 'media_impressions', 'media_total_interactions', 'media_engagement', 'media_plays',
      'media_video_views', 'media_reels_avg_watch_time', 'media_reels_video_view_total_time', 'media_ig_reels_aggregated_all_plays_count',
      'media_clips_replays_count', 'media_profile_visits', 'media_profile_activity', 'media_follows', 'media_replies', 'media_reposts',
    ],
  },
  cuenta: {
    base: ['date'],
    extra: [
      'account_name', 'username', 'followers_count', 'follows_count', 'media_count', 'follower_count', 'reach', 'impressions', 'views',
      'profile_views', 'accounts_engaged', 'total_interactions', 'likes', 'comments', 'shares', 'saves', 'replies', 'reposts', 'follows_and_unfollows',
      'profile_links_taps', 'website_clicks', 'email_contacts', 'phone_call_clicks', 'text_message_clicks', 'get_directions_clicks',
    ],
  },
  historias: {
    base: ['story_id'],
    extra: [
      'story_timestamp', 'story_media_type', 'story_caption', 'story_permalink', 'story_thumbnail_url', 'story_reach', 'story_impressions',
      'story_views', 'story_replies', 'story_shares', 'story_total_interactions', 'story_follows', 'story_profile_visits', 'story_profile_activity',
      'story_navigation', 'story_taps_forward', 'story_taps_back', 'story_exits', 'story_swipe_forward',
    ],
  },
};

// Nombre en español para el dashboard (lo que no esté aquí se enseña con su nombre de Windsor)
export const ETIQUETAS = {
  followers_count: 'Seguidores', follows_count: 'Seguidos', media_count: 'Publicaciones totales', follower_count: 'Seguidores nuevos',
  reach: 'Alcance', impressions: 'Impresiones', views: 'Visualizaciones', profile_views: 'Visitas al perfil', accounts_engaged: 'Cuentas que interactúan',
  total_interactions: 'Interacciones', likes: 'Me gusta', comments: 'Comentarios', shares: 'Compartidos', saves: 'Guardados', replies: 'Respuestas',
  reposts: 'Reposts', follows_and_unfollows: 'Seguir / dejar de seguir', profile_links_taps: 'Toques en enlaces del perfil', website_clicks: 'Clics en la web',
  email_contacts: 'Clics en email', phone_call_clicks: 'Clics en llamar', text_message_clicks: 'Clics en mensaje', get_directions_clicks: 'Clics en cómo llegar',
  story_reach: 'Alcance de historias', story_impressions: 'Impresiones de historias', story_views: 'Visualizaciones de historias', story_replies: 'Respuestas a historias',
  story_shares: 'Historias compartidas', story_total_interactions: 'Interacciones en historias', story_follows: 'Seguidores desde historias',
  story_profile_visits: 'Visitas al perfil desde historias', story_profile_activity: 'Actividad en el perfil desde historias', story_navigation: 'Navegación en historias',
  story_taps_forward: 'Toques para avanzar', story_taps_back: 'Toques para volver', story_exits: 'Salidas de historias', story_swipe_forward: 'Deslizar para pasar',
};
// Las que son una foto del día (no se suman: vale la última)
export const INSTANTANEAS = new Set(['followers_count', 'follows_count', 'media_count']);
// Métricas de cuenta que ya usan los dashboards con otro nombre
const SERIE_DASHBOARD = { reach: 'alcance', follower_count: 'nuevos', followers_count: 'seguidores' };
const NO_NUMERICOS = new Set(['date', 'account_name', 'username', 'account_id']);

export class WindsorError extends Error {
  constructor(msg, { campos = false } = {}) { super(msg); this.campos = campos; }
}

const DIA = 86400000;
const fecha = (ms) => new Date(ms).toLocaleDateString('sv-SE');
const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
// "2026-10-01T10:00:00+0000" → ISO que entiende cualquier navegador
export const normalizarFecha = (s) => (s ? String(s).replace(' ', 'T').replace(/([+-]\d{2})(\d{2})$/, '$1:$2') : null);

function filasDe(json) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json?.result)) return json.result;
  return null;
}

export function createWindsor({ env = process.env, fetchImpl = fetch, ajustesDb, hoy = () => Date.now() }) {
  const clave = () => String(env.WINDSOR_API_KEY || '').trim();
  const configurado = () => Boolean(clave());
  const conector = () => env.WINDSOR_CONECTOR || 'instagram';

  async function pedir(campos, { desde, hasta }) {
    const u = new URL(`${API_WINDSOR}/${conector()}`);
    u.searchParams.set('api_key', clave());
    u.searchParams.set('date_from', desde);
    u.searchParams.set('date_to', hasta);
    u.searchParams.set('fields', campos.join(','));
    let r, texto;
    try {
      r = await fetchImpl(u.toString(), { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(120000) });
      texto = await r.text();
    } catch {
      throw new WindsorError('No he podido conectar con Windsor. Revisa tu conexión a internet.');
    }
    let json = null;
    try { json = JSON.parse(texto); } catch { /* no es JSON */ }
    const detalle = String(json?.error || json?.message || json?.detail || texto || '').slice(0, 300);
    if (r.status === 401 || r.status === 403 || (!r.ok && /api[_ ]?key/i.test(detalle))) throw new WindsorError('Windsor no acepta la clave. Copia de nuevo tu API key en onboard.windsor.ai y guárdala con npm run claves.');
    if (r.status === 429) throw new WindsorError('Windsor dice que has llegado al límite de peticiones de tu plan. Prueba más tarde.');
    if (r.status >= 500) throw new WindsorError(`Windsor respondió ${r.status}. Prueba más tarde.`);
    if (!r.ok) throw new WindsorError(`Windsor rechazó la consulta: ${detalle}`, { campos: true });
    const filas = filasDe(json);
    if (!filas) throw new WindsorError(`Windsor no devolvió filas: ${detalle}`, { campos: true });
    return filas;
  }

  // Qué campos acepta Windsor para tu cuenta. Prueba todos a la vez y, si los rechaza, parte la lista por la mitad.
  async function camposValidos(grupo, { forzar = false } = {}) {
    const cache = ajustesDb.leer('windsor_campos', {});
    const g = GRUPOS[grupo];
    if (!forzar && cache[grupo] && hoy() - cache[grupo].fecha < 30 * DIA) return cache[grupo].campos;
    const rango = { desde: fecha(hoy() - 7 * DIA), hasta: fecha(hoy()) };
    // Devuelve true si Windsor acepta la lista; si la rechaza, el texto del error (suele nombrar el campo malo)
    const vale = async (lista) => { try { await pedir([...g.base, ...lista], rango); return true; } catch (e) { if (e.campos) return e.message; throw e; } };
    const filtrar = async (lista) => {
      if (!lista.length) return [];
      const r = await vale(lista);
      if (r === true) return lista;
      // Si el error dice qué campos sobran, se quitan y se vuelve a probar (una petición en vez de muchas)
      const nombrados = lista.filter((c) => new RegExp(`\\b${c}\\b`).test(r));
      if (nombrados.length && nombrados.length < lista.length) return filtrar(lista.filter((c) => !nombrados.includes(c)));
      if (lista.length === 1) return [];
      const mitad = Math.ceil(lista.length / 2);
      return [...(await filtrar(lista.slice(0, mitad))), ...(await filtrar(lista.slice(mitad)))];
    };
    let campos;
    if ((await vale([])) !== true) campos = null; // ni los básicos: ese grupo no existe en tu Windsor
    else campos = [...g.base, ...(await filtrar(g.extra))];
    // Un grupo que no existe solo se recuerda si es opcional (historias): publicaciones y cuenta se reintentan siempre
    if (campos || grupo === 'historias') ajustesDb.guardar('windsor_campos', { ...cache, [grupo]: { campos, fecha: hoy() } });
    return campos;
  }

  // Algunas métricas solo se pueden pedir para los últimos N días (p. ej. follower_count: 30). Windsor lo dice
  // en el error: se aprende el límite, esas métricas se piden aparte con su rango y las filas se juntan.
  async function pedirConLimites(grupo, campos, rango) {
    const fijos = GRUPOS[grupo].base.filter((c) => campos.includes(c));
    const claves = [...fijos, ...['account_name', 'username'].filter((c) => campos.includes(c))];
    for (let intento = 0; intento < 6; intento++) {
      const limites = ajustesDb.leer('windsor_limites', {});
      const tramos = new Map(); // días de límite (0 = sin límite) → campos
      for (const c of campos.filter((x) => !claves.includes(x))) {
        const d = limites[c] || 0;
        tramos.set(d, [...(tramos.get(d) || []), c]);
      }
      if (!tramos.size) tramos.set(0, []);
      try {
        const juntas = new Map();
        for (const [d, lista] of tramos) {
          const desde = d ? [rango.desde, fecha(hoy() - (d - 1) * DIA)].sort().at(-1) : rango.desde;
          for (const f of await pedir([...claves, ...lista], { desde, hasta: rango.hasta })) {
            const k = claves.map((c) => f[c] ?? '').join('|');
            juntas.set(k, { ...(juntas.get(k) || {}), ...f });
          }
        }
        return [...juntas.values()];
      } catch (e) {
        const nuevos = {};
        for (const m of String(e.message).matchAll(/\(([\w,\s]+)\)\s*supports? the last (\d+) days?/gi)) {
          for (const c of m[1].split(',').map((x) => x.trim()).filter(Boolean)) nuevos[c] = Number(m[2]);
        }
        if (!e.campos || !Object.keys(nuevos).length) throw e;
        ajustesDb.guardar('windsor_limites', { ...ajustesDb.leer('windsor_limites', {}), ...nuevos });
      }
    }
    throw new WindsorError('Windsor sigue rechazando el rango de fechas de algunas métricas');
  }

  // Trae todo y lo entrega a quien guarda (instagram.js), que es el dueño de las tablas
  async function sincronizar({ guardarMedia, guardarSerie, guardarHistoria, dias }) {
    if (!configurado()) throw new WindsorError('Falta WINDSOR_API_KEY en .env (npm run claves)');
    const previo = ajustesDb.leer('windsor_sync', {});
    const n = dias || (previo.fin ? 60 : 365); // la primera vez, un año de histórico
    const rango = { desde: fecha(hoy() - n * DIA), hasta: fecha(hoy()) };
    const filtroCuenta = String(env.WINDSOR_CUENTA || '').replace(/^@/, '').toLowerCase();
    const deMiCuenta = (f) => !filtroCuenta || [f.account_name, f.username].some((x) => String(x || '').replace(/^@/, '').toLowerCase() === filtroCuenta);
    const res = { publicaciones: 0, dias: 0, historias: 0, metricas: [], cuentas: [], avisos: [] };

    // Publicaciones
    const camposMedia = await camposValidos('media');
    if (!camposMedia) throw new WindsorError('Windsor no tiene datos de publicaciones de Instagram. Comprueba en onboard.windsor.ai que tu cuenta de Instagram está conectada.');
    for (const f of await pedirConLimites('media', camposMedia, rango)) {
      if (!f.media_id || !f.timestamp) continue; // filas agregadas
      guardarMedia(f);
      res.publicaciones++;
    }

    // Cuenta, día a día (si falla, las publicaciones ya están guardadas: se avisa y se sigue)
    const camposCuenta = await camposValidos('cuenta').catch((e) => { res.avisos.push(`Métricas de la cuenta: ${e.message}`); return undefined; });
    if (camposCuenta && camposCuenta.length > 1) {
      const cuentas = new Set();
      const ultimo = {};
      let filasCuenta = [];
      try { filasCuenta = await pedirConLimites('cuenta', camposCuenta, rango); } catch (e) { res.avisos.push(`Métricas de la cuenta: ${e.message}`); }
      for (const f of filasCuenta.filter(deMiCuenta)) {
        if (!f.date) continue;
        const dia = String(f.date).slice(0, 10);
        if (f.account_name || f.username) cuentas.add(f.username || f.account_name);
        let alguna = false;
        for (const [k, v] of Object.entries(f)) {
          if (NO_NUMERICOS.has(k)) continue;
          const x = num(v);
          if (x === null) continue;
          guardarSerie(dia, `w:${k}`, x);
          if (SERIE_DASHBOARD[k]) guardarSerie(dia, SERIE_DASHBOARD[k], x);
          ultimo[k] = x;
          alguna = true;
        }
        if (alguna) res.dias++;
      }
      res.metricas = Object.keys(ultimo);
      res.cuentas = [...cuentas];
      if (res.cuentas.length > 1 && !filtroCuenta) res.avisos.push(`Windsor tiene ${res.cuentas.length} cuentas (${res.cuentas.join(', ')}): se mezclan. Pon WINDSOR_CUENTA=tu_usuario en .env para quedarte solo con la tuya.`);
    } else if (camposCuenta !== undefined) res.avisos.push('Windsor no devuelve métricas diarias de la cuenta con tu plan.');

    // Historias (solo duran 24 h en Instagram: Windsor guarda las que ha visto)
    try {
      const camposHist = await camposValidos('historias');
      if (camposHist) {
        for (const f of (await pedirConLimites('historias', camposHist, rango)).filter(deMiCuenta)) {
          if (!f.story_id) continue;
          guardarHistoria(f);
          res.historias++;
        }
      }
    } catch (e) { res.avisos.push(`Historias: ${e.message}`); }

    ajustesDb.guardar('windsor_sync', { fin: new Date(hoy()).toISOString(), ...res, error: null, cuenta: res.cuentas[0] || previo.cuenta || null });
    return res;
  }

  return { configurado, pedir, camposValidos, sincronizar, estado: () => ajustesDb.leer('windsor_sync', {}) };
}

// Fila de publicación de Windsor → columnas de ig_media (el resto va entero en "extra")
export function mediaDeWindsor(f) {
  const tipo = String(f.media_type || '').toUpperCase();
  const producto = String(f.media_product_type || '').toUpperCase();
  const reel = producto === 'REELS' || /REEL|VIDEO/.test(tipo);
  const formato = reel ? 'Reels' : /CAROUSEL/.test(tipo) ? 'Carruseles' : 'Imágenes';
  const likes = num(f.media_like_count), comentarios = num(f.media_comments_count), guardados = num(f.media_saved), compartidos = num(f.media_shares);
  const interacciones = num(f.media_total_interactions) ?? ([likes, comentarios, guardados, compartidos].some((x) => x !== null) ? (likes || 0) + (comentarios || 0) + (guardados || 0) + (compartidos || 0) : null);
  const extra = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== null && v !== undefined && v !== ''));
  return {
    id: String(f.media_id), tipo: tipo || null, formato, caption: f.media_caption || null, permalink: f.media_permalink || null,
    miniatura: f.media_thumbnail_url || (!reel ? f.media_url : null) || null,
    media_url: reel ? f.media_url || null : null,
    fecha: normalizarFecha(f.timestamp), likes, comentarios,
    alcance: num(f.media_reach), views: num(f.media_views) ?? num(f.media_plays) ?? num(f.media_video_views),
    guardados, compartidos, interacciones, ver_medio_ms: num(f.media_reels_avg_watch_time),
    extra: JSON.stringify(extra),
  };
}
