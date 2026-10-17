import path from 'node:path';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { ajustes, row, rows } from '../db.js';
import { createGraph, MetaError } from './meta.js';
import { formatoDe, primeraFrase, fechaLocal } from './instagram.js';
import { demoCompetencia } from './competencia-demo.js';
import { transcribir as transcribirElevenLabs, sttConfigurado } from '../stt.js';

// Competencia: datos públicos de perfiles profesionales vía Business Discovery (API oficial de Instagram).
// Lo que se puede calcular se calcula aquí (ganchos con más engagement, formatos, frecuencia);
// temas, patrones e ideas adaptadas los saca JARVIS y los guarda con el MCP.

const DIA = 86400000;

export const PROMPT_ANALISIS = `Analiza a mi competencia de Instagram:
1. Usa competencia_datos para ver los perfiles activos y sus publicaciones ordenadas por engagement (interacciones / seguidores).
2. Para entender MI negocio, lee CLAUDE.md y _voz.md y usa metricas_instagram (si mis datos son de ejemplo, no los uses).
3. Detecta los temas que más funcionan (con el % de engagement que se llevan), los patrones (estructuras de gancho, formatos, CTAs, frecuencia) y propón 6 ideas ADAPTADAS a mi negocio: no copies, adapta el patrón a lo que yo vendo y a mi voz. En cada idea indica en inspiradoEn el id de la publicación que la inspira.
4. Guarda el resultado con guardar_analisis_competencia y responde con un resumen de dos líneas.`;
export const limpiarUsuario = (u) => String(u || '').trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/[/?#].*$/, '').toLowerCase();
const USUARIO_OK = /^[a-z0-9._]{1,30}$/;
// Campos de cada publicación, de más a menos completos: no todas las versiones de la API dejan pedir
// visualizaciones (view_count) o los slides (children) de otros perfiles; si no, se baja un nivel.
const CAMPOS_BASE = 'id,caption,like_count,comments_count,media_type,media_product_type,permalink,timestamp,thumbnail_url,media_url';
const NIVELES_CAMPOS = [`${CAMPOS_BASE},view_count,children{media_type,media_url,thumbnail_url}`, `${CAMPOS_BASE},children{media_type,media_url,thumbnail_url}`, CAMPOS_BASE];
// Por qué se puede ordenar la lista de publicaciones
export const ORDENES = { engagement: 'Engagement', interacciones: 'Interacciones', vistas: 'Visualizaciones', likes: 'Me gusta', comentarios: 'Comentarios', fecha: 'Más recientes' };
const publico = (m, extra = {}) => Object.assign(new Error(m), { publico: true }, extra);
// Cuántas publicaciones de su cuenta se miran como mucho para encontrar un enlace
const MAX_ENLACE = 400;
const NO_USUARIOS = ['p', 'reel', 'reels', 'tv', 'stories', 'explore'];
// «Please reduce the amount of data you're asking for» (código 1): la página de publicaciones pesa demasiado
const demasiadosDatos = (e) => e.codigo === 1 || /reduce the amount of data/i.test(e.message);

// Enlace de una publicación de Instagram: instagram.com/p/CODIGO, /reel/CODIGO, /tv/CODIGO o /usuario/p/CODIGO
export function leerEnlace(url) {
  const m = String(url || '').trim().match(/^(?:https?:\/\/)?(?:www\.|m\.)?instagram\.com\/(?:([A-Za-z0-9._]{1,30})\/)?(p|reels?|tv)\/([A-Za-z0-9_-]{5,})/i);
  if (!m) return null;
  const usuario = m[1] && !NO_USUARIOS.includes(m[1].toLowerCase()) ? m[1].toLowerCase() : null;
  return { codigo: m[3], usuario };
}

// De quién es una publicación, mirando su página pública (no siempre se puede: Instagram a veces pide iniciar sesión)
export function usuarioDePagina(html) {
  const t = String(html || '');
  const patrones = [
    /"owner"\s*:\s*\{[^{}]*?"username"\s*:\s*"([A-Za-z0-9._]{1,30})"/,
    /<meta[^>]+(?:property|name)="og:description"[^>]+content="[^"]*?-\s*([A-Za-z0-9._]{1,30})\s+(?:on|el|en)\s/i,
    /<meta[^>]+(?:property|name)="og:title"[^>]+content="[^"]*?\(@([A-Za-z0-9._]{1,30})\)/i,
  ];
  for (const re of patrones) { const m = t.match(re); if (m && !NO_USUARIOS.includes(m[1].toLowerCase())) return m[1].toLowerCase(); }
  return null;
}

export function createCompetencia({ db, instagram, vault, env = process.env, fetchImpl = fetch, sttImpl = transcribirElevenLabs, alCambiar = () => {} }) {
  const aj = ajustes(db);
  const q = {
    perfiles: db.prepare('SELECT * FROM comp_perfiles ORDER BY anadido'),
    perfil: db.prepare('SELECT * FROM comp_perfiles WHERE username = ?'),
    insPerfil: db.prepare('INSERT OR IGNORE INTO comp_perfiles (username) VALUES (?)'),
    delPerfil: db.prepare('DELETE FROM comp_perfiles WHERE username = ?'),
    delMediaDe: db.prepare('DELETE FROM comp_media WHERE username = ?'),
    activo: db.prepare('UPDATE comp_perfiles SET activo = ? WHERE username = ?'),
    actPerfil: db.prepare("UPDATE comp_perfiles SET nombre = ?, bio = ?, seguidores = ?, publicaciones = ?, foto = ?, ultima_sync = datetime('now','localtime'), error = NULL WHERE username = ?"),
    errPerfil: db.prepare("UPDATE comp_perfiles SET error = ?, ultima_sync = datetime('now','localtime') WHERE username = ?"),
    upMedia: db.prepare(`INSERT INTO comp_media (id, username, formato, caption, permalink, miniatura, fecha, likes, comentarios, gancho, media_url, hijos, vistas)
      VALUES (@id, @username, @formato, @caption, @permalink, @miniatura, @fecha, @likes, @comentarios, @gancho, @media_url, @hijos, @vistas)
      ON CONFLICT(id) DO UPDATE SET likes = excluded.likes, comentarios = excluded.comentarios, miniatura = COALESCE(excluded.miniatura, miniatura), caption = excluded.caption,
        media_url = COALESCE(excluded.media_url, media_url), hijos = COALESCE(excluded.hijos, hijos), vistas = COALESCE(excluded.vistas, vistas)`),
    media: db.prepare('SELECT * FROM comp_media ORDER BY fecha DESC'),
    unaMedia: db.prepare('SELECT m.*, COALESCE(p.seguidores, m.autor_seguidores) AS seguidores FROM comp_media m LEFT JOIN comp_perfiles p ON p.username = m.username WHERE m.id = ?'),
    porCodigo: db.prepare("SELECT id, username, transcripcion, por_enlace >= datetime('now','localtime','-12 hours') AS reciente FROM comp_media WHERE permalink LIKE '%/' || ? || '/%' OR permalink LIKE '%/' || ?"),
    traida: db.prepare("UPDATE comp_media SET por_enlace = datetime('now','localtime'), autor_seguidores = COALESCE(?, autor_seguidores) WHERE id = ?"),
    traidas: db.prepare('SELECT * FROM comp_media WHERE por_enlace IS NOT NULL ORDER BY por_enlace DESC LIMIT 12'),
    porPermalink: db.prepare('SELECT id FROM comp_media WHERE permalink = ? ORDER BY fecha DESC LIMIT 1'),
    transcrita: db.prepare('UPDATE comp_media SET transcripcion = ?, nota = ? WHERE id = ?'),
    insAnalisis: db.prepare('INSERT INTO comp_analisis (perfiles, datos, nota) VALUES (?, ?, ?)'),
    ultimoAnalisis: db.prepare('SELECT * FROM comp_analisis ORDER BY id DESC LIMIT 1'),
  };

  // Competidores iniciales desde .env (COMPETIDORES=marcauno,marcados) la primera vez
  if (!rows(q.perfiles).length && !aj.leer('comp_sembrado')) {
    for (const u of String(env.COMPETIDORES || '').split(',').map(limpiarUsuario).filter((x) => USUARIO_OK.test(x))) q.insPerfil.run(u);
    aj.guardar('comp_sembrado', true);
  }

  let sincronizando = false;

  // Business Discovery de un perfil. Si esta versión de la API no deja pedir algún campo de las publicaciones,
  // se prueba con menos campos y se recuerda. Si Meta dice que son demasiados datos (cuentas con muchos carruseles
  // largos), se piden menos publicaciones por página. Devuelve también el tamaño de página que ha funcionado.
  async function descubrir(g, c, usuario, { limite = 50, after = null } = {}) {
    const pedir = (nivel, n) => g.get(c.igUserId, { fields: `business_discovery.username(${usuario}){username,name,biography,followers_count,media_count,profile_picture_url,media.${after ? `after(${after}).` : ''}limit(${n}){${NIVELES_CAMPOS[nivel]}}}` });
    let nivel = Math.min(Number(aj.leer('comp_nivel_campos', 0)) || 0, NIVELES_CAMPOS.length - 1);
    let n = limite;
    let r;
    for (;;) {
      try { r = await pedir(nivel, n); break; } catch (e) {
        if (e instanceof MetaError && e.codigo === 100 && /field/i.test(e.message) && nivel < NIVELES_CAMPOS.length - 1) { nivel++; continue; }
        if (e instanceof MetaError && demasiadosDatos(e) && n > 5) { n = Math.max(5, Math.floor(n / 2)); continue; }
        throw e;
      }
    }
    if (nivel !== (Number(aj.leer('comp_nivel_campos', 0)) || 0)) aj.guardar('comp_nivel_campos', nivel);
    return { bd: r.business_discovery || {}, limite: n };
  }
  function guardarMedia(m, username) {
    q.upMedia.run({
      id: m.id, username, formato: formatoDe(m), caption: m.caption || null, permalink: m.permalink || null,
      miniatura: m.thumbnail_url || (m.media_type === 'VIDEO' ? null : primeraImagen(m)) || null,
      fecha: m.timestamp, likes: m.like_count ?? null, comentarios: m.comments_count ?? null, gancho: primeraFrase(m.caption),
      media_url: m.media_url || null, vistas: m.view_count ?? null,
      hijos: m.children?.data?.length ? JSON.stringify(m.children.data.map((h) => ({ tipo: h.media_type, url: h.media_url || null, miniatura: h.thumbnail_url || null }))) : null,
    });
  }

  function anadir(usuario) {
    const u = limpiarUsuario(usuario);
    if (!USUARIO_OK.test(u)) { const e = new Error('Escribe un usuario de Instagram válido (por ejemplo @marcauno)'); e.publico = true; throw e; }
    if (rows(q.perfiles).length >= 15) { const e = new Error('Como mucho 15 perfiles a la vez'); e.publico = true; throw e; }
    q.insPerfil.run(u);
    alCambiar();
    return row(q.perfil, u);
  }
  function quitar(usuario) {
    const u = limpiarUsuario(usuario);
    q.delMediaDe.run(u);
    q.delPerfil.run(u);
    alCambiar();
    return { ok: true };
  }
  function activar(usuario, activo) {
    q.activo.run(activo ? 1 : 0, limpiarUsuario(usuario));
    alCambiar();
    return { ok: true };
  }

  async function sincronizar({ soloUsuario } = {}) {
    const c = instagram.conexion();
    if (!c?.token) { const e = new Error('Conecta tu Instagram primero: la API de Instagram solo deja ver otros perfiles desde una cuenta profesional conectada'); e.publico = true; throw e; }
    if (sincronizando) return { ok: false, motivo: 'Ya hay una sincronización en marcha' };
    sincronizando = true;
    alCambiar();
    const g = createGraph({ token: c.token, fetchImpl });
    const res = { ok: true, perfiles: 0, publicaciones: 0, errores: [] };
    try {
      for (const p of rows(q.perfiles).filter((x) => !soloUsuario || x.username === soloUsuario)) {
        try {
          const { bd } = await descubrir(g, c, p.username, { limite: Number(env.COMP_MAX_PUBLICACIONES) || 50 });
          q.actPerfil.run(bd.name || null, bd.biography || null, bd.followers_count ?? null, bd.media_count ?? null, bd.profile_picture_url || null, p.username);
          for (const m of bd.media?.data || []) {
            guardarMedia(m, p.username);
            res.publicaciones++;
          }
          res.perfiles++;
        } catch (e) {
          if (e instanceof MetaError && e.caducado) throw e;
          const msg = e instanceof MetaError && (e.codigo === 110 || e.codigo === 100)
            ? 'No es una cuenta profesional, no existe o es privada: Instagram no deja analizarla.'
            : e.message;
          q.errPerfil.run(msg.slice(0, 200), p.username);
          res.errores.push({ username: p.username, error: msg });
        }
      }
      aj.guardar('comp_sync', { fin: new Date().toISOString() });
      return res;
    } finally {
      sincronizando = false;
      alCambiar();
    }
  }

  // ---------- Una publicación cualquiera, desde su enlace ----------
  // Se busca con Business Discovery entre las últimas publicaciones de su cuenta (tiene que ser profesional) y se
  // guarda como las de la competencia: así se ven sus slides, se transcribe y se replica igual.
  async function deQuienEs(codigo) {
    try {
      const r = await fetchImpl(`https://www.instagram.com/p/${codigo}/`, {
        headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', 'accept-language': 'en-US,en;q=0.8' },
        redirect: 'follow', signal: AbortSignal.timeout(15000),
      });
      return r.ok ? usuarioDePagina(await r.text()) : null;
    } catch { return null; }
  }

  async function porEnlace({ url, usuario } = {}) {
    const e = leerEnlace(url);
    if (!e) throw publico('Pega el enlace de una publicación o un reel de Instagram (instagram.com/p/… o instagram.com/reel/…)');
    // Ya traída: sirve si tiene sus slides o su transcripción, o si es de hace poco (los enlaces de Instagram caducan)
    const ya = row(q.porCodigo, e.codigo, e.codigo);
    if (ya && (ya.reciente || ya.transcripcion || slidesGuardados(ya.id).length)) { q.traida.run(null, ya.id); alCambiar(); return detalle(ya.id); }
    const c = instagram.conexion();
    if (!c?.token) throw publico('Conecta tu Instagram primero (pestaña Instagram): es lo que deja traer publicaciones de otras cuentas');
    const u = limpiarUsuario(usuario) || e.usuario || ya?.username || await deQuienEs(e.codigo);
    if (!u || !USUARIO_OK.test(u)) throw publico('No sé de qué cuenta es: escribe su @usuario', { campo: 'usuario' });
    const g = createGraph({ token: c.token, fetchImpl });
    let after = null;
    let limite = 50;
    for (let vistas = 0, pedidas = 0; vistas < MAX_ENLACE && pedidas < 30; pedidas++) {
      let bd;
      try {
        ({ bd, limite } = await descubrir(g, c, u, { limite, after }));
      } catch (err) {
        if (err instanceof MetaError && (err.codigo === 110 || err.codigo === 100)) throw publico(`@${u} no es una cuenta profesional, no existe o es privada: Instagram no deja traer sus publicaciones. Copia su texto y pídeselo a JARVIS en el Chat.`, { campo: 'usuario' });
        throw err;
      }
      const m = (bd.media?.data || []).find((x) => String(x.permalink || '').includes(`/${e.codigo}`));
      if (m) {
        guardarMedia(m, u);
        q.traida.run(bd.followers_count ?? null, m.id);
        alCambiar();
        return detalle(m.id);
      }
      vistas += bd.media?.data?.length || limite;
      after = bd.media?.paging?.cursors?.after;
      if (!after || !bd.media?.paging?.next) break;
    }
    throw publico(`No encuentro esa publicación entre las últimas de @${u}. ¿Seguro que es suya?`, { campo: 'usuario' });
  }

  // Las últimas traídas por enlace
  const traidas = () => rows(q.traidas).map((m) => {
    const interacciones = (m.likes || 0) + (m.comentarios || 0);
    return {
      ...ligera(conMiniatura({ ...m, interacciones, engagement: m.autor_seguidores ? Math.round((interacciones / m.autor_seguidores) * 1000) / 10 : null })),
      traida: m.por_enlace,
    };
  });

  // ---------- Análisis (lo escribe JARVIS) ----------
  function guardarAnalisis({ perfiles = [], temas = [], patrones = [], ideas = [], resumen = '' }) {
    const datos = {
      resumen: String(resumen).slice(0, 1200),
      temas: temas.slice(0, 10).map((t) => ({ tema: String(t.tema).slice(0, 50), pct: Math.max(0, Math.min(100, Number(t.pct) || 0)), detalle: String(t.detalle || '').slice(0, 200) })),
      patrones: patrones.slice(0, 10).map((p) => ({ titulo: String(p.titulo).slice(0, 80), detalle: String(p.detalle || '').slice(0, 300) })),
      ideas: ideas.slice(0, 10).map((i) => ({
        titulo: String(i.titulo).slice(0, 120), formato: String(i.formato || '').slice(0, 30), gancho: String(i.gancho || '').slice(0, 200),
        porque: String(i.porque || '').slice(0, 300), inspiradoEn: i.inspiradoEn ? String(i.inspiradoEn) : null,
      })),
    };
    const fecha = new Date().toLocaleDateString('sv-SE');
    const md = [
      '---', 'tipo: analisis-competencia', `fecha: ${fecha}`, `perfiles: ${perfiles.map((p) => `@${p}`).join(', ')}`, '---',
      `# Análisis de competencia ${fecha}`, '', datos.resumen, '',
      '## Temas que más funcionan', ...datos.temas.map((t) => `- **${t.tema}** (${t.pct} %): ${t.detalle}`), '',
      '## Patrones detectados', ...datos.patrones.map((p) => `- **${p.titulo}**: ${p.detalle}`), '',
      '## Ideas adaptadas a mi negocio', ...datos.ideas.map((i) => `- **${i.titulo}** (${i.formato}). Gancho: "${i.gancho}". ${i.porque}`), '',
    ].join('\n');
    const nota = vault.create('04-Competencia', `Análisis de competencia ${fecha}`, md);
    q.insAnalisis.run(JSON.stringify(perfiles), JSON.stringify(datos), nota);
    alCambiar();
    return { ok: true, nota };
  }

  // Datos para JARVIS: perfiles y publicaciones ordenadas por engagement
  function datosParaAnalisis({ usuario } = {}) {
    const perfiles = rows(q.perfiles).filter((p) => p.activo && (!usuario || p.username === limpiarUsuario(usuario)));
    const r = calcular(perfiles, rows(q.media));
    return {
      perfiles: perfiles.map((p) => ({ username: p.username, nombre: p.nombre, bio: p.bio, seguidores: p.seguidores, error: p.error })),
      formatos: r.formatos,
      frecuencia: r.frecuencia,
      publicaciones: r.publicaciones.slice(0, 60).map((m) => ({ id: m.id, username: m.username, fecha: m.fecha?.slice(0, 10), formato: m.formato, engagement: m.engagement, likes: m.likes, comentarios: m.comentarios, texto: (m.caption || '').slice(0, 500) })),
    };
  }

  function resumen() {
    const conectado = Boolean(instagram.conexion()?.token);
    const perfiles = rows(q.perfiles);
    const conDatos = perfiles.filter((p) => p.ultima_sync && !p.error);
    const ultimo = row(q.ultimoAnalisis);
    const base = {
      perfiles: perfiles.map((p) => ({ ...p, activo: Boolean(p.activo) })),
      conectado, sincronizando, ultimaSync: aj.leer('comp_sync', {}).fin || null,
    };
    if (!conDatos.length) {
      const demo = demoCompetencia();
      return { ...base, demo: true, perfilesDemo: demo.perfiles, ...calcular(demo.perfiles, demo.media), analisis: demo.analisis };
    }
    const activos = perfiles.filter((p) => p.activo && p.ultima_sync && !p.error);
    const r = calcular(activos, rows(q.media));
    return {
      ...base, demo: false, ...r, publicaciones: r.publicaciones.map((m) => ligera(conMiniatura(m))),
      mejoresGanchos: r.mejoresGanchos.map(conMiniatura),
      analisis: ultimo ? { ...JSON.parse(ultimo.datos), fecha: ultimo.ts, perfiles: JSON.parse(ultimo.perfiles), nota: ultimo.nota } : null,
    };
  }

  // ---------- Una publicación: detalle, slides, transcripción ----------
  const dirSlides = (id) => path.join(vault.base, '.jarvis', 'competencia', String(id).replace(/[^\w-]/g, '_'));
  // Miniaturas: Instagram no da una propia para los carruseles (se usa su primera imagen) y sus enlaces caducan a
  // los pocos días, así que la primera vez que se ve se guarda aquí y se sirve desde JARVIS
  const dirMiniaturas = path.join(vault.base, '.jarvis', 'competencia', '_miniaturas');
  const rutaMiniatura = (id) => path.join(dirMiniaturas, `${String(id).replace(/[^\w-]/g, '_')}.jpg`);
  function fuenteMiniatura(m) {
    if (m.miniatura) return m.miniatura;
    let hijos = [];
    try { hijos = typeof m.hijos === 'string' ? JSON.parse(m.hijos) : m.hijos || []; } catch { /* sin hijos */ }
    if (hijos[0]) return (hijos[0].tipo === 'VIDEO' ? hijos[0].miniatura : hijos[0].url) || null;
    return m.formato === 'Reels' ? null : m.media_url || null;
  }
  // Lo que ve el dashboard: la primera slide ya descargada, la miniatura guardada o el enlace para guardarla
  function conMiniatura(m) {
    if (String(m.id).startsWith('demo-')) return m;
    const slide = slidesGuardados(m.id)[0];
    if (slide) return { ...m, miniatura: `/api/competencia/publicaciones/${encodeURIComponent(m.id)}/slides/${path.basename(slide)}` };
    return { ...m, miniatura: existsSync(rutaMiniatura(m.id)) || fuenteMiniatura(m) ? `/api/competencia/publicaciones/${encodeURIComponent(m.id)}/miniatura` : null };
  }
  async function miniatura(id) {
    const f = rutaMiniatura(id);
    if (existsSync(f)) return f;
    const m = row(q.unaMedia, String(id));
    const url = m && fuenteMiniatura(m);
    if (!url) return null;
    let r;
    try { r = await fetchImpl(url, { signal: AbortSignal.timeout(20000) }); } catch { return null; }
    if (!r.ok || !/^image\//.test(r.headers.get('content-type') || 'image/')) return null; // caducada: hasta la próxima sincronización
    mkdirSync(dirMiniaturas, { recursive: true });
    writeFileSync(f, Buffer.from(await r.arrayBuffer()));
    return f;
  }
  const rutaVault = (abs) => path.relative(vault.base, abs).split(path.sep).join('/');
  function leer(id) {
    if (String(id).startsWith('demo-')) throw publico('Es una publicación de ejemplo: sincroniza a tus competidores reales para verla en detalle');
    const m = row(q.unaMedia, String(id));
    if (!m) throw publico('Esa publicación ya no está: vuelve a sincronizar');
    const inter = (m.likes || 0) + (m.comentarios || 0);
    return { ...m, hijos: m.hijos ? JSON.parse(m.hijos) : [], interacciones: inter, engagement: m.seguidores ? Math.round((inter / m.seguidores) * 1000) / 10 : null };
  }
  const slidesGuardados = (id) => {
    const dir = dirSlides(id);
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((f) => /^\d+\.jpg$/.test(f)).sort().map((f) => path.join(dir, f));
  };
  function detalle(id) {
    const m = conMiniatura(leer(id));
    return { ...m, slides: slidesGuardados(m.id).map((f) => path.basename(f)), puedeTranscribir: m.formato === 'Reels' && Boolean(m.media_url) && sttConfigurado(env), stt: sttConfigurado(env) };
  }

  // Descarga las imágenes del carrusel (o la imagen) al vault, para verlas y para que Claude las lea
  async function descargarSlides(id) {
    const m = leer(id);
    const ya = slidesGuardados(m.id);
    if (ya.length) return ya;
    const urls = (m.hijos.length ? m.hijos.map((h) => (h.tipo === 'VIDEO' ? h.miniatura : h.url)) : [m.formato === 'Reels' ? m.miniatura : m.media_url || m.miniatura]).filter(Boolean);
    if (!urls.length) throw publico('Instagram no da las imágenes de esta publicación');
    const dir = dirSlides(m.id);
    mkdirSync(dir, { recursive: true });
    const hechas = [];
    for (const [i, u] of urls.slice(0, 20).entries()) {
      const r = await fetchImpl(u, { signal: AbortSignal.timeout(60000) });
      if (!r.ok) {
        if (!hechas.length) throw publico('Los enlaces de Instagram han caducado: pulsa Sincronizar (o vuelve a pegar su enlace en Laboratorio → Replicar) y vuelve a intentarlo');
        break;
      }
      const f = path.join(dir, `${String(i + 1).padStart(2, '0')}.jpg`);
      writeFileSync(f, Buffer.from(await r.arrayBuffer()));
      hechas.push(f);
    }
    return hechas;
  }
  function rutaSlide(id, fichero) {
    if (!/^\d+\.jpg$/.test(String(fichero))) return null;
    const f = path.join(dirSlides(id), fichero);
    return existsSync(f) ? f : null;
  }

  // Transcribe un reel de la competencia y lo guarda (también como nota en 04-Competencia)
  // video: el vídeo subido a mano (cuando Instagram no lo da, p. ej. reels con música con derechos)
  async function transcribir(id, { video = null } = {}) {
    const m = leer(id);
    if (m.transcripcion) return { transcripcion: m.transcripcion, nota: m.nota };
    if (m.formato !== 'Reels') throw publico('Solo se transcriben los reels');
    if (!sttConfigurado(env)) throw publico('Para transcribir hace falta la clave de ElevenLabs (ELEVENLABS_API_KEY en .env)');
    let buf = video?.length ? video : null;
    if (!buf) {
      if (!m.media_url) throw publico('Instagram no da el vídeo de este reel (pasa con algunos reels con música con derechos): descárgalo y súbelo');
      const r = await fetchImpl(m.media_url, { signal: AbortSignal.timeout(120000) });
      if (!r.ok) throw publico('El enlace del vídeo ha caducado: vuelve a traer la publicación o sube el vídeo');
      buf = Buffer.from(await r.arrayBuffer());
    }
    const texto = await sttImpl(buf, { env, fetchImpl });
    if (!texto) throw publico('La transcripción salió vacía (¿vídeo sin voz?)');
    const fecha = fechaLocal(m.fecha);
    const titulo = `@${m.username} ${fecha} ${(m.gancho || primeraFrase(texto) || 'Reel').replace(/[#@]/g, '').slice(0, 50)}`;
    const md = ['---', 'tipo: referencia-competencia', `usuario: @${m.username}`, `fecha: ${fecha}`, m.permalink && `enlace: ${m.permalink}`,
      m.likes != null && `me_gusta: ${m.likes}`, m.comentarios != null && `comentarios: ${m.comentarios}`, m.vistas != null && `visualizaciones: ${m.vistas}`, '---',
      `# ${titulo}`, '', m.caption ? `> **Caption:** ${m.caption.replace(/\n+/g, ' ')}\n` : '', '## Transcripción', '', texto, ''].filter((x) => x !== false && x != null).join('\n');
    const nota = vault.create('04-Competencia', titulo, md);
    q.transcrita.run(texto, nota, m.id);
    alCambiar();
    return { transcripcion: texto, nota };
  }

  // La publicación de un enlace ya guardado (el de una idea): su id, o null
  const idPorEnlace = (url) => (url ? row(q.porPermalink, String(url))?.id ?? null : null);

  // La transcripción hecha fuera (con Whisper si no hay ElevenLabs), p. ej. al guardar el reel como idea
  function guardarTranscripcion(id, texto, nota = null) {
    q.transcrita.run(texto, nota, leer(id).id);
    alCambiar();
  }

  // Lo que necesita Claude para replicarla: la publicación, su transcripción (si se puede) y sus slides
  async function paraReplicar(id) {
    let m = leer(id);
    if (m.formato === 'Reels' && !m.transcripcion && m.media_url && sttConfigurado(env)) {
      try { await transcribir(id); m = leer(id); } catch { /* sin transcripción: se replica con el caption */ }
    }
    let slides = [];
    if (m.formato !== 'Reels') { try { slides = (await descargarSlides(id)).map(rutaVault); } catch { /* sin imágenes */ } }
    return { m, slides };
  }

  // Ranking para el MCP (Hermes / Claude): las mejores según una métrica
  function mejores({ orden = 'engagement', formato, usuario, limite = 10 } = {}) {
    const perfiles = rows(q.perfiles).filter((p) => p.activo && (!usuario || p.username === limpiarUsuario(usuario)));
    const l = calcular(perfiles, rows(q.media), { limite: 1000 }).publicaciones.filter((m) => !formato || m.formato === formato);
    return ordenarPor(l, orden).slice(0, Math.min(50, limite)).map((m) => ({
      id: m.id, username: m.username, fecha: m.fecha?.slice(0, 10), formato: m.formato, likes: m.likes, comentarios: m.comentarios,
      vistas: m.vistas, engagement: m.engagement, permalink: m.permalink, transcrita: Boolean(m.transcripcion), texto: (m.caption || '').slice(0, 400),
    }));
  }

  return { anadir, quitar, activar, sincronizar, porEnlace, traidas, guardarAnalisis, datosParaAnalisis, resumen, detalle, descargarSlides, rutaSlide, miniatura, transcribir, guardarTranscripcion, idPorEnlace, paraReplicar, mejores, estaSincronizando: () => sincronizando };
}

// La primera imagen de una publicación (en un carrusel, la de su primera diapositiva; si es un vídeo, su portada)
function primeraImagen(m) {
  const h = m.children?.data?.[0];
  if (h) return (h.media_type === 'VIDEO' ? h.thumbnail_url : h.media_url) || m.media_url || null;
  return m.media_url || null;
}

// Cálculos que no necesitan IA (función pura)
// Lo que necesita la lista del dashboard (sin transcripciones ni enlaces de descarga)
const ligera = (m) => ({
  id: m.id, username: m.username, formato: m.formato, gancho: m.gancho, caption: (m.caption || '').slice(0, 300), permalink: m.permalink, miniatura: m.miniatura,
  fecha: m.fecha, likes: m.likes, comentarios: m.comentarios, vistas: m.vistas ?? null, interacciones: m.interacciones, engagement: m.engagement,
  transcrita: Boolean(m.transcripcion), slides: m.hijos ? JSON.parse(m.hijos).length : null,
});

export function ordenarPor(lista, orden = 'engagement') {
  const k = ORDENES[orden] ? orden : 'engagement';
  return [...lista].sort((a, b) => (k === 'fecha' ? String(b.fecha).localeCompare(String(a.fecha)) : (b[k] ?? -1) - (a[k] ?? -1)));
}

export function calcular(perfiles, media, { limite = 400 } = {}) {
  const seg = Object.fromEntries(perfiles.map((p) => [p.username, p.seguidores || 0]));
  const de = media.filter((m) => m.username in seg);
  const publicaciones = de.map((m) => {
    const inter = (m.likes || 0) + (m.comentarios || 0);
    return { ...m, interacciones: inter, engagement: seg[m.username] ? Math.round((inter / seg[m.username]) * 1000) / 10 : null };
  }).sort((a, b) => (b.engagement ?? 0) - (a.engagement ?? 0));

  const mejoresGanchos = publicaciones.filter((m) => m.gancho).slice(0, 8)
    .map((m) => ({ id: m.id, username: m.username, gancho: m.gancho, engagement: m.engagement, interacciones: m.interacciones, formato: m.formato, permalink: m.permalink, miniatura: m.miniatura }));

  const FORMATOS = ['Reels', 'Carruseles', 'Imágenes'];
  const formatos = FORMATOS.map((f) => {
    const l = publicaciones.filter((m) => m.formato === f);
    const eng = l.filter((m) => m.engagement != null);
    return { formato: f, piezas: l.length, engagementMedio: eng.length ? Math.round((eng.reduce((a, m) => a + m.engagement, 0) / eng.length) * 10) / 10 : 0, pct: de.length ? Math.round((l.length / de.length) * 100) : 0 };
  }).filter((f) => f.piezas);

  const frecuencia = perfiles.map((p) => {
    const l = de.filter((m) => m.username === p.username).map((m) => new Date(m.fecha).getTime()).sort();
    const semanas = l.length > 1 ? (l.at(-1) - l[0]) / (7 * DIA) : 0;
    return { username: p.username, seguidores: p.seguidores, porSemana: semanas > 0 ? Math.round((l.length / semanas) * 10) / 10 : l.length };
  });

  return { publicaciones: publicaciones.slice(0, limite), mejoresGanchos, formatos, frecuencia, hayVistas: publicaciones.some((m) => m.vistas != null) };
}
