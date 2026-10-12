import path from 'node:path';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { ROOT } from './config.js';
import { guardarEnv } from './env-archivo.js';

// Lead magnets: páginas web interactivas (no PDF) que Claude hace con la guía del sistema de diseño de la
// persona (_diseno/, sección «Lead magnets», y su plantilla HTML) y que JARVIS publica en Vercel.
// Viven en la carpeta del Laboratorio:
//   leadmagnets/<slug>/index.html       la página (un solo archivo: CSS, JS e imágenes dentro)
//   leadmagnets/<slug>/leadmagnet.json  título, tipo, palabra clave, enlace publicado y pieza
//   leadmagnets/<slug>/captura.png      la portada a 375 px (la saca laboratorio/captura.mjs)
//   leadmagnets/_comun/                 banners de las comunidades (Skool, WhatsApp), se suben una vez
// En Vercel van todos juntos en un proyecto (VERCEL_PROYECTO): https://<proyecto>.vercel.app/<slug>

export class LeadMagnetError extends Error {
  constructor(m) { super(m); this.publico = true; }
}

export const TIPOS_LM = {
  guia: 'Guía paso a paso',
  checklist: 'Checklist para marcar',
  test: 'Test con resultado',
  generador: 'Generador (rellenas y te da tu texto o prompt)',
  recursos: 'Pack de recursos o plantillas',
  calculadora: 'Calculadora',
};
export const BANNERS = { skool: 'Banner de Skool', whatsapp: 'Banner de WhatsApp' };
const IMAGEN = /\.(jpe?g|png|webp)$/i;
const MAX_HTML = 15 * 1024 ** 2;
const API = 'https://api.vercel.com';

export const slugLm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
// Nombre de proyecto válido en Vercel: minúsculas, números y guiones, hasta 100
export const proyectoVercel = (s) => slugLm(s).slice(0, 100) || 'leadmagnets';

export function createLeadMagnets({ base, vaultPath = null, jarvis = null, env = process.env, fetchImpl = (...a) => fetch(...a), guardarClaves = guardarEnv, esperaMs = 2000, log = () => {} }) {
  const raiz = path.join(path.resolve(base), 'leadmagnets');
  const comun = path.join(raiz, '_comun');
  const capturaScript = path.join(ROOT, 'laboratorio', 'captura.mjs');

  const carpeta = (slug) => {
    if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(String(slug || ''))) throw new LeadMagnetError('Lead magnet no válido');
    return path.join(raiz, slug);
  };
  const leerMeta = (slug) => { const c = carpeta(slug); try { return JSON.parse(readFileSync(path.join(c, 'leadmagnet.json'), 'utf8')); } catch { return null; } };
  const guardarMeta = (slug, m) => writeFileSync(path.join(carpeta(slug), 'leadmagnet.json'), JSON.stringify(m, null, 2));

  // ---------- Vercel ----------
  const vercel = () => ({
    token: env.VERCEL_TOKEN || '',
    equipo: env.VERCEL_TEAM_ID || '',
    proyecto: proyectoVercel(env.VERCEL_PROYECTO || 'leadmagnets'),
    dominio: String(env.VERCEL_DOMINIO || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, ''),
  });
  const conEquipo = (url, equipo) => (equipo ? `${url}${url.includes('?') ? '&' : '?'}teamId=${encodeURIComponent(equipo)}` : url);

  async function llamar(ruta, { metodo = 'GET', cuerpo, cabeceras = {}, token, equipo } = {}) {
    let r;
    try {
      r = await fetchImpl(conEquipo(`${API}${ruta}`, equipo), {
        method: metodo,
        headers: { Authorization: `Bearer ${token}`, ...(cuerpo && !Buffer.isBuffer(cuerpo) ? { 'Content-Type': 'application/json' } : {}), ...cabeceras },
        body: cuerpo == null ? undefined : Buffer.isBuffer(cuerpo) ? cuerpo : JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (e) { throw new LeadMagnetError(`No he podido conectar con Vercel (${e.message})`); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (r.status === 401 || r.status === 403) throw new LeadMagnetError(`Vercel no acepta el token${d.error?.message ? ` (${d.error.message})` : ''}. Crea otro en vercel.com/account/tokens y guárdalo en Lead magnets → Vercel.`);
      throw new LeadMagnetError(`Vercel: ${d.error?.message || `error ${r.status}`}`);
    }
    return d;
  }

  function estadoVercel() {
    const v = vercel();
    return { conectado: Boolean(v.token), proyecto: v.proyecto, equipo: v.equipo || null, dominio: v.dominio || null, final: v.token ? `••••${v.token.slice(-4)}` : null };
  }

  // Guarda el token (y el equipo/proyecto) en el .env después de comprobar que Vercel lo acepta
  async function conectarVercel({ token, equipo, proyecto, dominio } = {}) {
    const t = String(token || '').trim() || vercel().token;
    if (!t) throw new LeadMagnetError('Pega tu token de Vercel');
    if (!/^[A-Za-z0-9_-]{16,}$/.test(t)) throw new LeadMagnetError('Ese token no parece de Vercel (son letras y números, sin espacios)');
    const eq = equipo == null ? vercel().equipo : String(equipo).trim();
    if (eq && !/^team_[A-Za-z0-9]+$/.test(eq)) throw new LeadMagnetError('El ID del equipo empieza por team_ (o déjalo vacío para tu cuenta personal)');
    const usuario = await llamar('/v2/user', { token: t, equipo: eq });
    const cambios = { VERCEL_TOKEN: t, VERCEL_TEAM_ID: eq };
    if (proyecto != null && String(proyecto).trim()) cambios.VERCEL_PROYECTO = proyectoVercel(proyecto);
    if (dominio != null) cambios.VERCEL_DOMINIO = String(dominio).trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
    guardarClaves(cambios);
    Object.assign(env, cambios);
    return { ...estadoVercel(), usuario: usuario.user?.username || usuario.user?.email || null };
  }

  const sha1 = (b) => createHash('sha1').update(b).digest('hex');

  // La plantilla del kit es un trozo de HTML (para compartir como página). En una web propia hace falta el
  // documento completo: si falta, se completa al publicar (doctype, idioma, charset y viewport del móvil).
  const completarDocumento = (buf) => {
    let h = buf.toString('utf8');
    if (!/<meta[^>]+name=["']?viewport/i.test(h)) {
      const meta = '<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n';
      h = /<head[^>]*>/i.test(h) ? h.replace(/<head[^>]*>/i, (m) => `${m}\n${meta}`) : `${meta}${h}`;
    }
    if (!/^\s*<!doctype/i.test(h)) h = `<!doctype html>\n${/<html[\s>]/i.test(h) ? h : `<html lang="es">\n${h}\n</html>`}`;
    return Buffer.from(h, 'utf8');
  };

  // Despliega TODOS los lead magnets publicados (más los indicados) en producción: un despliegue sustituye
  // al anterior, así que el que no va en la lista deja de estar en internet.
  async function desplegar(slugs) {
    const v = vercel();
    if (!v.token) throw new LeadMagnetError('Conecta Vercel primero (Lead magnets → Vercel): JARVIS necesita tu token para publicar.');
    const archivos = [];
    for (const s of slugs) {
      archivos.push({ file: `${s}/index.html`, datos: completarDocumento(readFileSync(path.join(carpeta(s), 'index.html'))) });
    }
    archivos.push({ file: 'vercel.json', datos: Buffer.from(JSON.stringify({ cleanUrls: true, trailingSlash: false })) });
    archivos.push({ file: 'index.html', datos: Buffer.from('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Recursos</title><style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;color:#2c2d31;background:#e9ebee}</style><p>Nada por aquí 👀</p>') });
    for (const a of archivos) {
      a.sha = sha1(a.datos);
      await llamar('/v2/files', { metodo: 'POST', cuerpo: a.datos, token: v.token, equipo: v.equipo, cabeceras: { 'Content-Type': 'application/octet-stream', 'x-vercel-digest': a.sha } });
    }
    let d = await llamar('/v13/deployments?skipAutoDetectionConfirmation=1', {
      metodo: 'POST', token: v.token, equipo: v.equipo,
      cuerpo: {
        name: v.proyecto, target: 'production',
        files: archivos.map((a) => ({ file: a.file, sha: a.sha, size: a.datos.length })),
        projectSettings: { framework: null, buildCommand: null, installCommand: null, outputDirectory: null, devCommand: null },
      },
    });
    for (let i = 0; i < 90 && !['READY', 'ERROR', 'CANCELED'].includes(d.readyState); i++) {
      await new Promise((ok) => setTimeout(ok, esperaMs));
      d = await llamar(`/v13/deployments/${encodeURIComponent(d.id)}`, { token: v.token, equipo: v.equipo });
    }
    if (d.readyState !== 'READY') throw new LeadMagnetError(d.readyState === 'ERROR' ? `Vercel no ha podido publicar${d.errorMessage ? `: ${d.errorMessage}` : ''}` : 'Vercel está tardando demasiado: mira el despliegue en vercel.com y vuelve a probar en un rato');
    // La dirección pública: el dominio propio si lo hay; si no, el de producción del proyecto (no el del
    // despliegue, que Vercel puede proteger con contraseña)
    let host = v.dominio;
    if (!host) {
      try {
        const dom = await llamar(`/v9/projects/${encodeURIComponent(v.proyecto)}/domains`, { token: v.token, equipo: v.equipo });
        const l = (dom.domains || []).filter((x) => x.verified !== false && !x.redirect);
        host = (l.find((x) => !x.name.endsWith('.vercel.app')) || l[0])?.name;
      } catch (e) { log(`No he podido leer los dominios de Vercel: ${e.message}`); }
    }
    host ||= (d.alias || []).find((a) => a.endsWith('.vercel.app') && !a.includes(d.id)) || `${v.proyecto}.vercel.app`;
    return { host, id: d.id };
  }

  // ---------- Lista ----------
  function lista() {
    if (!existsSync(raiz)) return [];
    return readdirSync(raiz, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^[a-z0-9][a-z0-9-]*$/.test(e.name))
      .map((e) => {
        const m = leerMeta(e.name) || {};
        const html = path.join(raiz, e.name, 'index.html');
        const hay = existsSync(html);
        const st = hay ? statSync(html) : null;
        return {
          slug: e.name, titulo: m.titulo || e.name, tipo: m.tipo || null, palabra: m.palabra || null, creado: m.creado || null,
          listo: hay, tamano: st?.size || 0, mod: st?.mtime.toISOString() || m.creado || '',
          html: hay ? `leadmagnets/${e.name}/index.html` : null,
          captura: existsSync(path.join(raiz, e.name, 'captura.png')) ? `leadmagnets/${e.name}/captura.png` : null,
          url: m.publicado?.url || null, publicado: m.publicado?.fecha || null,
          cambiado: Boolean(m.publicado?.fecha && st && st.mtime.toISOString() > m.publicado.fecha),
          pieza: m.pieza || null,
        };
      })
      .sort((a, b) => String(b.mod).localeCompare(String(a.mod)));
  }

  const banners = () => {
    const out = {};
    for (const k of Object.keys(BANNERS)) {
      const f = existsSync(comun) ? readdirSync(comun).find((n) => n.startsWith(`${k}.`) && IMAGEN.test(n)) : null;
      out[k] = f ? `leadmagnets/_comun/${f}` : null;
    }
    return out;
  };

  function estado() {
    return { leadmagnets: lista(), banners: banners(), vercel: estadoVercel(), tipos: TIPOS_LM, kit: Boolean(guia()) };
  }

  // ---------- Banners de las comunidades ----------
  async function subirBanner(stream, { cual, nombre }) {
    if (!BANNERS[cual]) throw new LeadMagnetError('Banner no válido');
    if (!IMAGEN.test(String(nombre || ''))) throw new LeadMagnetError('Sube el banner en jpg, png o webp');
    mkdirSync(comun, { recursive: true });
    for (const n of readdirSync(comun)) if (n.startsWith(`${cual}.`)) rmSync(path.join(comun, n), { force: true });
    const destino = path.join(comun, `${cual}.${String(nombre).split('.').pop().toLowerCase().replace('jpeg', 'jpg')}`);
    let tamano = 0;
    await pipeline(stream, async function* (fuente) {
      for await (const t of fuente) { tamano += t.length; if (tamano > 10 * 1024 ** 2) throw new LeadMagnetError('El banner pesa más de 10 MB'); yield t; }
    }, createWriteStream(destino)).catch((e) => { rmSync(destino, { force: true }); throw e instanceof LeadMagnetError ? e : new LeadMagnetError('No se pudo guardar el banner'); });
    return banners();
  }

  // ---------- Crear (lo hace Claude) ----------
  // La guía y la plantilla del sistema de diseño de la persona (si las tiene)
  function guia() {
    if (!vaultPath) return null;
    const kit = path.join(path.resolve(vaultPath), '_diseno');
    let k;
    try { k = JSON.parse(readFileSync(path.join(kit, 'kit.json'), 'utf8')); } catch { return null; }
    const g = path.join(kit, k.guia || 'CLAUDE.md');
    const ref = path.join(kit, 'referencias');
    const plantilla = existsSync(ref) ? readdirSync(ref).find((n) => /lead.?magnet.*\.html?$/i.test(n)) : null;
    return { guia: existsSync(g) ? g : null, plantilla: plantilla ? path.join(ref, plantilla) : null, nombre: k.nombre || null, handle: k.handle || null };
  }

  function nuevo(d = {}) {
    const titulo = String(d.titulo || '').trim().slice(0, 120);
    if (!titulo) throw new LeadMagnetError('Escribe de qué va el lead magnet');
    const tipo = TIPOS_LM[d.tipo] ? d.tipo : 'guia';
    const palabra = String(d.palabra || '').trim().toUpperCase().replace(/[^A-ZÁÉÍÓÚÜÑ0-9]/g, '').slice(0, 30) || null;
    let slug = String(d.slug || '').trim() && leerMeta(String(d.slug)) ? String(d.slug) : null; // rehacer uno que ya existe
    const rehacer = Boolean(slug);
    if (!slug) {
      const b = slugLm(titulo) || 'lead-magnet';
      slug = b;
      for (let i = 2; existsSync(path.join(raiz, slug)); i++) slug = `${b}-${i}`.slice(0, 60);
    }
    mkdirSync(carpeta(slug), { recursive: true });
    const previa = leerMeta(slug) || {};
    guardarMeta(slug, { ...previa, titulo, tipo, palabra, creado: previa.creado || new Date().toISOString(), ...(d.pieza ? { pieza: Number(d.pieza) } : {}) });

    const g = guia();
    const b = banners();
    const pieza = d.pieza && jarvis ? (() => { try { return jarvis.listarPiezas().find((p) => p.id === Number(d.pieza)); } catch { return null; } })() : null;
    const rel = `leadmagnets/${slug}`;
    const linea = (k, v) => (v ? `${k}: ${v}\n` : '');
    return {
      slug,
      prompt: `${rehacer ? 'Rehaz' : 'Crea'} un LEAD MAGNET: una página web interactiva (no un PDF) que se usa desde el móvil.
Tema: ${titulo}
Tipo: ${TIPOS_LM[tipo]}
${linea('Palabra clave que comentan para recibirlo', palabra)}${pieza ? `Va con esta pieza de contenido: «${pieza.titulo}» (${pieza.formato || 'pieza'}). ${pieza.nota ? `Su guion está en la nota ${pieza.nota} (léela con leer_nota). ` : ''}${pieza.caption ? `Caption:\n"""\n${String(pieza.caption).slice(0, 2000)}\n"""\n` : ''}` : ''}${d.nota ? `Material de base: la nota ${String(d.nota).slice(0, 300)} del vault (léela con leer_nota).\n` : ''}${d.contenido ? `Contenido de base:\n"""\n${String(d.contenido).slice(0, 12000)}\n"""\n` : ''}${linea('Indicaciones', d.indicaciones && String(d.indicaciones).slice(0, 2000))}${rehacer && existsSync(path.join(carpeta(slug), 'index.html')) ? `La versión actual está en ${rel}/index.html: léela y cámbiala según las indicaciones (sin empezar de cero si no hace falta).\n` : ''}
Cómo hacerlo:
1. ${g?.guia ? `Lee la guía de mi sistema de diseño (${g.guia}): la sección de Lead magnets entera (colores, tipografía, estructura, componentes, reglas técnicas) y las reglas generales (idioma, datos reales, palabra clave, comunidades).` : 'No tengo sistema de diseño importado: usa un diseño limpio, móvil primero, con mi nombre y mi tono (lee CLAUDE.md y _voz.md del vault).'}${g?.plantilla ? `\n2. Parte de la plantilla ${g.plantilla}: copia su HTML, su CSS y su JS (casillas con progreso guardado, botones de copiar, pestañas, acordeón) y cambia el contenido. No inventes otro estilo.` : '\n2. Hazlo en un solo archivo HTML con el CSS y el JS dentro.'}
3. Escribe el contenido con MI voz (lee _voz.md y CLAUDE.md del vault; busca con buscar_notas material mío sobre el tema). Útil de verdad y accionable, sin relleno. Nada de datos inventados: si un ejemplo es ilustrativo, que se note.
4. Banners de las comunidades (los marcadores {{SKOOL}} y {{WA}} de la plantilla): ${b.skool || b.whatsapp ? `${[b.skool ? `Skool → ${b.skool}` : null, b.whatsapp ? `WhatsApp → ${b.whatsapp}` : null].filter(Boolean).join(', ')}. Mételos dentro del HTML en base64 (data:image/…;base64,…) con python. ` : ''}${!b.skool || !b.whatsapp ? `${b.skool || b.whatsapp ? 'El que falte' : 'No hay banners subidos'}: quita su <figure> y deja el resto del bloque.` : ''}
5. Guarda la página en ${rel}/index.html (relativo a la carpeta de trabajo). Es la versión para web propia: documento completo con <!doctype html>, <html lang="es">, <meta charset="utf-8"> y <meta name="viewport" content="width=device-width, initial-scale=1">, y un <title> con el tema. Un solo archivo con todo dentro (las fuentes, de Google Fonts). Sin vídeos de YouTube incrustados ni descargas forzadas. Todo localStorage dentro de try/catch.
6. Compruébala en móvil: node "${capturaScript}" ${rel}/index.html  → saca capturas a 375 px en ${rel}/_capturas/ y dice si algo se sale por los lados o si hay errores de JavaScript. Mira las capturas con Read, corrige lo que esté mal (textos que se pisan, desbordes, contraste) y repite hasta que esté bien.
7. Termina con un resumen corto: qué lleva la página, la palabra clave y un caption para anunciarlo (con «Comenta **${palabra || 'PALABRA'}** y te lo envío», con **negrita** así para la palabra). No lo publiques: se publica desde el Laboratorio.`,
    };
  }

  // ---------- Publicar, quitar, asignar, borrar ----------
  async function publicar(slug) {
    const m = leerMeta(slug);
    if (!m) throw new LeadMagnetError('Ese lead magnet ya no está');
    const html = path.join(carpeta(slug), 'index.html');
    if (!existsSync(html)) throw new LeadMagnetError('Este lead magnet todavía no tiene página: pídeselo a JARVIS primero');
    const st = statSync(html);
    if (st.size > MAX_HTML) throw new LeadMagnetError('La página pesa más de 15 MB: pídele a JARVIS que reduzca las imágenes');
    if (/\{\{(SKOOL|WA)\}\}/.test(readFileSync(html, 'utf8'))) throw new LeadMagnetError('La página aún tiene {{SKOOL}} o {{WA}} sin cambiar: sube los banners o pídele a JARVIS que quite esos bloques');
    const publicados = lista().filter((l) => l.url && l.listo && l.slug !== slug).map((l) => l.slug);
    const { host } = await desplegar([...publicados, slug]);
    const fecha = new Date().toISOString();
    for (const s of publicados) { const mm = leerMeta(s); if (mm?.publicado) guardarMeta(s, { ...mm, publicado: { ...mm.publicado, url: `https://${host}/${s}` } }); }
    const url = `https://${host}/${slug}`;
    guardarMeta(slug, { ...m, publicado: { url, fecha } });
    if (m.pieza && jarvis) { try { jarvis.actualizarPieza(m.pieza, { leadmagnet: true, leadmagnet_url: url }); } catch (e) { log(`No he podido poner el enlace en la pieza ${m.pieza}: ${e.message}`); } }
    return { url, leadmagnets: lista() };
  }

  // Quita de una pieza el enlace de este lead magnet (solo si es el suyo: un enlace puesto a mano no se toca).
  // soltar: la pieza deja de llevar lead magnet; si no, lo sigue llevando pero «sin enlace».
  function quitarDePieza(m, { soltar = false } = {}) {
    if (!m?.pieza || !jarvis) return;
    try {
      const p = jarvis.leerPieza(m.pieza);
      const suyo = Boolean(m.publicado?.url) && p.leadmagnet_url === m.publicado.url;
      if (soltar && (suyo || !p.leadmagnet_url)) jarvis.actualizarPieza(p.id, { leadmagnet: false });
      else if (suyo) jarvis.actualizarPieza(p.id, { leadmagnet_url: null });
    } catch (e) { log(`No he podido quitar el enlace de la pieza ${m.pieza}: ${e.message}`); }
  }

  async function despublicar(slug) {
    const m = leerMeta(slug);
    if (!m?.publicado) return { leadmagnets: lista() };
    const quedan = lista().filter((l) => l.url && l.listo && l.slug !== slug).map((l) => l.slug);
    await desplegar(quedan);
    quitarDePieza(m);
    const { publicado, ...resto } = m;
    guardarMeta(slug, resto);
    return { leadmagnets: lista() };
  }

  function asignar(slug, piezaId) {
    const m = leerMeta(slug);
    if (!m) throw new LeadMagnetError('Ese lead magnet ya no está');
    const id = piezaId ? Number(piezaId) : null;
    if (m.pieza && m.pieza !== id) quitarDePieza(m, { soltar: true });
    if (id && jarvis) jarvis.actualizarPieza(id, m.publicado?.url ? { leadmagnet: true, leadmagnet_url: m.publicado.url } : { leadmagnet: true });
    guardarMeta(slug, { ...m, pieza: id });
    return { leadmagnets: lista() };
  }

  async function borrar(slug) {
    const m = leerMeta(slug);
    quitarDePieza(m, { soltar: true });
    if (m?.publicado) await despublicar(slug);
    rmSync(carpeta(slug), { recursive: true, force: true });
    return { leadmagnets: lista() };
  }

  return { estado, lista, nuevo, publicar, despublicar, asignar, borrar, subirBanner, conectarVercel, estadoVercel, banners, guia };
}
