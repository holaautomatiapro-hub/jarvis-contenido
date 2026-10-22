#!/usr/bin/env node
// Conector de JARVIS para Claude Code (en tu ordenador). Con él, en cualquier chat de Claude Code puedes decir
// «súbelo a JARVIS» y los vídeos, carruseles o stories que acabas de hacer se suben a tu JARVIS (biblioteca de
// Contenido), con su caption, su día y su hora y, si quieres, para que se publiquen solos en Instagram.
//
// Es un servidor MCP por stdio, en un solo archivo y sin dependencias (Node 18 o más nuevo).
// Se instala con:  claude mcp add --scope user jarvis -e JARVIS_URL=https://tu-jarvis -- node <ruta a este archivo>
// Habla con JARVIS como tu navegador (por Tailscale): solo sube los archivos que le pidas a Claude.
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createInterface } from 'node:readline';

const VERSION = '1.0.0';
const BASE = String(process.env.JARVIS_URL || 'http://localhost:3333').replace(/\/+$/, '');
const MIMES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', gif: 'image/gif', mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', webm: 'video/webm' };
const FORMATOS = ['Reel', 'Carrusel', 'Post', 'Story', 'Short'];
const FORMATOS_VIDEO = ['Reel', 'Short'];
const log = (...a) => process.stderr.write(`[jarvis] ${a.join(' ')}\n`);

class Fallo extends Error {}

// ---------- JARVIS ----------
async function pedir(ruta, { metodo = 'GET', cuerpo, json } = {}) {
  let res;
  try {
    res = await fetch(BASE + ruta, {
      method: metodo,
      headers: json !== undefined ? { 'content-type': 'application/json' } : cuerpo ? { 'content-type': 'application/octet-stream' } : {},
      body: json !== undefined ? JSON.stringify(json) : cuerpo,
      ...(cuerpo ? { duplex: 'half' } : {}),
      signal: AbortSignal.timeout(cuerpo ? 60 * 60_000 : 60_000),
    });
  } catch (e) {
    throw new Fallo(`No llego a JARVIS en ${BASE} (${e.cause?.code || e.message}). ¿Está Tailscale conectado en este ordenador y JARVIS encendido?`);
  }
  const texto = await res.text();
  let d = {};
  try { d = texto ? JSON.parse(texto) : {}; } catch { /* sin JSON */ }
  if (!res.ok) throw new Fallo(d.error || `JARVIS respondió ${res.status}${res.status === 403 ? ' (no deja entrar: abre JARVIS en el navegador con esta misma dirección para comprobarla)' : ''}`);
  return d;
}

async function subirArchivo(ruta) {
  const abs = path.resolve(ruta);
  if (!existsSync(abs) || !statSync(abs).isFile()) throw new Fallo(`No encuentro el archivo ${abs}`);
  const ext = path.extname(abs).slice(1).toLowerCase();
  const mime = MIMES[ext];
  if (!mime) throw new Fallo(`«${path.basename(abs)}» no es una foto ni un vídeo (JPG, PNG, WebP, MP4, MOV…)`);
  const q = new URLSearchParams({ nombre: path.basename(abs), mime, jpg: '1' }); // las imágenes llegan como JPG (Instagram solo publica JPG)
  return pedir(`/api/contenido/archivos?${q}`, { metodo: 'POST', cuerpo: Readable.toWeb(createReadStream(abs)) });
}

// El día y la hora de la story n (la primera a «hora» y las demás cada «cada» minutos)
function momento(fecha, hora, n, cada) {
  if (!fecha) return {};
  if (!hora) return { fecha };
  const [a, m, d] = fecha.split('-').map(Number);
  const [h, mi] = hora.split(':').map(Number);
  const t = new Date(a, m - 1, d, h, mi + n * cada);
  return { fecha: t.toLocaleDateString('sv-SE'), hora: `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}` };
}

async function subirAJarvis(a) {
  const rutas = Array.isArray(a.archivos) ? a.archivos.filter(Boolean) : [];
  if (!rutas.length) throw new Fallo('Dime qué archivos subir (rutas de este ordenador)');
  if (rutas.length > 30) throw new Fallo('Como mucho 30 archivos de una vez');
  if (a.fecha && !/^\d{4}-\d{2}-\d{2}$/.test(a.fecha)) throw new Fallo('La fecha va como AAAA-MM-DD');
  if (a.hora && !/^\d{2}:\d{2}$/.test(a.hora)) throw new Fallo('La hora va como HH:MM');
  if (a.formato && !FORMATOS.includes(a.formato)) throw new Fallo(`El formato debe ser ${FORMATOS.join(', ')}`);
  for (const r of rutas) if (!existsSync(path.resolve(r))) throw new Fallo(`No encuentro el archivo ${path.resolve(r)}`);
  const esVideo = (r) => /^video\//.test(MIMES[path.extname(r).slice(1).toLowerCase()] || '');
  const formato = a.formato || (rutas.length > 1 ? 'Carrusel' : esVideo(rutas[0]) ? 'Reel' : 'Post');
  const titulo = String(a.titulo || path.basename(rutas[0]).replace(/\.[^.]*$/, '')).slice(0, 200);
  const estado = a.estado || 'listo';

  if (a.carpeta) await pedir('/api/contenido/carpetas', { metodo: 'POST', json: { nombre: a.carpeta } }).catch(() => {}); // si ya existe, da igual

  const subidos = [];
  for (const [i, r] of rutas.entries()) {
    log(`Subiendo ${i + 1}/${rutas.length}: ${path.basename(r)}`);
    subidos.push(await subirArchivo(r));
  }
  const portada = a.portada && FORMATOS_VIDEO.includes(formato) ? await subirArchivo(a.portada) : null;

  // Varias stories: una pieza por story (Instagram publica cada story por separado), en orden
  const separadas = formato === 'Story' && subidos.length > 1;
  const grupos = separadas ? subidos.map((s) => [s]) : [subidos];
  const creadas = [];
  const avisos = [];
  for (const [i, archivos] of grupos.entries()) {
    const p = await pedir('/api/piezas', { metodo: 'POST', json: {
      titulo: separadas ? `${titulo} · ${i + 1}/${grupos.length}` : titulo,
      formato, estado, archivos,
      ...(a.caption && formato !== 'Story' ? { caption: a.caption } : {}),
      ...(a.carpeta ? { carpeta: a.carpeta } : {}),
      ...(portada ? { portada } : {}),
      ...momento(a.fecha, a.hora, i, Number(a.minutos_entre_stories) || 0),
    } });
    creadas.push(p);
    if (a.publicar_en_instagram) {
      try { await pedir(`/api/piezas/${p.id}`, { metodo: 'PATCH', json: { publicar_ig: true } }); }
      catch (e) { avisos.push(`«${p.titulo}» se ha subido, pero no quedará para publicarse sola en Instagram: ${e.message}`); }
    }
  }
  const primera = creadas[0];
  const cuando = primera.fecha ? `${primera.fecha}${primera.hora ? ` a las ${primera.hora}` : ''}${separadas && creadas.at(-1).hora !== primera.hora ? ` (la última a las ${creadas.at(-1).hora})` : ''}` : null;
  const igOk = a.publicar_en_instagram && avisos.length < creadas.length;
  return [
    separadas ? `Subidas a JARVIS ${creadas.length} stories «${titulo}».` : `Subido a JARVIS: «${primera.titulo}» (${formato}, ${subidos.length} ${subidos.length === 1 ? 'archivo' : 'archivos'}${portada ? ' y su portada' : ''}).`,
    cuando ? `En el calendario el ${cuando}.` : 'Sin fecha: está en la biblioteca de Contenido para programarlo cuando quieras.',
    igOk ? 'Se publicará sola en Instagram a esa hora (JARVIS tiene que estar encendido).' : null,
    ...avisos,
    `Ábrelo en ${BASE}/#contenido (ids: ${creadas.map((p) => p.id).join(', ')}).`,
  ].filter(Boolean).join('\n');
}

async function verCalendario({ desde, dias = 7 } = {}) {
  const hoy = new Date().toLocaleDateString('sv-SE');
  const d0 = desde && /^\d{4}-\d{2}-\d{2}$/.test(desde) ? desde : hoy;
  const n = Math.max(1, Math.min(60, Number(dias) || 7));
  const fin = new Date(`${d0}T12:00:00`); fin.setDate(fin.getDate() + n - 1);
  const d1 = fin.toLocaleDateString('sv-SE');
  const c = await pedir('/api/contenido');
  const piezas = c.piezas.filter((p) => p.fecha && p.fecha >= d0 && p.fecha <= d1)
    .sort((x, y) => `${x.fecha} ${x.hora || ''}`.localeCompare(`${y.fecha} ${y.hora || ''}`))
    .map((p) => ({ id: p.id, fecha: p.fecha, hora: p.hora || null, titulo: p.titulo, formato: p.formato, estado: p.estado, archivos: p.archivos.length, instagram: p.ig_estado || (p.publicar_ig ? 'programada' : null) }));
  let toca = null;
  try { toca = await pedir(`/api/estrategia/plan?desde=${d0}&dias=${n}`); } catch { /* sin estrategia */ }
  return JSON.stringify({ desde: d0, hasta: d1, piezas, que_toca_segun_tu_estrategia: toca, carpetas: (c.carpetas || []).map((x) => x.nombre) }, null, 1);
}

// ---------- MCP (JSON-RPC por stdio, una línea por mensaje) ----------
const TOOLS = [
  {
    name: 'subir_a_jarvis',
    description: 'Sube a JARVIS (la biblioteca de Contenido del dashboard de la persona) fotos y vídeos de ESTE ordenador: un reel, un carrusel (las imágenes en orden), un post o stories. Úsalo cuando la persona diga «súbelo a JARVIS» o similar, con las rutas de lo que acabas de hacer. Puede ponerle caption, día y hora, carpeta, portada (reel) y dejarlo para que se publique solo en Instagram. Varias stories se suben como una story cada una, en orden.',
    inputSchema: {
      type: 'object',
      properties: {
        archivos: { type: 'array', items: { type: 'string' }, description: 'Rutas de los archivos en este ordenador, en orden (las slides de un carrusel o las stories en el orden en que salen)' },
        titulo: { type: 'string', description: 'Título de la pieza (de qué va)' },
        formato: { type: 'string', enum: FORMATOS, description: 'Si no se dice: un vídeo → Reel; varias imágenes → Carrusel; una imagen → Post' },
        caption: { type: 'string', description: 'El texto de la publicación (no aplica a stories)' },
        fecha: { type: 'string', description: 'Día de publicación, AAAA-MM-DD (sin fecha queda en la biblioteca)' },
        hora: { type: 'string', description: 'Hora, HH:MM (hace falta para publicar sola en Instagram)' },
        carpeta: { type: 'string', description: 'Carpeta de la biblioteca (se crea si no existe)' },
        portada: { type: 'string', description: 'Ruta de la imagen de portada de un reel' },
        publicar_en_instagram: { type: 'boolean', description: 'Que JARVIS lo publique solo en Instagram el día y la hora indicados. Solo si la persona lo pide.' },
        minutos_entre_stories: { type: 'number', description: 'Varias stories: minutos entre una y otra (0 = todas seguidas, en orden)' },
        estado: { type: 'string', description: 'Fase del pipeline (por defecto «listo»)' },
      },
      required: ['archivos'],
    },
  },
  {
    name: 'ver_calendario_jarvis',
    description: 'Lo que la persona tiene en su calendario de JARVIS entre unas fechas (piezas con día, formato, estado y si se publican solas en Instagram), lo que le toca publicar según su estrategia y sus carpetas.',
    inputSchema: { type: 'object', properties: { desde: { type: 'string', description: 'AAAA-MM-DD (por defecto, hoy)' }, dias: { type: 'number', description: 'Cuántos días (por defecto 7)' } } },
  },
];
const HACER = { subir_a_jarvis: subirAJarvis, ver_calendario_jarvis: verCalendario };

const enviar = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);
async function atender(m) {
  const { id, method, params } = m;
  const responder = (result) => id !== undefined && enviar({ jsonrpc: '2.0', id, result });
  if (method === 'initialize') return responder({ protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'jarvis', version: VERSION } });
  if (method === 'ping') return responder({});
  if (method === 'tools/list') return responder({ tools: TOOLS });
  if (method === 'tools/call') {
    const fn = HACER[params?.name];
    if (!fn) return responder({ content: [{ type: 'text', text: `No conozco la herramienta ${params?.name}` }], isError: true });
    try { return responder({ content: [{ type: 'text', text: await fn(params.arguments || {}) }] }); }
    catch (e) { log(e.stack || e.message); return responder({ content: [{ type: 'text', text: e instanceof Fallo ? e.message : `Algo ha fallado: ${e.message}` }], isError: true }); }
  }
  if (method?.startsWith('notifications/') || id === undefined) return undefined;
  return enviar({ jsonrpc: '2.0', id, error: { code: -32601, message: `Método no soportado: ${method}` } });
}

createInterface({ input: process.stdin }).on('line', (linea) => {
  if (!linea.trim()) return;
  let m;
  try { m = JSON.parse(linea); } catch { return; }
  Promise.resolve(atender(m)).catch((e) => log(e.stack || e.message));
});
log(`Conector de JARVIS ${VERSION} listo (${BASE})`);
