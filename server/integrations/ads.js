import path from 'node:path';
import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ajustes, row, rows } from '../db.js';
import { createGraph, MetaError } from './meta.js';
import { demoAds, demoExplorador } from './ads-demo.js';
import { createExplorador, filaDe, metricasDe, resultadoDe as resultadoExplorador, resultadosTotales, columnasAcciones } from './ads-explorador.js';

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

// Campos de la Biblioteca de anuncios que se piden de cada anuncio
const CAMPOS_ANUNCIO = 'id,page_id,page_name,ad_creative_bodies,ad_creative_link_titles,ad_creative_link_descriptions,ad_delivery_start_time,ad_delivery_stop_time,ad_snapshot_url,publisher_platforms,eu_total_reach';
const MAX_ANUNCIANTES = 30;
const sinTildes = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// El vídeo y las imágenes de un anuncio salen de su vista previa (ad_snapshot_url): la Biblioteca no da el enlace
// directo. Se buscan en su HTML (los datos van en JSON dentro de la página, a veces escapado dos veces, o en
// etiquetas <video>/<img>). Las fotos pequeñas (la de perfil de la página) no cuentan.
export function mediosDeSnapshot(html) {
  const texto = String(html || '').replace(/\\+\//g, '/').replace(/\\+"/g, '"').replace(/&quot;/g, '"').replace(/\\+u0025/g, '%').replace(/\\+u0026/g, '&').replace(/\\+u003[dD]/g, '=');
  const limpiar = (u) => String(u).replace(/&amp;/g, '&');
  const todos = (re) => [...texto.matchAll(re)].map((m) => limpiar(m[1])).filter((u) => /^https:\/\//.test(u));
  const unicos = (l) => [...new Set(l)];
  const pequena = (u) => { const m = /[/_.-][sp](\d{2,4})x(\d{2,4})[/_.-]/.exec(u); return Boolean(m && Math.max(+m[1], +m[2]) < 200); };
  let videos = unicos([...todos(/"video_hd_url":"([^"]+)"/g), ...todos(/"video_sd_url":"([^"]+)"/g), ...todos(/<video[^>]*\ssrc="([^"]+)"/g), ...todos(/<source[^>]*\ssrc="([^"]+)"/g)]);
  let imagenes = unicos([...todos(/"original_image_url":"([^"]+)"/g), ...todos(/"resized_image_url":"([^"]+)"/g), ...todos(/"video_preview_image_url":"([^"]+)"/g),
    ...todos(/<video[^>]*\sposter="([^"]+)"/g), ...todos(/<img[^>]*\ssrc="(https:\/\/[^"]*(?:scontent|fbcdn)[^"]*)"/g)]).filter((u) => !pequena(u));
  // Último recurso: cualquier enlace de vídeo o de imagen de los servidores de Meta que haya en la página
  if (!videos.length) videos = unicos(todos(/(https:\/\/video[^"'\s<>\\]*\.fbcdn\.net\/[^"'\s<>\\]+)/g));
  if (!imagenes.length) imagenes = unicos(todos(/(https:\/\/scontent[^"'\s<>\\]*\.fbcdn\.net\/[^"'\s<>\\]+)/g)).filter((u) => !pequena(u) && !/\.(?:js|css)(?:\?|$)/.test(u));
  return { videos, imagenes };
}

// Por qué una vista previa no trae nada, en palabras de persona (para el aviso)
export function motivoSnapshot({ titulo = '', texto = '', html = '' } = {}) {
  const t = `${titulo} ${texto} ${String(html).slice(0, 20000)}`;
  if (/iniciar sesi[oó]n|inicia sesi[oó]n|log in to|login_form|\/login\/\?/i.test(t)) return 'Meta pide iniciar sesión para ver la vista previa';
  if (/no est[aá] disponible|isn.t available|content not found|no se ha encontrado/i.test(t)) return 'Meta dice que la vista previa ya no está disponible';
  if (/invalid oauth|access token|token de acceso/i.test(t)) return 'Meta no ha aceptado el token al abrir la vista previa';
  return titulo ? `Meta devolvió «${String(titulo).slice(0, 80)}»` : '';
}

export function createAds({ db, instagram, env = process.env, fetchImpl = fetch, alCambiar = () => {}, mediosDir = null, renderizar = null, fotograma = null }) {
  const aj = ajustes(db);
  const borrarCache = () => { aj.borrar('ads_cache'); for (const d of PERIODOS_CACHE) aj.borrar(`ads_cache_${d}`); };
  const q = {
    upLib: db.prepare(`INSERT INTO ads_biblioteca (id, competidor, pagina_id, pagina, cuerpo, titulo, inicio, fin, snapshot, plataformas, alcance_ue)
      VALUES (@id, @competidor, @pagina_id, @pagina, @cuerpo, @titulo, @inicio, @fin, @snapshot, @plataformas, @alcance_ue)
      ON CONFLICT(id) DO UPDATE SET fin = excluded.fin, alcance_ue = excluded.alcance_ue, actualizado = datetime('now','localtime')`),
    lib: db.prepare('SELECT * FROM ads_biblioteca ORDER BY inicio ASC'),
    upAnuncio: db.prepare(`INSERT INTO ads_biblioteca (id, competidor, pagina_id, pagina, cuerpo, cuerpos, titulo, descripcion, inicio, fin, snapshot, plataformas, alcance_ue, visto)
      VALUES (@id, @competidor, @pagina_id, @pagina, @cuerpo, @cuerpos, @titulo, @descripcion, @inicio, @fin, @snapshot, @plataformas, @alcance_ue, @visto)
      ON CONFLICT(id) DO UPDATE SET fin = excluded.fin, alcance_ue = excluded.alcance_ue, snapshot = excluded.snapshot, cuerpos = excluded.cuerpos,
        descripcion = excluded.descripcion, visto = excluded.visto, pagina = excluded.pagina, actualizado = datetime('now','localtime')`),
    anuncio: db.prepare('SELECT * FROM ads_biblioteca WHERE id = ?'),
    anunciante: db.prepare('SELECT * FROM ads_anunciantes WHERE pagina_id = ?'),
    anunciantes: db.prepare('SELECT a.*, (SELECT COUNT(*) FROM ads_biblioteca b WHERE b.pagina_id = a.pagina_id AND b.fin IS NULL AND b.visto >= a.ultima_sync) AS activos FROM ads_anunciantes a ORDER BY a.nombre COLLATE NOCASE'),
    insAnunciante: db.prepare('INSERT INTO ads_anunciantes (pagina_id, nombre) VALUES (?, ?) ON CONFLICT(pagina_id) DO UPDATE SET nombre = excluded.nombre'),
    delAnunciante: db.prepare('DELETE FROM ads_anunciantes WHERE pagina_id = ?'),
    delAnunciosDe: db.prepare("DELETE FROM ads_biblioteca WHERE pagina_id = ? AND competidor = 'anunciante'"),
    syncAnunciante: db.prepare('UPDATE ads_anunciantes SET ultima_sync = ?, error = ?, nombre = COALESCE(?, nombre) WHERE pagina_id = ?'),
    setMedios: db.prepare('UPDATE ads_biblioteca SET medios = ? WHERE id = ?'),
    setTranscripcion: db.prepare('UPDATE ads_biblioteca SET transcripcion = ?, nota = ? WHERE id = ?'),
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
    // Y los anunciantes que sigues en «Anuncios de la competencia»
    try {
      const r2 = await sincronizarAnunciantes();
      res.anuncios += r2.anuncios;
      res.errores.push(...r2.errores.map((x) => ({ competidor: x.anunciante, error: x.error })));
    } catch (e) { if (e instanceof MetaError && e.caducado) throw e; }
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

  // ---------- Anuncios de la competencia (buscador) ----------
  // La Biblioteca busca por página de Facebook: se busca por texto, se agrupan los anuncios por su página y la
  // persona elige cuál es. Con el ID de la página (o un enlace de la Biblioteca con view_all_page_id) va directo.
  const errorBiblioteca = (e) => (e instanceof MetaError && (e.codigo === 10 || e.codigo === 200 || /identity|identidad/i.test(e.message))
    ? publico('La Biblioteca de anuncios necesita que verifiques tu identidad en Meta (facebook.com/ID) y aceptes las condiciones en facebook.com/ads/library/api.')
    : e);
  const pais = () => env.ADS_PAIS || 'ES';

  async function buscarAnunciante(texto) {
    const t = String(texto || '').trim();
    if (t.length < 2) throw publico('Escribe el nombre de la cuenta, su @usuario o el enlace de su página o de la Biblioteca de anuncios');
    const g = graph();
    const id = /view_all_page_id=(\d+)/.exec(t)?.[1] || (/^\d{6,}$/.test(t) ? t : null);
    const params = { ad_reached_countries: [pais()], ad_active_status: 'ACTIVE', ad_type: 'ALL', fields: 'page_id,page_name', limit: 100 };
    let anuncios;
    try {
      anuncios = (await g.get('ads_archive', id ? { ...params, search_page_ids: [id] } : { ...params, search_terms: t.replace(/^@/, '').replace(/^https?:\/\/(www\.)?(facebook|instagram)\.com\//, '').replace(/[/?#].*$/, '').replace(/[._]/g, ' ') })).data || [];
    } catch (e) { throw errorBiblioteca(e); }
    const paginas = new Map();
    for (const a of anuncios) {
      if (!a.page_id) continue;
      const p = paginas.get(a.page_id) || { pagina_id: a.page_id, nombre: a.page_name || a.page_id, anuncios: 0 };
      p.anuncios += 1;
      paginas.set(a.page_id, p);
    }
    const buscado = sinTildes(t.replace(/^@/, '')).replace(/[._]/g, ' ');
    const seguidos = new Set(rows(q.anunciantes).map((x) => x.pagina_id));
    const lista = [...paginas.values()]
      .map((p) => ({ ...p, coincide: sinTildes(p.nombre).includes(buscado) || buscado.includes(sinTildes(p.nombre)), siguiendo: seguidos.has(p.pagina_id) }))
      .sort((a, b) => (b.coincide - a.coincide) || (b.anuncios - a.anuncios))
      .slice(0, 8);
    if (id && !lista.length) lista.push({ pagina_id: id, nombre: `Página ${id}`, anuncios: 0, coincide: true, siguiendo: seguidos.has(id) });
    return { candidatos: lista };
  }

  async function seguirAnunciante({ pagina_id: id, nombre } = {}) {
    if (!/^\d{3,}$/.test(String(id || ''))) throw publico('Elige una página de la lista');
    if (!row(q.anunciante, String(id)) && rows(q.anunciantes).length >= MAX_ANUNCIANTES) throw publico(`Como mucho ${MAX_ANUNCIANTES} anunciantes a la vez: quita alguno`);
    q.insAnunciante.run(String(id), String(nombre || '').slice(0, 120) || null);
    alCambiar();
    return sincronizarAnunciante(String(id));
  }
  function dejarAnunciante(id) {
    q.delAnunciante.run(String(id));
    q.delAnunciosDe.run(String(id));
    if (mediosDir) for (const f of existsSync(mediosDir) ? readdirSync(mediosDir) : []) if (!row(q.anuncio, f)) rmSync(path.join(mediosDir, f), { recursive: true, force: true });
    alCambiar();
    return { ok: true };
  }

  // Todos sus anuncios activos ahora (los que ya no salen se dan por terminados)
  async function sincronizarAnunciante(id) {
    const ahora = new Date().toISOString();
    let anuncios;
    try {
      anuncios = await graph().todo('ads_archive', { search_page_ids: [id], ad_reached_countries: [pais()], ad_active_status: 'ACTIVE', ad_type: 'ALL', fields: CAMPOS_ANUNCIO, limit: 100 }, 300);
    } catch (e) {
      const err = errorBiblioteca(e);
      q.syncAnunciante.run(ahora, err.message, null, id);
      alCambiar();
      throw err;
    }
    for (const a of anuncios) {
      const cuerpos = (a.ad_creative_bodies || []).filter(Boolean);
      q.upAnuncio.run({
        id: a.id, competidor: 'anunciante', pagina_id: a.page_id || id, pagina: a.page_name || null,
        cuerpo: cuerpos[0] || null, cuerpos: cuerpos.length > 1 ? JSON.stringify(cuerpos) : null,
        titulo: a.ad_creative_link_titles?.[0] || null, descripcion: a.ad_creative_link_descriptions?.[0] || null,
        inicio: a.ad_delivery_start_time || null, fin: a.ad_delivery_stop_time || null, snapshot: a.ad_snapshot_url || null,
        plataformas: (a.publisher_platforms || []).join(', ') || null, alcance_ue: a.eu_total_reach ?? null, visto: ahora,
      });
    }
    q.syncAnunciante.run(ahora, null, anuncios[0]?.page_name || null, id);
    alCambiar();
    return { pagina_id: id, anuncios: anuncios.length };
  }
  async function sincronizarAnunciantes() {
    const res = { anuncios: 0, errores: [] };
    for (const a of rows(q.anunciantes)) {
      try { res.anuncios += (await sincronizarAnunciante(a.pagina_id)).anuncios; } catch (e) {
        if (e instanceof MetaError && e.caducado) throw e;
        res.errores.push({ anunciante: a.nombre, error: e.message });
      }
    }
    return res;
  }

  const verEnBiblioteca = (id) => `https://www.facebook.com/ads/library/?id=${encodeURIComponent(id)}`;
  const mediosDe = (a) => { try { return a.medios ? JSON.parse(a.medios) : null; } catch { return null; } };
  const urlMedio = (id, f) => `/api/ads/anuncios/${encodeURIComponent(id)}/medio/${encodeURIComponent(f)}`;
  const vistaAnuncio = (a, variantes = 1) => {
    const hoy = Date.now();
    const sigue = !a.fin || new Date(a.fin).getTime() > hoy;
    const m = mediosDe(a);
    return {
      id: a.id, pagina: a.pagina, pagina_id: a.pagina_id, cuerpo: a.cuerpo, titulo: a.titulo, descripcion: a.descripcion, inicio: a.inicio,
      activo: sigue, diasActivo: a.inicio ? Math.max(1, Math.round(((sigue ? hoy : new Date(a.fin).getTime()) - new Date(a.inicio).getTime()) / DIA)) : null,
      alcance_ue: a.alcance_ue, plataformas: a.plataformas, variantes, transcrita: Boolean(a.transcripcion),
      video: m?.video ? urlMedio(a.id, m.video) : null, imagenes: (m?.imagenes || []).map((f) => urlMedio(a.id, f)),
      miniatura: m?.portada ? urlMedio(a.id, m.portada) : m?.imagenes?.[0] ? urlMedio(a.id, m.imagenes[0]) : a.snapshot && mediosDir ? `/api/ads/anuncios/${encodeURIComponent(a.id)}/miniatura` : null,
      verEnBiblioteca: verEnBiblioteca(a.id),
    };
  };

  // orden: 'tiempo' (más días activo: lo que les funciona), 'recientes', 'alcance' (alcance en la UE) o 'variantes'
  // (el mismo texto en varios anuncios: lo están escalando). minDias: solo los que llevan al menos esos días.
  function anunciosCompetencia({ pagina = null, orden = 'tiempo', minDias = 0, limite = 200 } = {}) {
    const seguidos = new Map(rows(q.anunciantes).map((a) => [a.pagina_id, a]));
    const todos = rows(q.lib).filter((a) => a.competidor === 'anunciante' ? seguidos.has(a.pagina_id) : true);
    // Los que no salieron en la última búsqueda de su anunciante ya no están activos
    const vivos = todos.filter((a) => {
      const s = seguidos.get(a.pagina_id);
      return a.competidor !== 'anunciante' || !s?.ultima_sync || !a.visto || a.visto >= s.ultima_sync;
    });
    const clave = (a) => `${a.pagina_id}|${sinTildes(a.cuerpo).replace(/\s+/g, ' ').slice(0, 160)}`;
    const variantes = new Map();
    for (const a of vivos) if (a.cuerpo) variantes.set(clave(a), (variantes.get(clave(a)) || 0) + 1);
    let lista = vivos.map((a) => vistaAnuncio(a, a.cuerpo ? variantes.get(clave(a)) : 1)).filter((a) => a.activo);
    if (pagina) lista = lista.filter((a) => a.pagina_id === String(pagina));
    if (minDias > 0) lista = lista.filter((a) => (a.diasActivo || 0) >= minDias);
    const k = { tiempo: (a) => a.diasActivo || 0, recientes: (a) => new Date(a.inicio || 0).getTime(), alcance: (a) => a.alcance_ue || 0, variantes: (a) => a.variantes }[orden] || ((a) => a.diasActivo || 0);
    lista.sort((a, b) => (k(b) - k(a)) || ((b.diasActivo || 0) - (a.diasActivo || 0)));
    return { anunciantes: rows(q.anunciantes), anuncios: lista.slice(0, limite), total: lista.length };
  }

  function anuncioCompetencia(id) {
    const a = row(q.anuncio, String(id));
    if (!a) throw publico('Ese anuncio ya no está: vuelve a buscar');
    let cuerpos = [];
    try { cuerpos = a.cuerpos ? JSON.parse(a.cuerpos) : []; } catch { /* solo el principal */ }
    return { ...vistaAnuncio(a), cuerpos: cuerpos.length ? cuerpos : [a.cuerpo].filter(Boolean), transcripcion: a.transcripcion || null, nota: a.nota || null };
  }

  // ---------- Vídeo e imágenes de un anuncio (se guardan en el vault para verlos, transcribirlos y adaptarlos) ----------
  const dirAnuncio = (id) => path.join(mediosDir, String(id).replace(/[^\w-]/g, '_'));
  async function bajar(url, destino) {
    const r = await fetchImpl(url, { signal: AbortSignal.timeout(180000) });
    if (!r.ok || !r.body) throw new Error(`descarga ${r.status}`);
    await pipeline(Readable.fromWeb(r.body), createWriteStream(destino));
  }
  // La vista previa del anuncio (con el token, como la da la API) → enlaces de su vídeo y sus imágenes.
  // Primero se lee tal cual (rápido); si Meta la monta con JavaScript, se abre en el navegador de JARVIS.
  async function leerSnapshot(a) {
    const url = new URL(a.snapshot);
    if (!url.searchParams.has('access_token') && tokenUsuario()) url.searchParams.set('access_token', tokenUsuario());
    let html = '';
    try {
      const r = await fetchImpl(url, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', 'accept-language': 'es-ES,es;q=0.9' }, signal: AbortSignal.timeout(30000) });
      html = await r.text();
    } catch { /* se prueba con el navegador */ }
    let m = mediosDeSnapshot(html);
    if (m.videos.length || m.imagenes.length) return m;
    let pagina = null;
    if (renderizar) {
      try {
        pagina = await renderizar(url.toString());
        const d = mediosDeSnapshot(pagina.html);
        const unicos = (l) => [...new Set(l)];
        m = { videos: unicos([...(pagina.videos || []), ...d.videos]), imagenes: unicos([...(pagina.imagenes || []), ...d.imagenes]) };
        if (m.videos.length || m.imagenes.length) return m;
      } catch (e) { pagina = { titulo: '', texto: e.message }; }
    }
    if (!html && !pagina) throw publico('No he podido abrir la vista previa del anuncio en Meta. Vuelve a probar en un rato.');
    // Se guarda lo que devolvió Meta para poder ver qué ha pasado
    try {
      mkdirSync(dirAnuncio(a.id), { recursive: true });
      writeFileSync(path.join(dirAnuncio(a.id), 'vista-previa.html'), (pagina?.html || html || '').replace(/access_token=[^&"'\s]+/g, 'access_token=…'));
    } catch { /* solo era para revisar */ }
    return { ...m, motivo: motivoSnapshot(pagina || { html }) };
  }

  // La imagen de la tarjeta: la primera vez se saca de la vista previa (la imagen o la portada del vídeo) y se
  // guarda. Como mucho 3 a la vez, para no pedirle a Meta 25 vistas previas de golpe. Si no sale, no se vuelve a
  // intentar hasta pasadas 6 horas.
  let enMarcha = 0;
  const cola = [];
  const turno = () => new Promise((ok) => { if (enMarcha < 3) { enMarcha += 1; ok(); } else cola.push(ok); });
  const soltar = () => { const sig = cola.shift(); if (sig) sig(); else enMarcha -= 1; };
  const sinMiniatura = new Map();
  async function miniaturaAnuncio(id) {
    if (!mediosDir) return null;
    const a = row(q.anuncio, String(id));
    if (!a) return null;
    const dir = dirAnuncio(a.id);
    const m = mediosDe(a);
    const ya = () => ['miniatura.jpg', m?.portada, m?.imagenes?.[0]].filter(Boolean).map((f) => path.join(dir, f)).find((f) => existsSync(f)) || null;
    if (ya()) return ya();
    if (!a.snapshot || Date.now() - (sinMiniatura.get(a.id) || 0) < 6 * 3600000) return null;
    await turno();
    try {
      if (ya()) return ya();
      const { videos, imagenes } = await leerSnapshot(a);
      mkdirSync(dir, { recursive: true });
      const f = path.join(dir, 'miniatura.jpg');
      for (const u of imagenes.slice(0, 3)) {
        try { await bajar(u, f); return f; } catch { rmSync(f, { force: true }); }
      }
      // Sin imagen pero con vídeo: un fotograma del vídeo
      if (videos.length && fotograma) {
        try { await fotograma(videos[0], f); if (existsSync(f)) return f; } catch { rmSync(f, { force: true }); }
      }
      sinMiniatura.set(a.id, Date.now());
      return null;
    } catch { sinMiniatura.set(a.id, Date.now()); return null; } finally { soltar(); }
  }

  async function mediosAnuncio(id) {
    if (!mediosDir) throw publico('Aquí no se pueden guardar los vídeos de los anuncios');
    const a = row(q.anuncio, String(id));
    if (!a) throw publico('Ese anuncio ya no está: vuelve a buscar');
    const ya = mediosDe(a);
    if (ya && (ya.video || ya.imagenes?.length) && [ya.video, ...(ya.imagenes || [])].filter(Boolean).every((f) => existsSync(path.join(dirAnuncio(a.id), f)))) return anuncioCompetencia(a.id);
    if (!a.snapshot) throw publico('Meta no da la vista previa de este anuncio: ábrelo en la Biblioteca de anuncios');
    const { videos, imagenes, motivo } = await leerSnapshot(a);
    if (!videos.length && !imagenes.length) throw publico(`No he podido sacar el vídeo ni las imágenes de este anuncio${motivo ? ` (${motivo})` : ''}. Ábrelo en la Biblioteca de anuncios o sube tú el vídeo.`);
    const dir = dirAnuncio(a.id);
    mkdirSync(dir, { recursive: true });
    const medios = { video: null, imagenes: [], portada: null };
    for (const v of videos) { try { await bajar(v, path.join(dir, 'video.mp4')); medios.video = 'video.mp4'; break; } catch { /* el siguiente */ } }
    for (const [i, im] of imagenes.slice(0, 10).entries()) {
      const f = `${String(i + 1).padStart(2, '0')}.jpg`;
      try { await bajar(im, path.join(dir, f)); medios.imagenes.push(f); } catch { /* sigue con las demás */ }
    }
    // En un anuncio de vídeo, la primera imagen suele ser su portada
    if (medios.video && medios.imagenes.length) { medios.portada = medios.imagenes[0]; medios.imagenes = medios.imagenes.slice(1); }
    if (!medios.video && !medios.imagenes.length) throw publico('Meta no deja descargar el vídeo de este anuncio. Ábrelo en la Biblioteca de anuncios o sube tú el vídeo.');
    q.setMedios.run(JSON.stringify(medios), a.id);
    alCambiar();
    return anuncioCompetencia(a.id);
  }
  // Si no se puede sacar, la persona sube el vídeo (lo descarga de la Biblioteca)
  async function subirVideoAnuncio(id, stream) {
    if (!mediosDir) throw publico('Aquí no se pueden guardar los vídeos de los anuncios');
    const a = row(q.anuncio, String(id));
    if (!a) throw publico('Ese anuncio ya no está: vuelve a buscar');
    const dir = dirAnuncio(a.id);
    mkdirSync(dir, { recursive: true });
    await pipeline(stream, createWriteStream(path.join(dir, 'video.mp4')));
    q.setMedios.run(JSON.stringify({ ...(mediosDe(a) || { imagenes: [] }), video: 'video.mp4' }), a.id);
    alCambiar();
    return anuncioCompetencia(a.id);
  }
  function rutaMedioAnuncio(id, fichero) {
    if (!mediosDir || !/^(video\.mp4|\d{2}\.jpg)$/.test(String(fichero))) return null;
    const f = path.join(dirAnuncio(id), fichero);
    return existsSync(f) ? f : null;
  }
  function guardarTranscripcionAnuncio(id, texto, nota = null) {
    q.setTranscripcion.run(texto, nota, String(id));
    alCambiar();
  }
  // Lo que necesita «Adaptar a mi estilo»: el anuncio con su texto, su transcripción y sus imágenes en el vault
  function paraAdaptar(id) {
    const a = anuncioCompetencia(id);
    const m = mediosDe(row(q.anuncio, String(id)));
    const imagenes = (m?.imagenes || []).map((f) => path.join(dirAnuncio(id), f)).filter((f) => existsSync(f));
    return { a, imagenes, video: m?.video ? path.join(dirAnuncio(id), m.video) : null };
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

  // El Administrador de anuncios: todas las cuentas, campañas, conjuntos y anuncios con sus métricas (solo lectura)
  const explorador = createExplorador({ graph, conectado: () => Boolean(tokenUsuario()), cuentaPorDefecto: cuenta, aj, demo: demoExplorador({ filaDe, metricasDe, resultadoDe: resultadoExplorador, resultadosTotales, columnasAcciones }) });

  return {
    ...explorador,
    estado, cuentas, elegirCuenta, rendimiento, paginaCompetidor, sincronizarBiblioteca, biblioteca, recomendarImpulso, proponer, descartar, confirmar, leerBorrador, resumen,
    buscarAnunciante, seguirAnunciante, dejarAnunciante, sincronizarAnunciante, sincronizarAnunciantes, anunciosCompetencia, anuncioCompetencia,
    mediosAnuncio, miniaturaAnuncio, subirVideoAnuncio, rutaMedioAnuncio, guardarTranscripcionAnuncio, paraAdaptar, dirAnuncio: (id) => (mediosDir ? dirAnuncio(id) : null),
  };
}
