import { ajustes, row, rows } from '../db.js';
import { createGraph, MetaError, VERSION } from './meta.js';
import { transcribir as transcribirElevenLabs, sttConfigurado } from '../stt.js';
import { demoInstagram } from './instagram-demo.js';
import { createWindsor, mediaDeWindsor, normalizarFecha, ETIQUETAS, INSTANTANEAS } from './windsor.js';

// Instagram: conexión (OAuth de Meta o token pegado), sincronización de métricas,
// transcripción automática de reels y los datos de los dos dashboards.

export const PERMISOS = [
  'instagram_basic', 'instagram_manage_insights', 'instagram_content_publish', 'pages_show_list', 'pages_read_engagement',
  'business_management', 'ads_read', 'ads_management',
];

const CAMPOS_MEDIA = 'id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count';
const METRICAS_BASE = ['reach', 'saved', 'total_interactions'];
const METRICAS_EXTRA = ['views', 'shares', 'likes', 'comments'];
const DIA = 86400000;

export const formatoDe = (m) => (m.media_product_type === 'REELS' || m.media_type === 'VIDEO' ? 'Reels' : m.media_type === 'CAROUSEL_ALBUM' ? 'Carruseles' : 'Imágenes');
export const fechaLocal = (d) => new Date(d).toLocaleDateString('sv-SE');
export const primeraFrase = (t) => {
  const s = String(t || '').replace(/\s+/g, ' ').trim();
  const m = s.match(/^(.{12,140}?[.!?¿¡…])(\s|$)/);
  return (m ? m[1] : s.slice(0, 120)).trim() || null;
};

export function createInstagram({ db, vault, env = process.env, fetchImpl = fetch, sttImpl = transcribirElevenLabs, alCambiar = () => {}, windsor: windsorInyectado }) {
  const aj = ajustes(db);
  const windsor = windsorInyectado || createWindsor({ env, fetchImpl, ajustesDb: aj });
  const q = {
    upsert: db.prepare(`INSERT INTO ig_media (id, tipo, formato, caption, permalink, miniatura, media_url, fecha, likes, comentarios, alcance, views, guardados, compartidos, interacciones, ver_medio_ms, gancho, extra)
      VALUES (@id, @tipo, @formato, @caption, @permalink, @miniatura, @media_url, @fecha, @likes, @comentarios, @alcance, @views, @guardados, @compartidos, @interacciones, @ver_medio_ms, @gancho, @extra)
      ON CONFLICT(id) DO UPDATE SET caption = excluded.caption, permalink = excluded.permalink, miniatura = COALESCE(excluded.miniatura, miniatura), media_url = COALESCE(excluded.media_url, media_url), extra = COALESCE(excluded.extra, extra),
        likes = excluded.likes, comentarios = excluded.comentarios, alcance = COALESCE(excluded.alcance, alcance), views = COALESCE(excluded.views, views),
        guardados = COALESCE(excluded.guardados, guardados), compartidos = COALESCE(excluded.compartidos, compartidos),
        interacciones = COALESCE(excluded.interacciones, interacciones), ver_medio_ms = COALESCE(excluded.ver_medio_ms, ver_medio_ms),
        gancho = COALESCE(gancho, excluded.gancho), actualizado = datetime('now','localtime')`),
    historia: db.prepare("INSERT INTO ig_historias (id, fecha, datos) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET datos = excluded.datos, fecha = COALESCE(excluded.fecha, fecha), actualizado = datetime('now','localtime')"),
    historias: db.prepare('SELECT * FROM ig_historias WHERE fecha >= ? ORDER BY fecha DESC'),
    serie: db.prepare('INSERT INTO ig_serie (fecha, metrica, valor) VALUES (?, ?, ?) ON CONFLICT(fecha, metrica) DO UPDATE SET valor = excluded.valor'),
    media: db.prepare('SELECT * FROM ig_media ORDER BY fecha DESC'),
    series: db.prepare('SELECT * FROM ig_serie WHERE fecha >= ? ORDER BY fecha'),
    porTranscribir: db.prepare("SELECT * FROM ig_media WHERE formato = 'Reels' AND transcrita = 0 AND media_url IS NOT NULL AND error_transcripcion IS NULL ORDER BY fecha DESC LIMIT ?"),
    transcrita: db.prepare('UPDATE ig_media SET transcrita = 1, nota = ?, gancho = COALESCE(?, gancho), error_transcripcion = NULL WHERE id = ?'),
    errorTrans: db.prepare('UPDATE ig_media SET error_transcripcion = ? WHERE id = ?'),
    sinTema: db.prepare("SELECT id, formato, fecha, substr(COALESCE(caption, ''), 1, 400) AS caption, gancho FROM ig_media WHERE tema IS NULL ORDER BY fecha DESC LIMIT ?"),
    setTema: db.prepare('UPDATE ig_media SET tema = ? WHERE id = ?'),
    temas: db.prepare('SELECT tema, COUNT(*) AS piezas FROM ig_media WHERE tema IS NOT NULL GROUP BY tema ORDER BY piezas DESC'),
    cuenta: db.prepare("SELECT COUNT(*) AS n, SUM(transcrita) AS t, SUM(CASE WHEN formato = 'Reels' AND transcrita = 0 THEN 1 ELSE 0 END) AS p FROM ig_media"),
  };

  const conexion = () => aj.leer('instagram');
  const appConfigurada = () => Boolean(env.META_APP_ID && env.META_APP_SECRET);
  let sincronizando = false;

  function estado() {
    const c = conexion();
    const sync = aj.leer('instagram_sync', {});
    const cnt = row(q.cuenta);
    const conectadoMeta = Boolean(c?.igUserId && c?.token);
    const w = windsor.estado();
    return {
      // Conectado = hay de dónde sacar datos: la app de Meta o Windsor
      conectado: conectadoMeta || windsor.configurado(),
      conectadoMeta,
      fuente: conectadoMeta ? (windsor.configurado() ? 'meta+windsor' : 'meta') : windsor.configurado() ? 'windsor' : null,
      windsor: { configurado: windsor.configurado(), ultimaSync: w.fin || null, historias: w.historias || 0, metricas: w.metricas?.length || 0, avisos: w.avisos || [] },
      username: c?.username || w.cuenta || null,
      foto: c?.foto || null,
      pagina: c?.paginaNombre || null,
      appConfigurada: appConfigurada(),
      sincronizando,
      ultimaSync: sync.fin || null,
      error: sync.error || null,
      transcripcion: { activa: sttConfigurado(env), hechas: cnt.t || 0, pendientes: cnt.p || 0 },
      publicaciones: cnt.n || 0,
    };
  }

  // ---------- Conexión ----------
  function urlConexion(redirectUri, state) {
    if (!appConfigurada()) throw new Error('Falta META_APP_ID y META_APP_SECRET en .env (ver docs/INSTAGRAM.md)');
    const u = new URL(`https://www.facebook.com/${VERSION()}/dialog/oauth`);
    u.searchParams.set('client_id', env.META_APP_ID);
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('state', state);
    u.searchParams.set('response_type', 'code');
    // "Facebook Login para empresas" usa una configuración (config_id); el inicio de sesión clásico, la lista de permisos
    if (env.META_CONFIG_ID) u.searchParams.set('config_id', env.META_CONFIG_ID);
    else u.searchParams.set('scope', PERMISOS.join(','));
    return u.toString();
  }

  async function canjearCodigo(code, redirectUri) {
    const g = createGraph({ fetchImpl });
    const corto = await g.get('oauth/access_token', { client_id: env.META_APP_ID, client_secret: env.META_APP_SECRET, redirect_uri: redirectUri, code });
    return conectarConToken(corto.access_token);
  }

  // Acepta un token de usuario (del OAuth o pegado desde el Explorador de la Graph API)
  async function conectarConToken(tokenUsuario, { paginaId } = {}) {
    const limpio = String(tokenUsuario || '').trim();
    if (!limpio) throw new Error('Falta el token');
    let token = limpio;
    if (appConfigurada()) {
      // Token de larga duración (60 días); el de la página derivado de él no caduca
      try {
        const largo = await createGraph({ fetchImpl }).get('oauth/access_token', { grant_type: 'fb_exchange_token', client_id: env.META_APP_ID, client_secret: env.META_APP_SECRET, fb_exchange_token: limpio });
        token = largo.access_token || limpio;
      } catch { /* si falla, seguimos con el token tal cual */ }
    }
    const g = createGraph({ token, fetchImpl });
    const paginas = await g.todo('me/accounts', { fields: 'id,name,access_token,instagram_business_account{id,username,profile_picture_url}' }, 100);
    const conIg = paginas.filter((p) => p.instagram_business_account);
    if (!conIg.length) throw new Error('No encuentro ninguna página de Facebook con una cuenta de Instagram profesional vinculada. Revisa que la cuenta sea de Empresa o Creador y que diste permiso a esa página.');
    const p = (paginaId && conIg.find((x) => x.id === paginaId)) || conIg[0];
    const ig = p.instagram_business_account;
    const c = { token: p.access_token || token, tokenUsuario: token, igUserId: ig.id, username: ig.username, foto: ig.profile_picture_url || null, paginaId: p.id, paginaNombre: p.name, conectado: new Date().toISOString(), otras: conIg.filter((x) => x !== p).map((x) => ({ id: x.id, nombre: x.name, username: x.instagram_business_account.username })) };
    aj.guardar('instagram', c);
    alCambiar();
    return { username: c.username, pagina: c.paginaNombre, otras: c.otras };
  }

  function desconectar() {
    aj.borrar('instagram');
    alCambiar();
    return { ok: true };
  }

  // ---------- Sincronización ----------
  async function insightsMedia(g, m) {
    const pedir = (metricas) => g.get(`${m.id}/insights`, { metric: metricas });
    const reel = formatoDe(m) === 'Reels';
    const extra = reel ? [...METRICAS_EXTRA, 'ig_reels_avg_watch_time'] : METRICAS_EXTRA;
    let datos = [];
    try {
      datos = (await pedir([...METRICAS_BASE, ...extra])).data || [];
    } catch (e) {
      if (e instanceof MetaError && e.caducado) throw e;
      // Algunas métricas no existen para ciertos tipos o cuentas: vamos con las básicas y luego una a una
      try { datos = (await pedir(METRICAS_BASE)).data || []; } catch (e2) { if (e2 instanceof MetaError && e2.caducado) throw e2; }
      for (const met of extra) {
        try { datos.push(...((await pedir([met])).data || [])); } catch (e3) { if (e3 instanceof MetaError && e3.caducado) throw e3; }
      }
    }
    const v = Object.fromEntries(datos.map((d) => [d.name, d.values?.[0]?.value ?? d.total_value?.value ?? null]));
    return {
      alcance: v.reach ?? null,
      views: v.views ?? null,
      guardados: v.saved ?? null,
      compartidos: v.shares ?? null,
      interacciones: v.total_interactions ?? null,
      ver_medio_ms: v.ig_reels_avg_watch_time ?? null,
    };
  }

  async function serieCuenta(g, igId, metrica, dias = 30) {
    const until = Math.floor(Date.now() / 1000);
    const since = until - dias * 86400;
    try {
      const r = await g.get(`${igId}/insights`, { metric: metrica, period: 'day', since, until });
      return r.data?.[0]?.values || [];
    } catch (e) {
      if (e instanceof MetaError && e.caducado) throw e;
      return [];
    }
  }

  // Windsor entrega las filas y aquí se guardan en las mismas tablas que usa la app de Meta
  const guardarWindsor = {
    guardarMedia: (f) => { const m = mediaDeWindsor(f); q.upsert.run({ ...m, gancho: primeraFrase(m.caption) }); },
    guardarSerie: (dia, metrica, valor) => q.serie.run(dia, metrica, valor),
    guardarHistoria: (f) => q.historia.run(String(f.story_id), normalizarFecha(f.story_timestamp || f.timestamp || f.date), JSON.stringify(f)),
  };

  async function sincronizar(opciones = {}) {
    const c = conexion();
    if (!c?.token && windsor.configurado()) return sincronizarWindsor(opciones);
    if (!c?.token) throw new Error('Instagram no está conectado');
    const r = await sincronizarMeta(opciones);
    // Con las dos fuentes, Windsor completa las métricas que la app de Meta no trae
    if (windsor.configurado()) { try { await windsor.sincronizar(guardarWindsor); } catch (e) { aj.guardar('windsor_sync', { ...windsor.estado(), error: e.message }); } alCambiar(); }
    return r;
  }

  async function sincronizarWindsor({ transcribir = true } = {}) {
    if (sincronizando) return { ok: false, motivo: 'Ya hay una sincronización en marcha' };
    sincronizando = true;
    const inicio = new Date().toISOString();
    aj.guardar('instagram_sync', { ...aj.leer('instagram_sync', {}), inicio, error: null });
    alCambiar();
    try {
      const r = await windsor.sincronizar(guardarWindsor);
      const trans = transcribir ? await transcribirPendientes() : { hechas: 0 };
      aj.guardar('instagram_sync', { inicio, fin: new Date().toISOString(), publicaciones: r.publicaciones, transcritas: trans.hechas, error: null, fuente: 'windsor' });
      return { ok: true, fuente: 'windsor', publicaciones: r.publicaciones, dias: r.dias, historias: r.historias, metricas: r.metricas.length, transcritas: trans.hechas, avisos: r.avisos };
    } catch (e) {
      aj.guardar('instagram_sync', { ...aj.leer('instagram_sync', {}), inicio, error: e.message });
      throw e;
    } finally {
      sincronizando = false;
      alCambiar();
    }
  }

  async function sincronizarMeta({ transcribir = true, max = Number(env.IG_MAX_PUBLICACIONES) || 150 } = {}) {
    const c = conexion();
    if (sincronizando) return { ok: false, motivo: 'Ya hay una sincronización en marcha' };
    sincronizando = true;
    const inicio = new Date().toISOString();
    aj.guardar('instagram_sync', { ...aj.leer('instagram_sync', {}), inicio, error: null });
    alCambiar();
    try {
      const g = createGraph({ token: c.token, fetchImpl });
      const perfil = await g.get(c.igUserId, { fields: 'username,profile_picture_url,followers_count,follows_count,media_count' });
      aj.guardar('instagram', { ...c, username: perfil.username || c.username, foto: perfil.profile_picture_url || c.foto });
      const hoy = fechaLocal(Date.now());
      q.serie.run(hoy, 'seguidores', perfil.followers_count ?? 0);

      for (const v of await serieCuenta(g, c.igUserId, 'reach')) q.serie.run(fechaLocal(new Date(v.end_time).getTime() - DIA / 2), 'alcance', v.value ?? 0);
      for (const v of await serieCuenta(g, c.igUserId, 'follower_count')) q.serie.run(fechaLocal(new Date(v.end_time).getTime() - DIA / 2), 'nuevos', v.value ?? 0);

      const media = await g.todo(`${c.igUserId}/media`, { fields: CAMPOS_MEDIA, limit: 50 }, max);
      let n = 0;
      for (const m of media) {
        const ins = await insightsMedia(g, m);
        q.upsert.run({
          id: m.id, tipo: m.media_type, formato: formatoDe(m), caption: m.caption || null, permalink: m.permalink || null,
          miniatura: m.thumbnail_url || (m.media_type === 'IMAGE' ? m.media_url : null) || null,
          media_url: m.media_type === 'VIDEO' ? m.media_url || null : null,
          fecha: m.timestamp, likes: m.like_count ?? null, comentarios: m.comments_count ?? null, ...ins,
          gancho: primeraFrase(m.caption), extra: null,
        });
        n++;
      }
      const trans = transcribir ? await transcribirPendientes() : { hechas: 0 };
      const fin = new Date().toISOString();
      aj.guardar('instagram_sync', { inicio, fin, publicaciones: n, transcritas: trans.hechas, error: null });
      return { ok: true, publicaciones: n, transcritas: trans.hechas };
    } catch (e) {
      aj.guardar('instagram_sync', { ...aj.leer('instagram_sync', {}), inicio, error: e.message });
      throw e;
    } finally {
      sincronizando = false;
      alCambiar();
    }
  }

  // ---------- Transcripción de reels → 03-Transcripciones ----------
  async function transcribirPendientes(max = Number(env.IG_TRANSCRIBIR_MAX) || 10) {
    if (!sttConfigurado(env)) return { hechas: 0, motivo: 'Sin ElevenLabs' };
    let hechas = 0;
    for (const m of rows(q.porTranscribir, max)) {
      try {
        const r = await fetchImpl(m.media_url, { signal: AbortSignal.timeout(120000) });
        if (!r.ok) throw new Error(`No se pudo descargar el vídeo (${r.status})`);
        const texto = await sttImpl(Buffer.from(await r.arrayBuffer()), { env, fetchImpl });
        if (!texto) throw new Error('La transcripción salió vacía (¿vídeo sin voz?)');
        const fecha = fechaLocal(m.fecha);
        const titulo = `${fecha} ${(primeraFrase(m.caption) || primeraFrase(texto) || 'Reel').replace(/[#@]/g, '').slice(0, 60)}`;
        const fm = ['---', 'tipo: transcripcion', `ig_id: ${m.id}`, `fecha: ${fecha}`, `formato: ${m.formato}`,
          m.permalink && `enlace: ${m.permalink}`, m.alcance != null && `alcance: ${m.alcance}`, m.views != null && `visualizaciones: ${m.views}`,
          m.guardados != null && `guardados: ${m.guardados}`, m.compartidos != null && `compartidos: ${m.compartidos}`, '---'].filter(Boolean).join('\n');
        const caption = m.caption ? `\n> **Caption:** ${m.caption.replace(/\n+/g, ' ')}\n` : '';
        const nota = vault.create('03-Transcripciones', titulo, `${fm}\n# ${titulo}\n${caption}\n## Transcripción\n\n${texto}\n`);
        q.transcrita.run(nota, primeraFrase(texto), m.id);
        hechas++;
      } catch (e) {
        q.errorTrans.run(e.message.slice(0, 200), m.id);
      }
    }
    if (hechas) alCambiar();
    return { hechas };
  }

  // ---------- Temas (los pone JARVIS con el MCP) ----------
  const sinTema = (limite = 40) => rows(q.sinTema, limite);
  function etiquetar(lista = []) {
    let n = 0;
    for (const { id, tema } of lista) {
      const t = String(tema || '').trim().slice(0, 40);
      if (id && t) n += q.setTema.run(t, String(id)).changes;
    }
    if (n) alCambiar();
    return { etiquetadas: n };
  }
  const temas = () => rows(q.temas);

  // ---------- Datos de los dashboards ----------
  function resumen({ dias = 30 } = {}) {
    const est = estado();
    // Con Windsor recién puesto y sin sincronizar aún, se siguen viendo los datos de ejemplo
    const hayDatos = est.conectadoMeta || Boolean(est.ultimaSync || est.publicaciones);
    if (!est.conectado || !hayDatos) return { ...agregar({ ...demoInstagram(), dias }), estado: est, demo: true, todas: null };
    const desde = fechaLocal(Date.now() - dias * 2 * DIA);
    const serie = rows(q.series, desde);
    return { ...agregar({ media: rows(q.media), serie, dias }), estado: est, demo: false, todas: todasLasMetricas({ serie, historias: rows(q.historias, fechaLocal(Date.now() - dias * DIA)), dias }) };
  }

  return { estado, urlConexion, canjearCodigo, conectarConToken, desconectar, sincronizar, transcribirPendientes, sinTema, etiquetar, temas, resumen, conexion };
}

// Todas las métricas de cuenta e historias que trae Windsor, para el periodo (función pura)
export function todasLasMetricas({ serie, historias = [], dias = 30, hoy = Date.now() }) {
  const diasLista = Array.from({ length: dias }, (_, i) => fechaLocal(hoy - (dias - 1 - i) * DIA));
  const ini = diasLista[0], iniPrev = fechaLocal(hoy - (dias * 2 - 1) * DIA);
  const nombres = [...new Set(serie.filter((s) => s.metrica.startsWith('w:')).map((s) => s.metrica.slice(2)))];
  const cuenta = nombres.map((id) => {
    const l = serie.filter((s) => s.metrica === `w:${id}`);
    const m = new Map(l.map((s) => [s.fecha, s.valor]));
    const instantanea = INSTANTANEAS.has(id);
    const actual = l.filter((s) => s.fecha >= ini), previo = l.filter((s) => s.fecha >= iniPrev && s.fecha < ini);
    const total = (x) => (instantanea ? [...x].sort((a, b) => a.fecha.localeCompare(b.fecha)).at(-1)?.valor ?? null : x.reduce((a, s) => a + s.valor, 0));
    const valor = total(actual), antes = total(previo);
    return {
      id, label: ETIQUETAS[id] || id.replace(/_/g, ' '), valor, instantanea,
      delta: !instantanea && antes ? Math.round(((valor - antes) / antes) * 100) : null,
      series: diasLista.map((d) => m.get(d) ?? 0),
    };
  }).filter((x) => x.valor !== null).sort((a, b) => a.label.localeCompare(b.label, 'es'));
  // Historias: se suman sus métricas numéricas
  const sumas = {};
  for (const h of historias) {
    let d; try { d = JSON.parse(h.datos); } catch { continue; }
    for (const [k, v] of Object.entries(d)) { const n = Number(v); if (k.startsWith('story_') && k !== 'story_id' && v !== '' && v !== null && Number.isFinite(n)) sumas[k] = (sumas[k] || 0) + n; }
  }
  const hist = Object.entries(sumas).map(([id, valor]) => ({ id, label: ETIQUETAS[id] || id.replace(/_/g, ' '), valor })).sort((a, b) => a.label.localeCompare(b.label, 'es'));
  return { cuenta, historias: { total: historias.length, metricas: hist } };
}

// Agrega publicaciones y series en los KPIs y tablas de los dos dashboards (función pura).
export function agregar({ media, serie, dias = 30, hoy = Date.now() }) {
  const fin = fechaLocal(hoy);
  const ini = fechaLocal(hoy - (dias - 1) * DIA);
  const iniPrev = fechaLocal(hoy - (dias * 2 - 1) * DIA);
  const diasLista = Array.from({ length: dias }, (_, i) => fechaLocal(hoy - (dias - 1 - i) * DIA));

  const conFecha = media.map((m) => ({ ...m, dia: fechaLocal(m.fecha) }));
  const actual = conFecha.filter((m) => m.dia >= ini && m.dia <= fin);
  const previo = conFecha.filter((m) => m.dia >= iniPrev && m.dia < ini);
  const suma = (lista, k) => lista.reduce((a, m) => a + (Number(m[k]) || 0), 0);
  const pct = (a, b) => (b ? Math.round(((a - b) / b) * 100) : a ? 100 : 0);

  const valorSerie = (metrica) => {
    const m = new Map(serie.filter((s) => s.metrica === metrica).map((s) => [s.fecha, s.valor]));
    return diasLista.map((d) => m.get(d) ?? 0);
  };
  const sumaSerie = (metrica, desde, hasta) => serie.filter((s) => s.metrica === metrica && s.fecha >= desde && s.fecha <= hasta).reduce((a, s) => a + s.valor, 0);
  const porDia = (lista, k) => { const m = new Map(); for (const x of lista) m.set(x.dia, (m.get(x.dia) || 0) + (Number(x[k]) || 0)); return diasLista.map((d) => m.get(d) || 0); };

  const hayAlcanceCuenta = serie.some((s) => s.metrica === 'alcance');
  const alcanceSerie = hayAlcanceCuenta ? valorSerie('alcance') : porDia(actual, 'alcance');
  const alcance = alcanceSerie.reduce((a, b) => a + b, 0);
  const alcancePrev = hayAlcanceCuenta ? sumaSerie('alcance', iniPrev, fechaLocal(hoy - dias * DIA)) : suma(previo, 'alcance');
  const nuevosSerie = valorSerie('nuevos');
  const seguidoresUlt = [...serie].filter((s) => s.metrica === 'seguidores').sort((a, b) => a.fecha.localeCompare(b.fecha)).at(-1)?.valor ?? null;

  const kpis = [
    { id: 'alcance', label: 'Alcance', value: alcance, delta: pct(alcance, alcancePrev), icon: 'eye', color: 'var(--accent-2)', series: alcanceSerie },
    { id: 'views', label: 'Visualizaciones', value: suma(actual, 'views'), delta: pct(suma(actual, 'views'), suma(previo, 'views')), icon: 'play', color: 'var(--purple)', series: porDia(actual, 'views') },
    { id: 'interacciones', label: 'Interacción', value: suma(actual, 'interacciones'), delta: pct(suma(actual, 'interacciones'), suma(previo, 'interacciones')), icon: 'heart', color: 'var(--pink)', series: porDia(actual, 'interacciones') },
    { id: 'seguidores', label: 'Seguidores', value: seguidoresUlt, extra: nuevosSerie.reduce((a, b) => a + b, 0), delta: null, icon: 'users', color: 'var(--green)', series: nuevosSerie },
    { id: 'guardados', label: 'Guardados', value: suma(actual, 'guardados'), delta: pct(suma(actual, 'guardados'), suma(previo, 'guardados')), icon: 'bookmark', color: 'var(--orange)', series: porDia(actual, 'guardados') },
    { id: 'compartidos', label: 'Compartidos', value: suma(actual, 'compartidos'), delta: pct(suma(actual, 'compartidos'), suma(previo, 'compartidos')), icon: 'share', color: 'var(--cyan)', series: porDia(actual, 'compartidos') },
  ];

  const viewsDia = porDia(actual, 'views');
  const diaria = diasLista.map((fecha, i) => ({ fecha, alcance: alcanceSerie[i], views: viewsDia[i], nuevos: nuevosSerie[i] }));

  const FORMATOS = ['Reels', 'Carruseles', 'Imágenes'];
  const viewsTot = suma(actual, 'views') || suma(actual, 'alcance') || 1;
  const formatos = FORMATOS.map((f) => {
    const l = actual.filter((m) => m.formato === f);
    const v = suma(l, 'views') || suma(l, 'alcance');
    return { formato: f, piezas: l.length, valor: v, pct: Math.round((v / viewsTot) * 100), alcanceMedio: l.length ? Math.round(suma(l, 'alcance') / l.length) : 0 };
  }).filter((f) => f.piezas > 0);

  const tasa = (m) => (m.alcance ? (Number(m.interacciones) || 0) / m.alcance : 0);
  const mediaAlcance = actual.length ? suma(actual, 'alcance') / actual.length : 0;
  const mediaTasa = actual.length ? actual.reduce((a, m) => a + tasa(m), 0) / actual.length : 0;

  const grupos = new Map();
  for (const m of actual) { const k = m.tema || 'Sin clasificar'; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(m); }
  const interTot = suma(actual, 'interacciones') || 1;
  const temas = [...grupos.entries()].map(([tema, l]) => ({
    tema, piezas: l.length, alcanceMedio: Math.round(suma(l, 'alcance') / l.length),
    tasa: Math.round((l.reduce((a, m) => a + tasa(m), 0) / l.length) * 1000) / 10,
    pct: Math.round((suma(l, 'interacciones') / interTot) * 100),
  })).sort((a, b) => b.tasa - a.tasa);

  const ganchos = [...actual].filter((m) => m.gancho).sort((a, b) => (b.views || b.alcance || 0) - (a.views || a.alcance || 0)).slice(0, 5)
    .map((m) => ({ id: m.id, gancho: m.gancho, views: m.views, alcance: m.alcance, formato: m.formato }));

  const piezas = actual.map((m) => ({
    id: m.id, fecha: m.fecha, formato: m.formato, caption: m.caption, permalink: m.permalink, miniatura: m.miniatura,
    alcance: m.alcance, views: m.views, interacciones: m.interacciones, guardados: m.guardados, compartidos: m.compartidos,
    likes: m.likes, comentarios: m.comentarios, ver_medio_ms: m.ver_medio_ms, tema: m.tema, gancho: m.gancho,
    transcrita: Boolean(m.transcrita), nota: m.nota,
    tasa: Math.round(tasa(m) * 1000) / 10,
    vsMedia: mediaAlcance ? Math.round(((m.alcance || 0) / mediaAlcance - 1) * 100) : 0,
  })).sort((a, b) => b.fecha.localeCompare(a.fecha));

  return { dias, kpis, diaria, formatos, temas, ganchos, piezas, medias: { alcance: Math.round(mediaAlcance), tasa: Math.round(mediaTasa * 1000) / 10 } };
}
