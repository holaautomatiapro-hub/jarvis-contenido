import { ajustes, row, rows } from '../db.js';
import { createGraph, MetaError } from './meta.js';
import { formatoDe, primeraFrase } from './instagram.js';
import { demoCompetencia } from './competencia-demo.js';

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

export function createCompetencia({ db, instagram, vault, env = process.env, fetchImpl = fetch, alCambiar = () => {} }) {
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
    upMedia: db.prepare(`INSERT INTO comp_media (id, username, formato, caption, permalink, miniatura, fecha, likes, comentarios, gancho)
      VALUES (@id, @username, @formato, @caption, @permalink, @miniatura, @fecha, @likes, @comentarios, @gancho)
      ON CONFLICT(id) DO UPDATE SET likes = excluded.likes, comentarios = excluded.comentarios, miniatura = COALESCE(excluded.miniatura, miniatura), caption = excluded.caption`),
    media: db.prepare('SELECT * FROM comp_media ORDER BY fecha DESC'),
    insAnalisis: db.prepare('INSERT INTO comp_analisis (perfiles, datos, nota) VALUES (?, ?, ?)'),
    ultimoAnalisis: db.prepare('SELECT * FROM comp_analisis ORDER BY id DESC LIMIT 1'),
  };

  // Competidores iniciales desde .env (COMPETIDORES=marcauno,marcados) la primera vez
  if (!rows(q.perfiles).length && !aj.leer('comp_sembrado')) {
    for (const u of String(env.COMPETIDORES || '').split(',').map(limpiarUsuario).filter((x) => USUARIO_OK.test(x))) q.insPerfil.run(u);
    aj.guardar('comp_sembrado', true);
  }

  let sincronizando = false;

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
          const campos = `business_discovery.username(${p.username}){username,name,biography,followers_count,media_count,profile_picture_url,media.limit(${Number(env.COMP_MAX_PUBLICACIONES) || 50}){id,caption,like_count,comments_count,media_type,media_product_type,permalink,timestamp,thumbnail_url,media_url}}`;
          const r = await g.get(c.igUserId, { fields: campos });
          const bd = r.business_discovery || {};
          q.actPerfil.run(bd.name || null, bd.biography || null, bd.followers_count ?? null, bd.media_count ?? null, bd.profile_picture_url || null, p.username);
          for (const m of bd.media?.data || []) {
            q.upMedia.run({
              id: m.id, username: p.username, formato: formatoDe(m), caption: m.caption || null, permalink: m.permalink || null,
              miniatura: m.thumbnail_url || (m.media_type === 'IMAGE' ? m.media_url : null) || null,
              fecha: m.timestamp, likes: m.like_count ?? null, comentarios: m.comments_count ?? null, gancho: primeraFrase(m.caption),
            });
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
    return {
      ...base, demo: false, ...calcular(activos, rows(q.media)),
      analisis: ultimo ? { ...JSON.parse(ultimo.datos), fecha: ultimo.ts, perfiles: JSON.parse(ultimo.perfiles), nota: ultimo.nota } : null,
    };
  }

  return { anadir, quitar, activar, sincronizar, guardarAnalisis, datosParaAnalisis, resumen, estaSincronizando: () => sincronizando };
}

// Cálculos que no necesitan IA (función pura)
export function calcular(perfiles, media) {
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

  return { publicaciones: publicaciones.slice(0, 100), mejoresGanchos, formatos, frecuencia };
}
