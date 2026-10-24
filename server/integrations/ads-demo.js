import { demoInstagram } from './instagram-demo.js';

// Ejemplo de la pestaña Meta Ads (campañas y páginas FICTICIAS) para ver cómo queda antes de conectar.
const DIA = 86400000;

export function demoAds({ hoy = Date.now() } = {}) {
  const campanas = [
    { id: 'demo-1', nombre: 'TOFU · Reels de automatización', estado: 'ACTIVE', objetivo: 'OUTCOME_ENGAGEMENT', gasto: 412.6, impresiones: 98400, alcance: 61200, clics: 2655, ctr: 2.7, cpc: 0.16, cpm: 4.19, resultados: 5180, tipoResultado: 'interacciones', costeResultado: 0.08 },
    { id: 'demo-2', nombre: 'Leads · Lead magnet setter IA', estado: 'ACTIVE', objetivo: 'OUTCOME_LEADS', gasto: 286.3, impresiones: 41200, alcance: 30100, clics: 1530, ctr: 3.71, cpc: 0.19, cpm: 6.95, resultados: 214, tipoResultado: 'leads', costeResultado: 1.34 },
    { id: 'demo-3', nombre: 'Retargeting · Casos de éxito', estado: 'PAUSED', objetivo: 'OUTCOME_ENGAGEMENT', gasto: 96.1, impresiones: 18800, alcance: 9900, clics: 301, ctr: 1.6, cpc: 0.32, cpm: 5.11, resultados: 690, tipoResultado: 'interacciones', costeResultado: 0.14 },
  ];
  const sum = (k) => campanas.reduce((a, c) => a + c[k], 0);
  const gasto = sum('gasto'), impresiones = sum('impresiones'), clics = sum('clics');
  const rendimiento = {
    cuenta: { id: 'act_ejemplo', nombre: 'Cuenta de ejemplo', moneda: 'EUR', activa: true },
    dias: 30,
    totales: { gasto, impresiones, clics, ctr: Math.round((clics / impresiones) * 10000) / 100, cpc: Math.round((gasto / clics) * 100) / 100, cpm: Math.round((gasto / impresiones) * 100000) / 100 },
    diario: Array.from({ length: 30 }, (_, i) => ({ fecha: new Date(hoy - (29 - i) * DIA).toLocaleDateString('sv-SE'), gasto: Math.round((18 + Math.sin(i / 3) * 6 + (i % 7 === 5 ? -8 : 0)) * 100) / 100, clics: 120 + ((i * 37) % 60) })),
    campanas,
  };
  const biblioteca = [
    { id: 'demo-a1', competidor: 'ejemplo.chatbots', pagina: 'Ejemplo Chatbots', cuerpo: '¿Pierdes clientes por contestar tarde? Nuestro asistente responde en 5 segundos, 24/7.', titulo: 'Prueba 14 días gratis', diasActivo: 96, activo: true, plataformas: 'instagram, facebook', alcance_ue: 182000 },
    { id: 'demo-a2', competidor: 'ejemplo.ventasia', pagina: 'Ejemplo Ventas IA', cuerpo: 'Así automatizamos 300 DMs al día para una clínica dental (sin perder el trato humano).', titulo: 'Ver el caso completo', diasActivo: 61, activo: true, plataformas: 'instagram', alcance_ue: 94000 },
    { id: 'demo-a3', competidor: 'ejemplo.chatbots', pagina: 'Ejemplo Chatbots', cuerpo: 'Plantilla gratis: los 7 mensajes que más venden por WhatsApp.', titulo: 'Descárgala aquí', diasActivo: 34, activo: true, plataformas: 'instagram, facebook', alcance_ue: 57000 },
    { id: 'demo-a4', competidor: 'ejemplo.ventasia', pagina: 'Ejemplo Ventas IA', cuerpo: 'Webinar: cómo montar tu setter con IA en una tarde.', titulo: 'Plazas limitadas', diasActivo: 9, activo: false, plataformas: 'facebook', alcance_ue: 12000 },
  ];
  return { rendimiento, biblioteca, media: demoInstagram({ hoy }).media };
}

// Ejemplo del Administrador de anuncios (campañas, conjuntos y anuncios FICTICIOS), en el mismo formato que da Meta
export function demoExplorador({ filaDe, metricasDe, resultadoDe, resultadosTotales, columnasAcciones, hoy = Date.now() } = {}) {
  const CUENTA = 'act_ejemplo';
  const campanas = [
    { id: '9001', name: 'TOFU · Reels de automatización', effective_status: 'ACTIVE', objective: 'OUTCOME_ENGAGEMENT', daily_budget: '2500', bid_strategy: 'LOWEST_COST_WITHOUT_CAP', start_time: new Date(hoy - 40 * DIA).toISOString() },
    { id: '9002', name: 'Leads · Lead magnet setter IA', effective_status: 'ACTIVE', objective: 'OUTCOME_LEADS', bid_strategy: 'LOWEST_COST_WITHOUT_CAP', start_time: new Date(hoy - 25 * DIA).toISOString() },
    { id: '9003', name: 'Mensajes · Llamada de diagnóstico', effective_status: 'PAUSED', objective: 'OUTCOME_ENGAGEMENT', daily_budget: '1500', start_time: new Date(hoy - 60 * DIA).toISOString() },
  ];
  const conjuntos = [
    { id: '9101', campaign_id: '9001', name: 'España · 25-45 · Advantage+', effective_status: 'ACTIVE', optimization_goal: 'THRUPLAY' },
    { id: '9102', campaign_id: '9001', name: 'Intereses · emprendedores', effective_status: 'ACTIVE', optimization_goal: 'POST_ENGAGEMENT' },
    { id: '9201', campaign_id: '9002', name: 'Lookalike 1 % clientes', effective_status: 'ACTIVE', optimization_goal: 'LEAD_GENERATION', daily_budget: '1800' },
    { id: '9202', campaign_id: '9002', name: 'Retargeting 30 días', effective_status: 'PAUSED', optimization_goal: 'LEAD_GENERATION', daily_budget: '800' },
    { id: '9301', campaign_id: '9003', name: 'Seguidores IG · DMs', effective_status: 'CAMPAIGN_PAUSED', optimization_goal: 'CONVERSATIONS' },
  ];
  const anuncios = [
    ['9111', '9101', 'Reel · «Contesto 300 DMs sin tocar el móvil»', 'ACTIVE', 1.0], ['9112', '9101', 'Reel · Antes y después del setter', 'ACTIVE', 0.7],
    ['9121', '9102', 'Carrusel · 7 automatizaciones', 'ACTIVE', 0.6], ['9122', '9102', 'Imagen · Testimonio clínica', 'PAUSED', 0.25],
    ['9211', '9201', 'Vídeo · Guía gratis setter IA', 'ACTIVE', 0.9], ['9212', '9201', 'Imagen · Checklist descargable', 'ACTIVE', 0.5],
    ['9221', '9202', 'Reel · Caso de éxito', 'ADSET_PAUSED', 0.3], ['9311', '9301', 'Reel · «Escríbeme DIAGNÓSTICO»', 'CAMPAIGN_PAUSED', 0.45],
  ].map(([id, adset, name, est, peso]) => ({ id, adset_id: adset, campaign_id: conjuntos.find((c) => c.id === adset).campaign_id, name, effective_status: est, peso }));
  const campana = (id) => campanas.find((c) => c.id === id);
  const conjunto = (id) => conjuntos.find((c) => c.id === id);
  // Insights inventados (pero coherentes) de cada anuncio
  const insAnuncio = (a, f = 1) => {
    const k = a.peso * f;
    const imp = Math.round(42000 * k), clicsEnlace = Math.round(imp * 0.018), vistas = Math.round(imp * 0.31);
    const obj = campana(a.campaign_id).objective, opt = conjunto(a.adset_id).optimization_goal;
    const acciones = [['link_click', clicsEnlace], ['landing_page_view', Math.round(clicsEnlace * 0.7)], ['post_engagement', Math.round(imp * 0.05)], ['post_reaction', Math.round(imp * 0.012)],
      ['comment', Math.round(imp * 0.0011)], ['post', Math.round(imp * 0.0009)], ['onsite_conversion.post_save', Math.round(imp * 0.0016)], ['video_view', vistas]];
    if (opt === 'LEAD_GENERATION') acciones.push(['lead', Math.round(clicsEnlace * 0.22)]);
    if (opt === 'CONVERSATIONS' || obj === 'OUTCOME_ENGAGEMENT') acciones.push(['onsite_conversion.messaging_conversation_started_7d', Math.round(clicsEnlace * (opt === 'CONVERSATIONS' ? 0.5 : 0.04))]);
    const v = (x) => [{ action_type: 'video_view', value: String(x) }];
    return {
      spend: String(Math.round(k * 210 * 100) / 100), impressions: String(imp), reach: String(Math.round(imp * 0.62)), clicks: String(Math.round(clicsEnlace * 1.6)),
      inline_link_clicks: String(clicsEnlace), actions: acciones.map(([t, x]) => ({ action_type: t, value: String(x) })),
      video_thruplay_watched_actions: v(Math.round(vistas * 0.34)), video_p25_watched_actions: v(Math.round(vistas * 0.6)), video_p50_watched_actions: v(Math.round(vistas * 0.4)),
      video_p75_watched_actions: v(Math.round(vistas * 0.27)), video_p95_watched_actions: v(Math.round(vistas * 0.18)), video_p100_watched_actions: v(Math.round(vistas * 0.15)),
      video_avg_time_watched_actions: v(Math.round(6 + a.peso * 5)),
      quality_ranking: a.peso > 0.8 ? 'ABOVE_AVERAGE' : a.peso > 0.4 ? 'AVERAGE' : 'BELOW_AVERAGE_35', engagement_rate_ranking: a.peso > 0.6 ? 'ABOVE_AVERAGE' : 'AVERAGE',
    };
  };
  // Sumar insights (para conjuntos, campañas y el total)
  const sumar = (lista) => {
    const out = { spend: 0, impressions: 0, reach: 0, clicks: 0, inline_link_clicks: 0 };
    const acc = new Map(), vids = {};
    for (const i of lista) {
      for (const k of Object.keys(out)) out[k] += Number(i[k]) || 0;
      for (const a of i.actions) acc.set(a.action_type, (acc.get(a.action_type) || 0) + Number(a.value));
      for (const k of Object.keys(i)) if (k.startsWith('video_') && k !== 'video_avg_time_watched_actions') vids[k] = (vids[k] || 0) + Number(i[k][0].value);
    }
    return { ...Object.fromEntries(Object.entries(out).map(([k, v]) => [k, String(Math.round(v * 100) / 100)])), actions: [...acc].map(([t, x]) => ({ action_type: t, value: String(x) })),
      ...Object.fromEntries(Object.entries(vids).map(([k, x]) => [k, [{ action_type: 'video_view', value: String(x) }]])), video_avg_time_watched_actions: [{ action_type: 'video_view', value: '8' }] };
  };
  const insDe = (nivel, id) => sumar(anuncios.filter((a) => (nivel === 'anuncios' ? a.id : nivel === 'conjuntos' ? a.adset_id : a.campaign_id) === id).map((a) => insAnuncio(a)));
  const objetosDe = (nivel, { campana: c, conjunto: s }) => {
    if (nivel === 'campanas') return campanas;
    if (nivel === 'conjuntos') return conjuntos.filter((x) => !c || x.campaign_id === c).map((x) => ({ ...x, campaign: campana(x.campaign_id) }));
    return anuncios.filter((x) => (!s || x.adset_id === s) && (!c || x.campaign_id === c))
      .map((x) => ({ ...x, campaign: campana(x.campaign_id), adset: conjunto(x.adset_id), creative: { id: `c${x.id}`, thumbnail_url: null } }));
  };
  const cuenta = { id: CUENTA, nombre: 'Cuenta de ejemplo', moneda: 'EUR', activa: true, negocio: 'AutomatIA Pro (ejemplo)' };
  return {
    cuentas: () => ({ grupos: [{ negocio: { id: '1', nombre: 'AutomatIA Pro (ejemplo)' }, cuentas: [{ id: CUENTA, nombre: 'Cuenta de ejemplo', activa: true, moneda: 'EUR' }] }], porDefecto: null, demo: true }),
    explorar({ nivel, campana: c = null, conjunto: s = null }) {
      const filas = objetosDe(nivel, { campana: c, conjunto: s }).map((o) => filaDe(nivel, o, insDe(nivel, o.id), CUENTA));
      const t = sumar(anuncios.filter((a) => (!s || a.adset_id === s) && (!c || a.campaign_id === c)).map((a) => insAnuncio(a)));
      const total = metricasDe(t);
      Object.assign(total, resultadosTotales(filas, total));
      return { cuenta, nivel, campana: c, conjunto: s, periodo: 'last_30d', rango: null, filas, total: { m: total, acciones: {} }, columnasAcciones: columnasAcciones(filas), actualizado: new Date(hoy).toISOString(), demo: true };
    },
    detalle({ nivel, id }) {
      const o = objetosDe(nivel, {}).find((x) => x.id === String(id));
      if (!o) throw Object.assign(new Error('No está en el ejemplo'), { publico: true });
      const base = insDe(nivel, o.id);
      const fila = filaDe(nivel, o, base, CUENTA);
      const ctx = { objetivo: o.objective || o.campaign?.objective, optimizacion: o.optimization_goal || o.adset?.optimization_goal };
      const conRes = (i) => { const m = metricasDe(i); return Object.assign(m, resultadoDe(m, ctx)); };
      const parte = (f) => { const x = JSON.parse(JSON.stringify(base)); for (const k of ['spend', 'impressions', 'reach', 'clicks', 'inline_link_clicks']) x[k] = String(Math.round(Number(x[k]) * f * 100) / 100); x.actions = x.actions.map((a) => ({ ...a, value: String(Math.round(Number(a.value) * f)) })); for (const k of Object.keys(x)) if (/^video_p|^video_thruplay/.test(k)) x[k] = [{ action_type: 'video_view', value: String(Math.round(Number(x[k][0].value) * f)) }]; return x; };
      const reparto = (pares) => pares.map(([clave, f]) => ({ clave, m: conRes(parte(f)) }));
      return {
        fila, moneda: 'EUR',
        diario: Array.from({ length: 30 }, (_, i) => ({ fecha: new Date(hoy - (29 - i) * DIA).toLocaleDateString('sv-SE'), m: conRes(parte((1 + Math.sin(i / 3) * 0.3) / 30)) })),
        desgloses: {
          edad: reparto([['25-34', 0.38], ['35-44', 0.31], ['18-24', 0.14], ['45-54', 0.12], ['55-64', 0.05]]),
          sexo: reparto([['Mujeres', 0.56], ['Hombres', 0.42], ['Sin especificar', 0.02]]),
          ubicacion: reparto([['instagram · reels', 0.48], ['instagram · feed', 0.27], ['instagram · story', 0.19], ['instagram · explore', 0.06]]),
          dispositivo: reparto([['mobile_app', 0.93], ['desktop', 0.07]]),
        },
        creativo: nivel === 'anuncios' ? { id: `c${o.id}`, tipo: 'VIDEO', imagen: null, texto: '¿Sigues contestando los DMs a mano? Así lo hago yo con un setter de IA (sin perder el trato humano).', titulo: 'Descarga la guía gratis', cta: 'LEARN_MORE', enlace: 'https://example.com/guia', instagram: null, video: true, carrusel: [] } : null,
        vistaPrevia: null,
        segmentacion: nivel === 'conjuntos' ? { edad: '25-45', genero: 'Todos', lugares: ['ES'], intereses: ['Emprendimiento', 'Marketing digital', 'Pequeñas empresas'], publicos: [], excluidos: ['Clientes actuales'], plataformas: ['instagram'], posiciones: ['instagram · reels', 'instagram · stream', 'instagram · story'], advantage: true } : null,
        demo: true,
      };
    },
  };
}
