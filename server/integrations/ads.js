import { ajustes, row, rows } from '../db.js';
import { createGraph, MetaError } from './meta.js';
import { demoAds } from './ads-demo.js';

// Meta Ads: rendimiento de tus campañas, Ad Library de la competencia, qué contenido impulsar
// y campañas por chat. REGLA DE ORO: JARVIS solo propone borradores; la campaña se crea cuando
// la persona confirma en el dashboard, y SIEMPRE en pausa. Activarla es cosa suya, en Meta.

const DIA = 86400000;
const CACHE_MIN = 15;
// Una caché por periodo (Inicio pide 7 días y la pestaña Meta Ads 30): así no se pisan
const PERIODOS_CACHE = [7, 14, 30, 60, 90];
export const OBJETIVOS = {
  interaccion: { objective: 'OUTCOME_ENGAGEMENT', optimization_goal: 'POST_ENGAGEMENT', destination_type: 'ON_POST', etiqueta: 'Interacción' },
  alcance: { objective: 'OUTCOME_AWARENESS', optimization_goal: 'REACH', etiqueta: 'Alcance' },
};
const RESULTADOS = ['onsite_conversion.messaging_conversation_started_7d', 'lead', 'onsite_conversion.lead_grouped', 'link_click', 'post_engagement', 'video_view'];
const NOMBRE_RESULTADO = { 'onsite_conversion.messaging_conversation_started_7d': 'conversaciones', lead: 'leads', 'onsite_conversion.lead_grouped': 'leads', link_click: 'clics en enlace', post_engagement: 'interacciones', video_view: 'reproducciones' };

const publico = (m) => Object.assign(new Error(m), { publico: true });
export const normalizarCuenta = (c) => { const s = String(c || '').trim().replace(/\s/g, ''); return !s ? null : s.startsWith('act_') ? s : `act_${s.replace(/\D/g, '')}`; };

// Toda creación pasa por aquí: si algo intentara crear un objeto activo, se para en seco.
export function soloEnPausa(params) {
  if (params.status !== 'PAUSED') throw new Error('Bloqueado: JARVIS solo crea campañas, conjuntos y anuncios en PAUSA');
  return params;
}

export function createAds({ db, instagram, env = process.env, fetchImpl = fetch, alCambiar = () => {} }) {
  const aj = ajustes(db);
  const borrarCache = () => { aj.borrar('ads_cache'); for (const d of PERIODOS_CACHE) aj.borrar(`ads_cache_${d}`); };
  const q = {
    upLib: db.prepare(`INSERT INTO ads_biblioteca (id, competidor, pagina_id, pagina, cuerpo, titulo, inicio, fin, snapshot, plataformas, alcance_ue)
      VALUES (@id, @competidor, @pagina_id, @pagina, @cuerpo, @titulo, @inicio, @fin, @snapshot, @plataformas, @alcance_ue)
      ON CONFLICT(id) DO UPDATE SET fin = excluded.fin, alcance_ue = excluded.alcance_ue, actualizado = datetime('now','localtime')`),
    lib: db.prepare('SELECT * FROM ads_biblioteca ORDER BY inicio ASC'),
    perfiles: db.prepare('SELECT username, nombre, fb_pagina FROM comp_perfiles WHERE activo = 1'),
    setPagina: db.prepare('UPDATE comp_perfiles SET fb_pagina = ? WHERE username = ?'),
    insBorrador: db.prepare('INSERT INTO ads_borradores (datos, origen) VALUES (?, ?)'),
    borrador: db.prepare('SELECT * FROM ads_borradores WHERE id = ?'),
    borradores: db.prepare("SELECT * FROM ads_borradores WHERE estado IN ('borrador', 'creando', 'creada', 'error') ORDER BY id DESC LIMIT 20"),
    setEstado: db.prepare('UPDATE ads_borradores SET estado = ?, resultado = ? WHERE id = ?'),
    media: db.prepare("SELECT * FROM ig_media WHERE fecha >= ? AND alcance > 0 ORDER BY fecha DESC"),
    mediaId: db.prepare('SELECT * FROM ig_media WHERE id = ?'),
  };

  const cuenta = () => normalizarCuenta(aj.leer('ads', {}).cuenta || env.META_AD_ACCOUNT_ID);
  const tokenUsuario = () => instagram.conexion()?.tokenUsuario || null;
  const graph = () => {
    const t = tokenUsuario();
    if (!t) throw publico('Conecta primero Instagram con Facebook (pestaña Instagram): Meta Ads usa la misma conexión.');
    return createGraph({ token: t, fetchImpl });
  };
  const maxDia = () => Number(env.ADS_PRESUPUESTO_MAX_DIA) || 50;

  function estado() {
    return { conectado: Boolean(tokenUsuario()), cuenta: cuenta(), maxPresupuestoDia: maxDia(), pais: env.ADS_PAIS || 'ES' };
  }

  async function cuentas() {
    const r = await graph().todo('me/adaccounts', { fields: 'id,name,account_status,currency' }, 50);
    return r.map((c) => ({ id: c.id, nombre: c.name, activa: c.account_status === 1, moneda: c.currency }));
  }
  function elegirCuenta(id) {
    const c = normalizarCuenta(id);
    if (!c || !/^act_\d+$/.test(c)) throw publico('El ID de la cuenta publicitaria debe ser un número (o act_ seguido del número)');
    aj.guardar('ads', { ...aj.leer('ads', {}), cuenta: c });
    borrarCache();
    alCambiar();
    return { cuenta: c };
  }

  // ---------- Rendimiento ----------
  const resultadoDe = (actions = []) => {
    for (const t of RESULTADOS) { const a = actions.find((x) => x.action_type === t); if (a) return { valor: Number(a.value), tipo: NOMBRE_RESULTADO[t] }; }
    return { valor: 0, tipo: 'resultados' };
  };

  async function rendimiento({ dias = 30, forzar = false } = {}) {
    const c = cuenta();
    if (!c) throw publico('Falta la cuenta publicitaria: elígela en la pestaña Meta Ads o pon META_AD_ACCOUNT_ID en .env');
    const cache = aj.leer(`ads_cache_${dias}`);
    if (!forzar && cache?.dias === dias && cache.cuenta === c && Date.now() - cache.ts < CACHE_MIN * 60000) return cache.datos;
    const g = graph();
    const since = new Date(Date.now() - (dias - 1) * DIA).toLocaleDateString('sv-SE');
    const until = new Date().toLocaleDateString('sv-SE');
    const time_range = { since, until };
    const [info, campanas, insights, diario] = await Promise.all([
      g.get(c, { fields: 'name,currency,account_status' }),
      g.todo(`${c}/campaigns`, { fields: 'id,name,status,effective_status,objective,daily_budget,lifetime_budget,created_time', limit: 100 }, 200),
      g.todo(`${c}/insights`, { level: 'campaign', fields: 'campaign_id,campaign_name,spend,impressions,reach,clicks,ctr,cpc,cpm,actions', time_range, limit: 200 }, 400),
      g.todo(`${c}/insights`, { fields: 'spend,clicks,impressions', time_increment: 1, time_range, limit: 100 }, 100),
    ]);
    const porCampana = new Map(insights.map((i) => [i.campaign_id, i]));
    const filas = campanas.map((k) => {
      const i = porCampana.get(k.id) || {};
      const res = resultadoDe(i.actions);
      const gasto = Number(i.spend) || 0;
      return {
        id: k.id, nombre: k.name, estado: k.effective_status || k.status, objetivo: k.objective,
        gasto, impresiones: Number(i.impressions) || 0, alcance: Number(i.reach) || 0, clics: Number(i.clicks) || 0,
        ctr: Number(i.ctr) || 0, cpc: Number(i.cpc) || 0, cpm: Number(i.cpm) || 0,
        resultados: res.valor, tipoResultado: res.tipo, costeResultado: res.valor ? Math.round((gasto / res.valor) * 100) / 100 : null,
      };
    }).filter((f) => f.gasto > 0 || ['ACTIVE', 'PAUSED'].includes(f.estado)).sort((a, b) => b.gasto - a.gasto);
    const sum = (k) => filas.reduce((a, f) => a + f[k], 0);
    const gasto = sum('gasto'), impresiones = sum('impresiones'), clics = sum('clics');
    const datos = {
      cuenta: { id: c, nombre: info.name, moneda: info.currency, activa: info.account_status === 1 },
      dias,
      totales: { gasto, impresiones, clics, ctr: impresiones ? Math.round((clics / impresiones) * 10000) / 100 : 0, cpc: clics ? Math.round((gasto / clics) * 100) / 100 : 0, cpm: impresiones ? Math.round((gasto / impresiones) * 100000) / 100 : 0 },
      diario: diario.map((d) => ({ fecha: d.date_start, gasto: Number(d.spend) || 0, clics: Number(d.clicks) || 0 })),
      campanas: filas,
      actualizado: new Date().toISOString(),
    };
    aj.guardar(`ads_cache_${dias}`, { ts: Date.now(), dias, cuenta: c, datos });
    return datos;
  }

  // ---------- Ad Library (anuncios de la competencia) ----------
  function paginaCompetidor(usuario, pagina) {
    q.setPagina.run(String(pagina || '').trim() || null, String(usuario).replace(/^@/, '').toLowerCase());
    alCambiar();
    return { ok: true };
  }

  async function sincronizarBiblioteca() {
    const g = graph();
    const pais = env.ADS_PAIS || 'ES';
    const res = { anuncios: 0, errores: [] };
    for (const p of rows(q.perfiles)) {
      const ref = p.fb_pagina || p.nombre || p.username;
      const params = {
        ad_reached_countries: [pais], ad_active_status: 'ALL', ad_type: 'ALL', limit: 50,
        fields: 'id,page_id,page_name,ad_creative_bodies,ad_creative_link_titles,ad_delivery_start_time,ad_delivery_stop_time,ad_snapshot_url,publisher_platforms,eu_total_reach',
        ...(/^\d+$/.test(ref) ? { search_page_ids: [ref] } : { search_terms: ref }),
      };
      try {
        const anuncios = await g.todo('ads_archive', params, 50);
        for (const a of anuncios) {
          q.upLib.run({
            id: a.id, competidor: p.username, pagina_id: a.page_id || null, pagina: a.page_name || null,
            cuerpo: a.ad_creative_bodies?.[0] || null, titulo: a.ad_creative_link_titles?.[0] || null,
            inicio: a.ad_delivery_start_time || null, fin: a.ad_delivery_stop_time || null, snapshot: a.ad_snapshot_url || null,
            plataformas: (a.publisher_platforms || []).join(', ') || null, alcance_ue: a.eu_total_reach ?? null,
          });
          res.anuncios++;
        }
      } catch (e) {
        if (e instanceof MetaError && e.caducado) throw e;
        const msg = e instanceof MetaError && (e.codigo === 10 || e.codigo === 200 || /identity|identidad/i.test(e.message))
          ? 'La Ad Library necesita que verifiques tu identidad en Meta (facebook.com/ID) y aceptes las condiciones en facebook.com/ads/library/api.'
          : e.message;
        res.errores.push({ competidor: p.username, error: msg });
      }
    }
    aj.guardar('ads_lib_sync', { fin: new Date().toISOString(), errores: res.errores });
    alCambiar();
    return res;
  }

  function biblioteca() {
    const hoy = Date.now();
    return rows(q.lib).map((a) => ({
      ...a,
      activo: !a.fin || new Date(a.fin).getTime() > hoy,
      diasActivo: a.inicio ? Math.max(1, Math.round(((a.fin ? Math.min(new Date(a.fin).getTime(), hoy) : hoy) - new Date(a.inicio).getTime()) / DIA)) : null,
    })).sort((a, b) => (b.activo - a.activo) || ((b.diasActivo || 0) - (a.diasActivo || 0)));
  }

  // ---------- Qué contenido orgánico impulsar ----------
  function recomendarImpulso(media = rows(q.media, new Date(Date.now() - 60 * DIA).toISOString())) {
    if (!media.length) return [];
    const tasa = (m) => (m.alcance ? ((m.guardados || 0) + 1.5 * (m.compartidos || 0)) / m.alcance : 0);
    const inter = (m) => (m.alcance ? (m.interacciones || 0) / m.alcance : 0);
    const mediaTasa = media.reduce((a, m) => a + tasa(m), 0) / media.length;
    const mediaInter = media.reduce((a, m) => a + inter(m), 0) / media.length;
    return media
      .map((m) => ({ m, score: tasa(m) / (mediaTasa || 1) + inter(m) / (mediaInter || 1) }))
      .sort((a, b) => b.score - a.score)
      .filter(({ m }, i, l) => l.findIndex((x) => (x.m.gancho || x.m.id) === (m.gancho || m.id)) === i)
      .slice(0, 3)
      .map(({ m, score }) => ({
        id: m.id, formato: m.formato, gancho: m.gancho || (m.caption || '').slice(0, 80), permalink: m.permalink, miniatura: m.miniatura, fecha: m.fecha, tema: m.tema,
        alcance: m.alcance, guardados: m.guardados, compartidos: m.compartidos, interacciones: m.interacciones,
        puntuacion: Math.round(score * 10) / 10,
        motivo: `Guarda y comparte ${Math.round((tasa(m) / (mediaTasa || 1)) * 10) / 10}× más que tu media e interactúa ${Math.round((inter(m) / (mediaInter || 1)) * 10) / 10}×: la gente ya lo valora, el anuncio solo le da más alcance.`,
      }));
  }

  // ---------- Borradores de campaña (propuesta → confirmación → creada en pausa) ----------
  function proponer(d = {}, origen = 'dashboard') {
    const objetivo = OBJETIVOS[d.objetivo] ? d.objetivo : 'interaccion';
    const presupuesto = Number(d.presupuestoDia);
    if (!(presupuesto >= 1)) throw publico('Indica un presupuesto diario de al menos 1 €');
    if (presupuesto > maxDia()) throw publico(`El presupuesto diario máximo permitido es ${maxDia()} € (ADS_PRESUPUESTO_MAX_DIA en .env)`);
    const dias = Math.round(Number(d.dias) || 7);
    if (dias < 1 || dias > 30) throw publico('La duración debe ser de 1 a 30 días');
    const pub = d.publicacionId ? row(q.mediaId, String(d.publicacionId)) : null;
    if (!pub) throw publico(String(d.publicacionId || '').startsWith('demo-') ? 'Es una publicación de ejemplo: conecta Instagram para impulsar las tuyas' : 'Elige una publicación de tu Instagram para impulsar (usa su id de metricas_instagram)');
    const edadMin = Math.max(18, Math.min(65, Number(d.edadMin) || 25));
    const edadMax = Math.max(edadMin, Math.min(65, Number(d.edadMax) || 55));
    const paises = (Array.isArray(d.paises) && d.paises.length ? d.paises : [env.ADS_PAIS || 'ES']).map((p) => String(p).toUpperCase().slice(0, 2));
    const datos = {
      nombre: String(d.nombre || `JARVIS · ${OBJETIVOS[objetivo].etiqueta} · ${(pub.gancho || 'publicación').slice(0, 40)}`).slice(0, 120),
      objetivo, presupuestoDia: Math.round(presupuesto * 100) / 100, dias, paises, edadMin, edadMax,
      publicacionId: pub.id, publicacion: { gancho: pub.gancho, permalink: pub.permalink, miniatura: pub.miniatura, formato: pub.formato },
      motivo: String(d.motivo || '').slice(0, 400),
      gastoMaximo: Math.round(presupuesto * dias * 100) / 100,
    };
    const { lastInsertRowid } = q.insBorrador.run(JSON.stringify(datos), origen);
    alCambiar();
    return { id: Number(lastInsertRowid), estado: 'borrador', ...datos, aviso: 'Borrador creado. La persona debe revisarlo y confirmarlo en la pestaña Meta Ads; se creará en PAUSA.' };
  }

  const leerBorrador = (id) => {
    const b = row(q.borrador, Number(id));
    if (!b) throw publico('Ese borrador no existe');
    return { ...b, datos: JSON.parse(b.datos), resultado: b.resultado ? JSON.parse(b.resultado) : null };
  };

  function descartar(id) {
    const b = leerBorrador(id);
    if (b.estado !== 'borrador' && b.estado !== 'error') throw publico('Solo se pueden descartar borradores');
    q.setEstado.run('descartada', null, b.id);
    alCambiar();
    return { ok: true };
  }

  // Solo se llama desde el botón "Crear en pausa" del dashboard (nunca desde el MCP)
  async function confirmar(id) {
    const b = leerBorrador(id);
    if (b.estado !== 'borrador') throw publico('Este borrador ya se procesó');
    const c = cuenta();
    if (!c) throw publico('Falta la cuenta publicitaria');
    const ig = instagram.conexion();
    const d = b.datos;
    const obj = OBJETIVOS[d.objetivo];
    const g = graph();
    const creados = {};
    q.setEstado.run('creando', null, b.id);
    alCambiar();
    let paso = 'campaña';
    try {
      const camp = await g.post(`${c}/campaigns`, soloEnPausa({ name: d.nombre, objective: obj.objective, status: 'PAUSED', special_ad_categories: [], is_adset_budget_sharing_enabled: false }));
      creados.campana = camp.id;
      paso = 'conjunto de anuncios';
      const inicio = new Date(Date.now() + 3600000);
      const adset = await g.post(`${c}/adsets`, soloEnPausa({
        name: `${d.nombre} · conjunto`, campaign_id: camp.id, status: 'PAUSED',
        daily_budget: Math.round(d.presupuestoDia * 100), billing_event: 'IMPRESSIONS', optimization_goal: obj.optimization_goal,
        bid_strategy: 'LOWEST_COST_WITHOUT_CAP', ...(obj.destination_type ? { destination_type: obj.destination_type } : {}),
        start_time: inicio.toISOString(), end_time: new Date(inicio.getTime() + d.dias * DIA).toISOString(),
        targeting: { geo_locations: { countries: d.paises }, age_min: d.edadMin, age_max: d.edadMax, publisher_platforms: ['instagram'], instagram_positions: ['stream', 'reels', 'explore', 'story'], targeting_automation: { advantage_audience: 0 } },
      }));
      creados.conjunto = adset.id;
      paso = 'creativo';
      const creativo = await g.post(`${c}/adcreatives`, { name: `${d.nombre} · creativo`, object_id: ig.paginaId, instagram_user_id: ig.igUserId, source_instagram_media_id: d.publicacionId });
      creados.creativo = creativo.id;
      paso = 'anuncio';
      const ad = await g.post(`${c}/ads`, soloEnPausa({ name: `${d.nombre} · anuncio`, adset_id: adset.id, creative: { creative_id: creativo.id }, status: 'PAUSED' }));
      creados.anuncio = ad.id;
      const resultado = { ...creados, enlace: `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${c.replace('act_', '')}&selected_campaign_ids=${camp.id}` };
      q.setEstado.run('creada', JSON.stringify(resultado), b.id);
      borrarCache();
      alCambiar();
      return { ok: true, estado: 'creada', ...resultado };
    } catch (e) {
      const resultado = { paso, error: e.message, creados };
      q.setEstado.run('error', JSON.stringify(resultado), b.id);
      alCambiar();
      throw publico(`No se pudo crear el ${paso}: ${e.message}${creados.campana ? ' (lo creado se queda en pausa; puedes borrarlo en el Administrador de anuncios)' : ''}`);
    }
  }

  // ---------- Datos del dashboard ----------
  async function resumen({ dias = 30 } = {}) {
    const est = estado();
    const borradores = rows(q.borradores).map((b) => ({ ...b, datos: JSON.parse(b.datos), resultado: b.resultado ? JSON.parse(b.resultado) : null }));
    const lib = biblioteca();
    const libSync = aj.leer('ads_lib_sync', {});
    const igConectado = instagram.estado().conectado;
    const demo = demoAds();
    let rend = null, errorRend = null;
    if (est.conectado && est.cuenta) {
      try { rend = await rendimiento({ dias }); } catch (e) { errorRend = e.message; }
    }
    const recomendados = igConectado ? recomendarImpulso() : recomendarImpulso(demo.media);
    return {
      estado: est, borradores,
      rendimiento: rend || demo.rendimiento, demoRendimiento: !rend, errorRendimiento: errorRend,
      biblioteca: lib.length ? lib : demo.biblioteca, demoBiblioteca: !lib.length, errorBiblioteca: libSync.errores?.[0]?.error || null, bibliotecaSync: libSync.fin || null,
      recomendados, demoRecomendados: !igConectado,
      competidores: rows(q.perfiles),
      objetivos: Object.entries(OBJETIVOS).map(([id, o]) => ({ id, etiqueta: o.etiqueta })),
    };
  }

  return { estado, cuentas, elegirCuenta, rendimiento, paginaCompetidor, sincronizarBiblioteca, biblioteca, recomendarImpulso, proponer, descartar, confirmar, leerBorrador, resumen };
}
