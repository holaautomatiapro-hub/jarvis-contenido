// El «Administrador de anuncios» dentro de JARVIS: todas las cuentas publicitarias a las que tienes acceso (las tuyas
// y las de cada Business Manager), sus campañas, conjuntos y anuncios con TODAS las métricas que da Meta, y el
// detalle de cada uno (día a día, por edad, sexo y ubicación, y el creativo). Solo lee: aquí no se cambia nada.

const MIN = 60_000;
const CACHE_MIN = 10;

// ---------- Catálogo de columnas (el servidor calcula todo y la interfaz enseña las que elijas) ----------
// formato: moneda · n (número) · pct (%) · dec (decimal) · seg (segundos) · texto · fecha · presupuesto
export const COLUMNAS = [
  { id: 'estado', nombre: 'Estado', grupo: 'Configuración', formato: 'texto' },
  { id: 'objetivo', nombre: 'Objetivo', grupo: 'Configuración', formato: 'texto' },
  { id: 'presupuesto', nombre: 'Presupuesto', grupo: 'Configuración', formato: 'presupuesto' },
  { id: 'optimizacion', nombre: 'Optimización', grupo: 'Configuración', formato: 'texto' },
  { id: 'puja', nombre: 'Estrategia de puja', grupo: 'Configuración', formato: 'texto' },
  { id: 'inicio', nombre: 'Inicio', grupo: 'Configuración', formato: 'fecha' },
  { id: 'fin', nombre: 'Fin', grupo: 'Configuración', formato: 'fecha' },

  { id: 'resultados', nombre: 'Resultados', grupo: 'Rendimiento', formato: 'n' },
  { id: 'coste_resultado', nombre: 'Coste por resultado', grupo: 'Rendimiento', formato: 'moneda' },
  { id: 'gasto', nombre: 'Importe gastado', grupo: 'Rendimiento', formato: 'moneda' },
  { id: 'impresiones', nombre: 'Impresiones', grupo: 'Rendimiento', formato: 'n' },
  { id: 'alcance', nombre: 'Alcance', grupo: 'Rendimiento', formato: 'n' },
  { id: 'frecuencia', nombre: 'Frecuencia', grupo: 'Rendimiento', formato: 'dec' },
  { id: 'cpm', nombre: 'CPM (coste por mil)', grupo: 'Rendimiento', formato: 'moneda' },

  { id: 'clics', nombre: 'Clics (todos)', grupo: 'Clics', formato: 'n' },
  { id: 'ctr', nombre: 'CTR (todos)', grupo: 'Clics', formato: 'pct' },
  { id: 'cpc', nombre: 'CPC (todos)', grupo: 'Clics', formato: 'moneda' },
  { id: 'clics_enlace', nombre: 'Clics en el enlace', grupo: 'Clics', formato: 'n' },
  { id: 'ctr_enlace', nombre: 'CTR del enlace', grupo: 'Clics', formato: 'pct' },
  { id: 'cpc_enlace', nombre: 'CPC del enlace', grupo: 'Clics', formato: 'moneda' },
  { id: 'visitas_landing', nombre: 'Visitas a la página de destino', grupo: 'Clics', formato: 'n' },
  { id: 'coste_landing', nombre: 'Coste por visita a la página', grupo: 'Clics', formato: 'moneda' },

  { id: 'interacciones', nombre: 'Interacciones con la publicación', grupo: 'Interacción', formato: 'n' },
  { id: 'coste_interaccion', nombre: 'Coste por interacción', grupo: 'Interacción', formato: 'moneda' },
  { id: 'reacciones', nombre: 'Reacciones', grupo: 'Interacción', formato: 'n' },
  { id: 'comentarios', nombre: 'Comentarios', grupo: 'Interacción', formato: 'n' },
  { id: 'compartidos', nombre: 'Veces compartido', grupo: 'Interacción', formato: 'n' },
  { id: 'guardados', nombre: 'Guardados', grupo: 'Interacción', formato: 'n' },
  { id: 'seguidores', nombre: 'Me gusta / seguidores de la página', grupo: 'Interacción', formato: 'n' },

  { id: 'conversaciones', nombre: 'Conversaciones iniciadas', grupo: 'Mensajes y leads', formato: 'n' },
  { id: 'coste_conversacion', nombre: 'Coste por conversación', grupo: 'Mensajes y leads', formato: 'moneda' },
  { id: 'leads', nombre: 'Leads', grupo: 'Mensajes y leads', formato: 'n' },
  { id: 'coste_lead', nombre: 'Coste por lead', grupo: 'Mensajes y leads', formato: 'moneda' },
  { id: 'registros', nombre: 'Registros completados', grupo: 'Mensajes y leads', formato: 'n' },
  { id: 'coste_registro', nombre: 'Coste por registro', grupo: 'Mensajes y leads', formato: 'moneda' },

  { id: 'compras', nombre: 'Compras', grupo: 'Ventas', formato: 'n' },
  { id: 'coste_compra', nombre: 'Coste por compra', grupo: 'Ventas', formato: 'moneda' },
  { id: 'valor_compras', nombre: 'Valor de las compras', grupo: 'Ventas', formato: 'moneda' },
  { id: 'roas', nombre: 'ROAS (retorno de la inversión)', grupo: 'Ventas', formato: 'dec' },
  { id: 'anadir_carrito', nombre: 'Añadidos al carrito', grupo: 'Ventas', formato: 'n' },
  { id: 'pagos_iniciados', nombre: 'Pagos iniciados', grupo: 'Ventas', formato: 'n' },

  { id: 'reproducciones', nombre: 'Reproducciones de 3 s', grupo: 'Vídeo', formato: 'n' },
  { id: 'hook_rate', nombre: 'Hook rate (3 s / impresiones)', grupo: 'Vídeo', formato: 'pct' },
  { id: 'thruplay', nombre: 'ThruPlays', grupo: 'Vídeo', formato: 'n' },
  { id: 'coste_thruplay', nombre: 'Coste por ThruPlay', grupo: 'Vídeo', formato: 'moneda' },
  { id: 'hold_rate', nombre: 'Hold rate (ThruPlay / 3 s)', grupo: 'Vídeo', formato: 'pct' },
  { id: 'p25', nombre: 'Vídeo visto al 25 %', grupo: 'Vídeo', formato: 'n' },
  { id: 'p50', nombre: 'Vídeo visto al 50 %', grupo: 'Vídeo', formato: 'n' },
  { id: 'p75', nombre: 'Vídeo visto al 75 %', grupo: 'Vídeo', formato: 'n' },
  { id: 'p95', nombre: 'Vídeo visto al 95 %', grupo: 'Vídeo', formato: 'n' },
  { id: 'p100', nombre: 'Vídeo visto al 100 %', grupo: 'Vídeo', formato: 'n' },
  { id: 'tiempo_medio', nombre: 'Tiempo medio de reproducción', grupo: 'Vídeo', formato: 'seg' },

  { id: 'calidad', nombre: 'Clasificación de calidad', grupo: 'Calidad (solo anuncios)', formato: 'texto' },
  { id: 'ranking_interaccion', nombre: 'Clasificación de interacción', grupo: 'Calidad (solo anuncios)', formato: 'texto' },
  { id: 'ranking_conversion', nombre: 'Clasificación de conversión', grupo: 'Calidad (solo anuncios)', formato: 'texto' },
];
export const COLUMNAS_POR_DEFECTO = ['estado', 'resultados', 'coste_resultado', 'gasto', 'impresiones', 'alcance', 'frecuencia', 'ctr_enlace', 'cpc_enlace', 'cpm', 'presupuesto'];
const IDS_COLUMNAS = new Set(COLUMNAS.map((c) => c.id));

// Nombres de las acciones de Meta más habituales (las demás salen con su nombre técnico)
const ACCIONES = {
  link_click: 'Clics en el enlace', landing_page_view: 'Visitas a la página de destino', post_engagement: 'Interacciones con la publicación',
  page_engagement: 'Interacciones con la página', post_reaction: 'Reacciones', comment: 'Comentarios', post: 'Veces compartido', like: 'Me gusta de la página',
  'onsite_conversion.post_save': 'Guardados', video_view: 'Reproducciones de 3 s', lead: 'Leads', 'onsite_conversion.lead_grouped': 'Leads (formulario de Meta)',
  'onsite_conversion.messaging_conversation_started_7d': 'Conversaciones iniciadas', 'onsite_conversion.messaging_first_reply': 'Primeras respuestas a mensajes',
  'onsite_conversion.total_messaging_connection': 'Contactos por mensaje', 'onsite_conversion.messaging_block': 'Bloqueos de mensajes',
  omni_purchase: 'Compras', purchase: 'Compras (web)', 'offsite_conversion.fb_pixel_purchase': 'Compras (píxel)', omni_add_to_cart: 'Añadidos al carrito',
  omni_initiated_checkout: 'Pagos iniciados', omni_complete_registration: 'Registros completados', complete_registration: 'Registros completados (web)',
  'offsite_conversion.fb_pixel_lead': 'Leads (píxel)', 'offsite_conversion.fb_pixel_complete_registration': 'Registros (píxel)',
  'offsite_conversion.fb_pixel_custom': 'Conversiones personalizadas (píxel)', 'offsite_conversion.fb_pixel_view_content': 'Contenido visto (píxel)',
  omni_view_content: 'Contenido visto', 'onsite_web_lead': 'Leads en la web', contact_total: 'Contactos', schedule_total: 'Citas programadas',
  'onsite_conversion.flow_complete': 'Formularios instantáneos completados', 'instagram_profile_visit': 'Visitas al perfil de Instagram',
};

const ESTADOS = {
  ACTIVE: 'Activa', PAUSED: 'En pausa', CAMPAIGN_PAUSED: 'Campaña en pausa', ADSET_PAUSED: 'Conjunto en pausa', ARCHIVED: 'Archivada', DELETED: 'Eliminada',
  IN_PROCESS: 'Procesando', WITH_ISSUES: 'Con problemas', DISAPPROVED: 'Rechazado', PENDING_REVIEW: 'En revisión', PREAPPROVED: 'Preaprobado',
  PENDING_BILLING_INFO: 'Falta el pago', ADSET_ARCHIVED: 'Conjunto archivado', CAMPAIGN_ARCHIVED: 'Campaña archivada',
};
const OBJETIVOS = {
  OUTCOME_ENGAGEMENT: 'Interacción', OUTCOME_LEADS: 'Clientes potenciales', OUTCOME_TRAFFIC: 'Tráfico', OUTCOME_AWARENESS: 'Reconocimiento',
  OUTCOME_SALES: 'Ventas', OUTCOME_APP_PROMOTION: 'Promoción de la app', LINK_CLICKS: 'Tráfico', POST_ENGAGEMENT: 'Interacción', MESSAGES: 'Mensajes',
  LEAD_GENERATION: 'Clientes potenciales', CONVERSIONS: 'Conversiones', REACH: 'Alcance', BRAND_AWARENESS: 'Reconocimiento', VIDEO_VIEWS: 'Reproducciones de vídeo',
};
const OPTIMIZACIONES = {
  LEAD_GENERATION: 'Clientes potenciales', QUALITY_LEAD: 'Leads de calidad', CONVERSATIONS: 'Conversaciones', LINK_CLICKS: 'Clics en el enlace',
  LANDING_PAGE_VIEWS: 'Visitas a la página de destino', POST_ENGAGEMENT: 'Interacción', THRUPLAY: 'ThruPlay', TWO_SECOND_CONTINUOUS_VIDEO_VIEWS: 'Reproducciones de 2 s',
  REACH: 'Alcance', IMPRESSIONS: 'Impresiones', OFFSITE_CONVERSIONS: 'Conversiones', VALUE: 'Valor de las conversiones', PROFILE_VISIT: 'Visitas al perfil',
  PAGE_LIKES: 'Me gusta de la página', AD_RECALL_LIFT: 'Recuerdo del anuncio', REPLIES: 'Respuestas', VISIT_INSTAGRAM_PROFILE: 'Visitas al perfil de Instagram',
};
const PUJAS = { LOWEST_COST_WITHOUT_CAP: 'Volumen máximo', LOWEST_COST_WITH_BID_CAP: 'Límite de puja', COST_CAP: 'Límite de coste por resultado', LOWEST_COST_WITH_MIN_ROAS: 'ROAS mínimo' };
const RANKINGS = { ABOVE_AVERAGE: 'Por encima de la media', AVERAGE: 'En la media', BELOW_AVERAGE_35: 'Por debajo (35 % inferior)', BELOW_AVERAGE_20: 'Por debajo (20 % inferior)', BELOW_AVERAGE_10: 'Por debajo (10 % inferior)', UNKNOWN: null };
export const PERIODOS = { today: 'Hoy', yesterday: 'Ayer', last_7d: 'Últimos 7 días', last_14d: 'Últimos 14 días', last_30d: 'Últimos 30 días', last_90d: 'Últimos 90 días', this_month: 'Este mes', last_month: 'El mes pasado', this_year: 'Este año', maximum: 'Desde siempre' };

// Qué cuenta como «resultado» según para qué se optimiza el conjunto (o, en una campaña, según su objetivo)
const POR_OPTIMIZACION = {
  LEAD_GENERATION: ['leads'], QUALITY_LEAD: ['leads'], CONVERSATIONS: ['conversaciones'], REPLIES: ['conversaciones'], LINK_CLICKS: ['clics_enlace'],
  LANDING_PAGE_VIEWS: ['visitas_landing'], POST_ENGAGEMENT: ['interacciones'], THRUPLAY: ['thruplay'], TWO_SECOND_CONTINUOUS_VIDEO_VIEWS: ['reproducciones'],
  REACH: ['alcance'], IMPRESSIONS: ['impresiones'], OFFSITE_CONVERSIONS: ['compras', 'leads', 'registros'], VALUE: ['compras'], PAGE_LIKES: ['seguidores'],
};
const POR_OBJETIVO = {
  OUTCOME_LEADS: ['leads', 'conversaciones', 'registros'], OUTCOME_ENGAGEMENT: ['conversaciones', 'interacciones', 'thruplay'], OUTCOME_TRAFFIC: ['visitas_landing', 'clics_enlace'],
  OUTCOME_AWARENESS: ['alcance'], OUTCOME_SALES: ['compras', 'pagos_iniciados', 'leads', 'registros'],
};
const HABITUALES = ['conversaciones', 'leads', 'compras', 'registros', 'clics_enlace', 'interacciones', 'reproducciones'];

const CAMPOS_INSIGHTS = 'spend,impressions,reach,frequency,clicks,inline_link_clicks,ctr,inline_link_click_ctr,cpc,cost_per_inline_link_click,cpm,actions,action_values,'
  + 'video_thruplay_watched_actions,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p95_watched_actions,video_p100_watched_actions,video_avg_time_watched_actions';
const CAMPOS_RANKING = 'quality_ranking,engagement_rate_ranking,conversion_rate_ranking';
const CAMPOS_CREATIVO = 'id,name,title,body,thumbnail_url,image_url,object_type,call_to_action_type,instagram_permalink_url,video_id,link_url,object_story_spec';
const NIVELES = {
  campanas: { api: 'campaign', ruta: 'campaigns', id: 'campaign_id', enlace: 'campaigns',
    campos: 'id,name,status,effective_status,objective,daily_budget,lifetime_budget,budget_remaining,bid_strategy,start_time,stop_time,created_time',
    estados: ['ACTIVE', 'PAUSED', 'IN_PROCESS', 'WITH_ISSUES'] },
  conjuntos: { api: 'adset', ruta: 'adsets', id: 'adset_id', enlace: 'adsets',
    campos: 'id,name,status,effective_status,campaign_id,campaign{name,objective,daily_budget,lifetime_budget},daily_budget,lifetime_budget,budget_remaining,optimization_goal,billing_event,bid_strategy,start_time,end_time,created_time',
    estados: ['ACTIVE', 'PAUSED', 'CAMPAIGN_PAUSED', 'IN_PROCESS', 'WITH_ISSUES'] },
  anuncios: { api: 'ad', ruta: 'ads', id: 'ad_id', enlace: 'ads',
    campos: 'id,name,status,effective_status,campaign_id,adset_id,campaign{name,objective},adset{name,optimization_goal},created_time,creative{id,thumbnail_url,image_url,object_type}',
    estados: ['ACTIVE', 'PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'IN_PROCESS', 'WITH_ISSUES', 'DISAPPROVED', 'PENDING_REVIEW', 'PREAPPROVED', 'PENDING_BILLING_INFO'] },
};

const n = (v) => Number(v) || 0;
const r2 = (v) => Math.round(v * 100) / 100;
const div = (a, b) => (b ? r2(a / b) : null);
const de = (lista, tipos) => { for (const t of tipos) { const a = (lista || []).find((x) => x.action_type === t); if (a) return n(a.value); } return 0; };
const video = (i, k) => n(i?.[k]?.[0]?.value);

// Una fila de insights de Meta → todas las métricas (las que no aplican se quedan a 0 o null)
export function metricasDe(i = {}) {
  const A = i.actions, V = i.action_values;
  const gasto = n(i.spend), impresiones = n(i.impressions), clics = n(i.clicks), clicsEnlace = n(i.inline_link_clicks);
  const m = {
    gasto, impresiones, alcance: n(i.reach), frecuencia: i.frequency != null ? r2(n(i.frequency)) : div(impresiones, n(i.reach)),
    cpm: i.cpm != null ? r2(n(i.cpm)) : div(gasto * 1000, impresiones),
    clics, ctr: i.ctr != null ? r2(n(i.ctr)) : div(clics * 100, impresiones), cpc: i.cpc != null ? r2(n(i.cpc)) : div(gasto, clics),
    clics_enlace: clicsEnlace, ctr_enlace: i.inline_link_click_ctr != null ? r2(n(i.inline_link_click_ctr)) : div(clicsEnlace * 100, impresiones),
    cpc_enlace: i.cost_per_inline_link_click != null ? r2(n(i.cost_per_inline_link_click)) : div(gasto, clicsEnlace),
    visitas_landing: de(A, ['landing_page_view', 'omni_landing_page_view']),
    interacciones: de(A, ['post_engagement']), reacciones: de(A, ['post_reaction']), comentarios: de(A, ['comment']), compartidos: de(A, ['post']),
    guardados: de(A, ['onsite_conversion.post_save']), seguidores: de(A, ['like']),
    conversaciones: de(A, ['onsite_conversion.messaging_conversation_started_7d']),
    leads: de(A, ['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead']),
    registros: de(A, ['omni_complete_registration', 'complete_registration', 'offsite_conversion.fb_pixel_complete_registration']),
    compras: de(A, ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase']),
    valor_compras: r2(de(V, ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase'])),
    anadir_carrito: de(A, ['omni_add_to_cart', 'add_to_cart', 'offsite_conversion.fb_pixel_add_to_cart']),
    pagos_iniciados: de(A, ['omni_initiated_checkout', 'initiate_checkout', 'offsite_conversion.fb_pixel_initiate_checkout']),
    reproducciones: de(A, ['video_view']), thruplay: video(i, 'video_thruplay_watched_actions'),
    p25: video(i, 'video_p25_watched_actions'), p50: video(i, 'video_p50_watched_actions'), p75: video(i, 'video_p75_watched_actions'),
    p95: video(i, 'video_p95_watched_actions'), p100: video(i, 'video_p100_watched_actions'),
    tiempo_medio: i.video_avg_time_watched_actions ? video(i, 'video_avg_time_watched_actions') : null,
    calidad: RANKINGS[i.quality_ranking] ?? null, ranking_interaccion: RANKINGS[i.engagement_rate_ranking] ?? null, ranking_conversion: RANKINGS[i.conversion_rate_ranking] ?? null,
  };
  Object.assign(m, {
    coste_landing: div(gasto, m.visitas_landing), coste_interaccion: div(gasto, m.interacciones), coste_conversacion: div(gasto, m.conversaciones),
    coste_lead: div(gasto, m.leads), coste_registro: div(gasto, m.registros), coste_compra: div(gasto, m.compras), roas: div(m.valor_compras, gasto),
    coste_thruplay: div(gasto, m.thruplay), hook_rate: div(m.reproducciones * 100, impresiones), hold_rate: div(m.thruplay * 100, m.reproducciones),
  });
  return m;
}
export const accionesDe = (i = {}) => Object.fromEntries((i.actions || []).map((a) => [a.action_type, n(a.value)]));

// El resultado principal, como lo cuenta el Administrador de anuncios
export function resultadoDe(m, { objetivo = null, optimizacion = null } = {}) {
  const preferidos = POR_OPTIMIZACION[optimizacion] || POR_OBJETIVO[objetivo] || HABITUALES;
  const clave = preferidos.find((k) => m[k] > 0) || (POR_OPTIMIZACION[optimizacion] || POR_OBJETIVO[objetivo] ? preferidos[0] : HABITUALES.find((k) => m[k] > 0)) || null;
  if (!clave) return { resultados: 0, tipoResultado: null, coste_resultado: null };
  const nombre = COLUMNAS.find((c) => c.id === clave)?.nombre.toLowerCase() || clave;
  return { resultados: m[clave], tipoResultado: nombre, coste_resultado: div(m.gasto, m[clave]) };
}

// El total de resultados solo tiene sentido si todas las filas cuentan lo mismo (como en el Administrador de anuncios)
export function resultadosTotales(filas, total) {
  const tipos = new Set(filas.filter((f) => f.m.resultados > 0).map((f) => f.m.tipoResultado));
  if (tipos.size !== 1) return { resultados: null, tipoResultado: null, coste_resultado: null };
  const [tipo] = tipos;
  const clave = COLUMNAS.find((c) => c.nombre.toLowerCase() === tipo)?.id;
  const v = clave && total[clave] != null ? total[clave] : filas.reduce((a, f) => a + (f.m.resultados || 0), 0);
  return { resultados: v, tipoResultado: tipo, coste_resultado: div(total.gasto, v) };
}

const fecha = (v) => (v ? String(v).slice(0, 10) : null);
// Los presupuestos llegan en céntimos
const presupuestoDe = (o, campana) => {
  if (n(o.daily_budget)) return { valor: n(o.daily_budget) / 100, tipo: 'diario' };
  if (n(o.lifetime_budget)) return { valor: n(o.lifetime_budget) / 100, tipo: 'total' };
  if (campana && (n(campana.daily_budget) || n(campana.lifetime_budget))) return { valor: null, tipo: 'campaña' };
  return null;
};

export function enlaceAdsManager(cuenta, nivel, id) {
  const act = String(cuenta || '').replace('act_', '');
  const e = NIVELES[nivel]?.enlace || 'campaigns';
  const sel = { campaigns: 'selected_campaign_ids', adsets: 'selected_adset_ids', ads: 'selected_ad_ids' }[e];
  return `https://adsmanager.facebook.com/adsmanager/manage/${e}?act=${act}${id ? `&${sel}=${id}` : ''}`;
}

// Un objeto de Meta (campaña, conjunto o anuncio) + sus insights → la fila que se enseña
export function filaDe(nivel, o, ins, cuenta) {
  const m = metricasDe(ins || {});
  const objetivo = o.objective || o.campaign?.objective || null;
  const optimizacion = o.optimization_goal || o.adset?.optimization_goal || null;
  const efectivo = o.effective_status || o.status;
  Object.assign(m, resultadoDe(m, { objetivo, optimizacion }), {
    estado: ESTADOS[efectivo] || efectivo || null, objetivo: OBJETIVOS[objetivo] || objetivo, optimizacion: OPTIMIZACIONES[optimizacion] || optimizacion,
    puja: PUJAS[o.bid_strategy] || o.bid_strategy || null, presupuesto: nivel === 'anuncios' ? null : presupuestoDe(o, o.campaign),
    inicio: fecha(o.start_time), fin: fecha(o.stop_time || o.end_time),
  });
  const cr = o.creative;
  return {
    id: o.id, nombre: o.name, nivel, efectivo, activo: efectivo === 'ACTIVE',
    campana: o.campaign_id ? { id: o.campaign_id, nombre: o.campaign?.name || null } : null,
    conjunto: o.adset_id ? { id: o.adset_id, nombre: o.adset?.name || null } : null,
    miniatura: cr ? cr.thumbnail_url || cr.image_url || null : undefined,
    m, acciones: accionesDe(ins || {}), enlace: enlaceAdsManager(cuenta, nivel, o.id),
  };
}

// Columnas de «todas las acciones» que aparecen en los datos
export function columnasAcciones(filas) {
  const tipos = new Set();
  for (const f of filas) for (const t of Object.keys(f.acciones || {})) tipos.add(t);
  return [...tipos].sort().map((t) => ({ id: `accion:${t}`, nombre: ACCIONES[t] || t, grupo: 'Todas las acciones de Meta', formato: 'n', tecnico: t }));
}

const publico = (m) => Object.assign(new Error(m), { publico: true });
const idMeta = (v) => (v == null || v === '' ? null : /^\d{3,}$/.test(String(v)) ? String(v) : (() => { throw publico('Identificador no válido'); })());

export function createExplorador({ graph, conectado, cuentaPorDefecto, aj, demo = null }) {
  const cache = new Map();
  const deCache = (k, forzar, f) => {
    const c = cache.get(k);
    if (!forzar && c && Date.now() - c.ts < CACHE_MIN * MIN) return c.p;
    const p = f();
    cache.set(k, { ts: Date.now(), p });
    p.catch(() => cache.delete(k));
    if (cache.size > 40) cache.delete(cache.keys().next().value);
    return p;
  };
  const periodoDe = ({ periodo = 'last_30d', desde, hasta } = {}) => {
    if (desde && hasta) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta) || desde > hasta) throw publico('Revisa las fechas: «desde» tiene que ser anterior a «hasta»');
      return { time_range: { since: desde, until: hasta } };
    }
    return { date_preset: PERIODOS[periodo] ? periodo : 'last_30d' };
  };
  const cuentaDe = (c) => {
    const v = c || cuentaPorDefecto();
    if (!v) return null;
    const s = String(v).startsWith('act_') ? String(v) : `act_${v}`;
    if (!/^act_\d+$/.test(s)) throw publico('Cuenta publicitaria no válida');
    return s;
  };
  // Sin conexión (o sin cuenta elegida) se enseña el ejemplo, para ver cómo queda
  const conDemo = () => Boolean(demo) && (!conectado() || !cuentaPorDefecto());

  // Todas las cuentas: las tuyas y las de cada Business Manager (propias y de clientes)
  async function cuentasNegocio() {
    if (demo && !conectado()) return demo.cuentas();
    const g = graph();
    const ver = (c) => ({ id: c.id, nombre: c.name, activa: c.account_status === 1, moneda: c.currency });
    const [mias, negocios] = await Promise.all([
      g.todo('me/adaccounts', { fields: 'id,name,account_status,currency,business{id,name}', limit: 100 }, 500),
      g.todo('me/businesses', { fields: 'id,name', limit: 50 }, 100).catch(() => []),
    ]);
    const grupos = new Map();
    const vistas = new Set();
    const meter = (negocio, c) => {
      if (vistas.has(c.id)) return;
      vistas.add(c.id);
      const k = negocio?.id || 'propias';
      if (!grupos.has(k)) grupos.set(k, { negocio: negocio ? { id: negocio.id, nombre: negocio.name } : null, cuentas: [] });
      grupos.get(k).cuentas.push(ver(c));
    };
    for (const b of negocios) {
      const [propias, clientes] = await Promise.all([
        g.todo(`${b.id}/owned_ad_accounts`, { fields: 'id,name,account_status,currency', limit: 100 }, 500).catch(() => []),
        g.todo(`${b.id}/client_ad_accounts`, { fields: 'id,name,account_status,currency', limit: 100 }, 500).catch(() => []),
      ]);
      for (const c of [...propias, ...clientes]) meter(b, c);
    }
    for (const c of mias) meter(c.business || null, c);
    const lista = [...grupos.values()].sort((a, b) => (a.negocio ? 0 : 1) - (b.negocio ? 0 : 1) || String(a.negocio?.nombre).localeCompare(String(b.negocio?.nombre)));
    return { grupos: lista, porDefecto: cuentaPorDefecto() };
  }

  async function explorar({ cuenta: c0 = null, nivel = 'campanas', campana = null, conjunto = null, periodo, desde, hasta, archivadas = false, forzar = false } = {}) {
    if (!NIVELES[nivel]) throw publico('Nivel no válido');
    if (conDemo() && !c0) return demo.explorar({ nivel, campana, conjunto });
    const c = cuentaDe(c0);
    if (!c) throw publico('Falta la cuenta publicitaria: elígela arriba');
    const pid = { campana: idMeta(campana), conjunto: idMeta(conjunto) };
    const rango = periodoDe({ periodo, desde, hasta });
    const k = JSON.stringify(['explorar', c, nivel, pid, rango, Boolean(archivadas)]);
    return deCache(k, forzar, async () => {
      const g = graph();
      const N = NIVELES[nivel];
      // Desde dónde se piden: un conjunto (sus anuncios), una campaña (sus conjuntos o anuncios) o toda la cuenta
      const base = (nivel === 'anuncios' && pid.conjunto) || (nivel !== 'campanas' && pid.campana) || c;
      const estados = archivadas ? [...N.estados, 'ARCHIVED'] : N.estados;
      const camposIns = `${N.id},${CAMPOS_INSIGHTS}${nivel === 'anuncios' ? `,${CAMPOS_RANKING}` : ''}`;
      const [info, objetos, insights, totales] = await Promise.all([
        g.get(c, { fields: 'name,currency,account_status,business{name}' }),
        g.todo(`${base}/${N.ruta}`, { fields: N.campos, effective_status: JSON.stringify(estados), limit: 200 }, 1000),
        g.todo(`${base}/insights`, { level: N.api, fields: camposIns, ...rango, limit: 500 }, 3000),
        g.get(`${base}/insights`, { fields: CAMPOS_INSIGHTS, ...rango }).then((r) => r.data?.[0] || {}),
      ]);
      const porId = new Map(insights.map((i) => [i[N.id], i]));
      const filas = objetos.map((o) => filaDe(nivel, o, porId.get(o.id), c));
      const total = metricasDe(totales);
      Object.assign(total, resultadosTotales(filas, total));
      return {
        cuenta: { id: c, nombre: info.name, moneda: info.currency || 'EUR', activa: info.account_status === 1, negocio: info.business?.name || null },
        nivel, campana: pid.campana, conjunto: pid.conjunto, periodo: rango.date_preset || 'personalizado', rango: rango.time_range || null,
        filas, total: { m: total, acciones: accionesDe(totales) }, columnasAcciones: columnasAcciones(filas), actualizado: new Date().toISOString(),
      };
    });
  }

  // Lo que hace falta para el detalle de un conjunto: a quién se dirige, en palabras
  const segmentacionDe = (t) => {
    if (!t) return null;
    const nombres = (l) => (l || []).map((x) => x.name).filter(Boolean);
    const geo = t.geo_locations || {};
    const genero = !t.genders?.length || t.genders.length === 2 ? 'Todos' : t.genders[0] === 1 ? 'Hombres' : 'Mujeres';
    const intereses = (t.flexible_spec || []).flatMap((f) => [...nombres(f.interests), ...nombres(f.behaviors), ...nombres(f.work_positions), ...nombres(f.life_events)]);
    return {
      edad: `${t.age_min || 18}-${t.age_max || 65}${t.age_max >= 65 ? '+' : ''}`, genero,
      lugares: [...(geo.countries || []), ...nombres(geo.regions), ...nombres(geo.cities), ...nombres(geo.zips)].slice(0, 30),
      intereses: intereses.slice(0, 40), publicos: nombres(t.custom_audiences), excluidos: nombres(t.excluded_custom_audiences),
      plataformas: t.publisher_platforms || [], posiciones: [...(t.instagram_positions || []).map((p) => `instagram · ${p}`), ...(t.facebook_positions || []).map((p) => `facebook · ${p}`)],
      advantage: t.targeting_automation?.advantage_audience === 1,
    };
  };
  const creativoDe = (cr) => {
    if (!cr) return null;
    const s = cr.object_story_spec || {};
    const ld = s.link_data || {}, vd = s.video_data || {};
    return {
      id: cr.id, nombre: cr.name, tipo: cr.object_type, imagen: cr.image_url || ld.picture || vd.image_url || cr.thumbnail_url || null, miniatura: cr.thumbnail_url || null,
      texto: cr.body || ld.message || vd.message || null, titulo: cr.title || ld.name || vd.title || null, descripcion: ld.description || vd.link_description || null,
      cta: cr.call_to_action_type || ld.call_to_action?.type || vd.call_to_action?.type || null, enlace: cr.link_url || ld.link || vd.call_to_action?.value?.link || null,
      instagram: cr.instagram_permalink_url || null, video: Boolean(cr.video_id || vd.video_id),
      carrusel: (ld.child_attachments || []).map((a) => ({ titulo: a.name || null, imagen: a.picture || null, enlace: a.link || null })),
    };
  };

  async function detalle({ cuenta: c0 = null, nivel, id, periodo, desde, hasta, forzar = false } = {}) {
    if (!NIVELES[nivel]) throw publico('Nivel no válido');
    if (conDemo() && !c0) return demo.detalle({ nivel, id });
    const c = cuentaDe(c0);
    const oid = idMeta(id);
    if (!oid) throw publico('Falta el identificador');
    const rango = periodoDe({ periodo, desde, hasta });
    return deCache(JSON.stringify(['detalle', c, nivel, oid, rango]), forzar, async () => {
      const g = graph();
      const N = NIVELES[nivel];
      const extra = nivel === 'conjuntos' ? ',targeting' : nivel === 'anuncios' ? ',preview_shareable_link' : '';
      const camposIns = `${CAMPOS_INSIGHTS}${nivel === 'anuncios' ? `,${CAMPOS_RANKING}` : ''}`;
      const desglose = (breakdowns) => g.todo(`${oid}/insights`, { fields: 'spend,impressions,reach,clicks,inline_link_clicks,ctr,cpc,cpm,actions,action_values,video_thruplay_watched_actions', breakdowns, ...rango, limit: 200 }, 400);
      const [o, info, total, diario, ...partes] = await Promise.allSettled([
        g.get(oid, { fields: N.campos + extra }),
        g.get(c, { fields: 'currency' }),
        g.get(`${oid}/insights`, { fields: camposIns, ...rango }).then((r) => r.data?.[0] || {}),
        g.todo(`${oid}/insights`, { fields: 'spend,impressions,reach,clicks,inline_link_clicks,ctr,cpc,cpm,actions,action_values,video_thruplay_watched_actions', time_increment: 1, ...rango, limit: 100 }, 400),
        desglose('age'), desglose('gender'), desglose('publisher_platform,platform_position'), desglose('device_platform'),
      ]);
      if (o.status === 'rejected') throw o.reason;
      const obj = o.value;
      const fila = filaDe(nivel, obj, total.status === 'fulfilled' ? total.value : {}, c);
      const contexto = { objetivo: obj.objective || obj.campaign?.objective, optimizacion: obj.optimization_goal || obj.adset?.optimization_goal };
      const conResultado = (i) => { const m = metricasDe(i); return Object.assign(m, resultadoDe(m, contexto)); };
      const SEXO = { male: 'Hombres', female: 'Mujeres', unknown: 'Sin especificar' };
      const lista = (p, clave) => (p.status === 'fulfilled' ? p.value.map((i) => ({ clave: clave(i), m: conResultado(i) })).sort((a, b) => b.m.gasto - a.m.gasto) : null);
      let creativo = null;
      if (nivel === 'anuncios' && obj.creative?.id) {
        try { creativo = creativoDe(await g.get(obj.creative.id, { fields: CAMPOS_CREATIVO, thumbnail_width: 600, thumbnail_height: 600 })); } catch { creativo = creativoDe(obj.creative); }
      }
      return {
        fila, moneda: info.status === 'fulfilled' ? info.value.currency || 'EUR' : 'EUR',
        diario: diario.status === 'fulfilled' ? diario.value.map((i) => ({ fecha: i.date_start, m: conResultado(i) })) : [],
        desgloses: {
          edad: lista(partes[0], (i) => i.age),
          sexo: lista(partes[1], (i) => SEXO[i.gender] || i.gender),
          ubicacion: lista(partes[2], (i) => `${i.publisher_platform} · ${String(i.platform_position || '').replace(/_/g, ' ')}`),
          dispositivo: lista(partes[3], (i) => i.device_platform),
        },
        creativo, vistaPrevia: obj.preview_shareable_link || null, segmentacion: segmentacionDe(obj.targeting),
      };
    });
  }

  // Las columnas que has elegido (las mismas en el ordenador y en el móvil)
  function columnas() {
    const g = aj.leer('ads_columnas', null);
    return { elegidas: Array.isArray(g) && g.length ? g : COLUMNAS_POR_DEFECTO, catalogo: COLUMNAS, porDefecto: COLUMNAS_POR_DEFECTO, periodos: PERIODOS };
  }
  function guardarColumnas(lista) {
    const limpia = [...new Set((Array.isArray(lista) ? lista : []).map(String))].filter((c) => IDS_COLUMNAS.has(c) || /^accion:[\w.:-]{1,120}$/.test(c)).slice(0, 60);
    if (!limpia.length) throw publico('Elige al menos una columna');
    aj.guardar('ads_columnas', limpia);
    return columnas();
  }

  return { cuentasNegocio, explorar, detalle, columnas, guardarColumnas };
}
