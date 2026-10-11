import { createGraph, MetaError } from './meta.js';
import { AlmacenError } from './almacen.js';
import { planDePublicacion, instanteDe, NOMBRE_TIPO_IG } from '../../web/src/lib/planIg.js';
import { row, rows } from '../db.js';

// Publica en Instagram, con la API oficial, las piezas que TÚ marcas en el dashboard
// («Publicar sola en Instagram» o «Publicar ahora»). Nada más puede activarlo: ni Hermes ni Claude Code.
//
// Pasos (se guardan en ig_contenedor para poder seguir si JARVIS se cierra a medias):
//   1. subir los archivos a Supabase (Instagram los descarga de un enlace público)
//   2. crear el contenedor en Instagram (en un carrusel, primero uno por archivo)
//   3. esperar a que Instagram procese el vídeo
//   4. publicar y guardar el enlace de la publicación
// Solo funciona con el PC encendido y JARVIS abierto: a la hora puesta, o en cuanto se abra si ya pasó.

export class PublicarError extends Error {}

const MINUTO = 60000;

export function createPublicadorIg({ db, jarvis, instagram, almacen, archivos, fetchImpl = fetch, alCambiar = () => {}, ahora = () => new Date(), dormir = (ms) => new Promise((ok) => setTimeout(ok, ms)), esperaMax = 10 * MINUTO, cadaCuanto = 5000, log = console }) {
  const q = {
    get: db.prepare('SELECT * FROM piezas WHERE id = ?'),
    pendientes: db.prepare("SELECT * FROM piezas WHERE publicar_ig = 1 AND (ig_estado IS NULL OR ig_estado = 'procesando') ORDER BY fecha, hora, id"),
  };
  const set = (id, campos) => {
    const k = Object.keys(campos);
    db.prepare(`UPDATE piezas SET ${k.map((c) => `${c} = ?`).join(', ')}, actualizado = datetime('now','localtime') WHERE id = ?`).run(...k.map((c) => campos[c] ?? null), id);
  };
  const leer = (id) => {
    const p = row(q.get, Number(id));
    if (!p) throw new PublicarError('Esa pieza no existe');
    let a = [];
    try { a = JSON.parse(p.archivos || '[]'); } catch { /* sin archivos */ }
    return { ...p, archivos: Array.isArray(a) ? a : [] };
  };

  function estado() {
    const ig = instagram?.estado?.() || {};
    return {
      disponible: Boolean(ig.conectadoMeta),
      cuenta: ig.conectadoMeta ? ig.username : null,
      almacen: Boolean(almacen?.configurado()),
      motivo: !ig.conectadoMeta ? 'Conecta Instagram con Facebook (pestaña Instagram) para publicar desde JARVIS.'
        : !almacen?.configurado() ? 'Falta dónde subir los archivos para Instagram: npm run claves → CRM_SUPABASE_URL y CRM_SUPABASE_ANON_KEY.' : null,
    };
  }
  const comprobarListo = () => {
    const e = estado();
    if (e.motivo) throw new PublicarError(e.motivo);
  };

  // Marcar o desmarcar «Publicar sola en Instagram» (solo desde el dashboard)
  function marcar(id, publicar) {
    const p = leer(id);
    if (p.ig_estado === 'publicado') {
      if (publicar) throw new PublicarError('Esta pieza ya está publicada en Instagram.');
      set(p.id, { publicar_ig: 0 });
      return leer(p.id);
    }
    if (!publicar) {
      set(p.id, { publicar_ig: 0, ig_estado: null, ig_error: null });
      return leer(p.id);
    }
    comprobarListo();
    const { problemas } = planDePublicacion(p);
    if (problemas.length) throw new PublicarError(`Para publicarla en Instagram falta: ${problemas.join(' ')}`);
    // Volver a guardar una que dio error = reintentar desde cero
    set(p.id, { publicar_ig: 1, ig_estado: null, ig_error: null, ig_contenedor: null, estado: p.estado === 'publicado' ? 'publicado' : 'listo' });
    alCambiar();
    return leer(p.id);
  }

  // «Publicar ahora»: no espera a la fecha
  function publicarAhora(id) {
    const p = leer(id);
    if (p.ig_estado === 'publicado') throw new PublicarError('Esta pieza ya está publicada en Instagram.');
    comprobarListo();
    const { problemas } = planDePublicacion(p, { conFecha: false });
    if (problemas.length) throw new PublicarError(`Para publicarla en Instagram falta: ${problemas.join(' ')}`);
    set(p.id, { publicar_ig: 1, ig_estado: 'procesando', ig_error: null, ig_contenedor: null });
    alCambiar();
    revisar().catch((e) => log.warn?.(`  Instagram (publicar): ${e.message}`));
    return { ok: true };
  }

  // ---------- Graph API ----------
  async function esperar(g, contenedor) {
    const fin = Date.now() + esperaMax;
    for (;;) {
      const r = await g.get(contenedor, { fields: 'status_code,status' });
      if (r.status_code === 'FINISHED' || r.status_code === 'PUBLISHED') return true;
      if (r.status_code === 'ERROR') throw new PublicarError(`Instagram no pudo procesar el archivo${r.status ? `: ${r.status}` : ''}. Revisa el formato (vídeo MP4 H.264, de 3 s a 15 min).`);
      if (r.status_code === 'EXPIRED') { const e = new PublicarError('Instagram caducó la preparación (más de 24 h sin publicar). Se vuelve a empezar.'); e.reiniciar = true; throw e; }
      if (Date.now() >= fin) return false; // sigue procesando: se mira en la próxima vuelta
      await dormir(cadaCuanto);
    }
  }

  async function procesar(p) {
    const c = instagram.conexion();
    if (!c?.token || !c?.igUserId) throw new PublicarError('Instagram no está conectado con Facebook.');
    const g = createGraph({ token: c.token, fetchImpl });
    const { tipo, problemas } = planDePublicacion(p, { conFecha: false });
    if (problemas.length) throw new PublicarError(problemas.join(' '));
    let st = {};
    try { st = JSON.parse(p.ig_contenedor || '{}'); } catch { /* empezar */ }
    const guardar = () => set(p.id, { ig_contenedor: JSON.stringify(st), ig_estado: 'procesando' });

    // 1. Archivos en un enlace público
    if (!st.subidos) {
      st.subidos = [];
      for (const [i, a] of p.archivos.entries()) {
        const video = /^video\//.test(a.mime || '');
        if (/^https?:\/\//.test(a.url || '')) { st.subidos.push({ url: a.url, video }); continue; }
        const nombre = String(a.path || a.nombre || 'archivo').split('/').pop();
        const s = await almacen.subir(archivos.ruta(a.path), { destino: `${p.id}-${Date.now()}-${i}-${nombre}`, mime: a.mime });
        st.subidos.push({ ...s, video });
      }
      guardar();
    }
    const caption = tipo === 'STORIES' ? undefined : p.caption || undefined;

    // 2 y 3. Contenedores
    if (tipo === 'CAROUSEL') {
      if (!st.hijos) {
        st.hijos = [];
        for (const s of st.subidos) {
          const r = await g.post(`${c.igUserId}/media`, s.video ? { media_type: 'VIDEO', video_url: s.url, is_carousel_item: true } : { image_url: s.url, is_carousel_item: true });
          st.hijos.push(r.id);
          guardar();
        }
      }
      for (const h of st.hijos) if (!(await esperar(g, h))) return { listo: false };
      if (!st.contenedor) {
        st.contenedor = (await g.post(`${c.igUserId}/media`, { media_type: 'CAROUSEL', children: st.hijos.join(','), caption })).id;
        guardar();
      }
    } else if (!st.contenedor) {
      const s = st.subidos[0];
      const params = tipo === 'REELS' ? { media_type: 'REELS', video_url: s.url, caption, share_to_feed: true }
        : tipo === 'STORIES' ? { media_type: 'STORIES', ...(s.video ? { video_url: s.url } : { image_url: s.url }) }
          : { image_url: s.url, caption };
      st.contenedor = (await g.post(`${c.igUserId}/media`, params)).id;
      guardar();
    }
    if (!(await esperar(g, st.contenedor))) return { listo: false };

    // 4. Publicar
    const pub = await g.post(`${c.igUserId}/media_publish`, { creation_id: st.contenedor });
    let permalink = null;
    try { permalink = (await g.get(pub.id, { fields: 'permalink' })).permalink || null; } catch { /* sin enlace */ }
    set(p.id, { ig_estado: 'publicado', ig_error: null, ig_media_id: pub.id, ig_permalink: permalink, ig_publicado_en: ahora().toISOString(), ig_contenedor: null, estado: 'publicado', publicar_ig: 0 });
    almacen.borrar(st.subidos.map((s) => s.ruta).filter(Boolean));
    jarvis.registrar('Contenido', `Publicado en Instagram (${NOMBRE_TIPO_IG[tipo]}): ${p.titulo}`, 'dashboard');
    return { listo: true, permalink };
  }

  // Lo que toca publicar: lo marcado cuya hora ya llegó, y lo que estaba a medias
  let trabajando = false;
  async function revisar() {
    if (trabajando || !estado().disponible) return { publicadas: 0 };
    trabajando = true;
    let publicadas = 0;
    try {
      const ya = ahora();
      for (const fila of rows(q.pendientes)) {
        const cuando = instanteDe(fila);
        if (fila.ig_estado !== 'procesando' && (!cuando || cuando > ya)) continue;
        const p = leer(fila.id);
        try {
          const r = await procesar(p);
          if (r.listo) publicadas++;
        } catch (e) {
          const conocido = e instanceof MetaError || e instanceof AlmacenError || e instanceof PublicarError;
          if (e.reiniciar) set(p.id, { ig_contenedor: null, ig_estado: null });
          else set(p.id, { ig_estado: 'error', ig_error: conocido ? e.message : `Error inesperado: ${e.message}` });
          if (!conocido) log.warn?.(`  Instagram (publicar): ${e.stack || e.message}`);
        }
        alCambiar();
      }
    } finally {
      trabajando = false;
    }
    return { publicadas };
  }

  let timer = null;
  function iniciar() {
    const tick = () => revisar().catch((e) => log.warn?.(`  Instagram (publicar): ${e.message}`));
    setTimeout(tick, 20000).unref?.();
    timer = setInterval(tick, MINUTO);
    timer.unref?.();
  }

  return { estado, marcar, publicarAhora, revisar, iniciar, parar: () => clearInterval(timer) };
}
