import path from 'node:path';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { ROOT } from './config.js';

// Imágenes y vídeo con Higgsfield: imágenes para los diseños, fotos con tu cara (tu personaje Soul),
// B-roll y animar una imagen. Lo hace Claude en el Laboratorio con el conector (MCP) de Higgsfield de tu
// cuenta: gasta los créditos de tu plan. Se conecta una vez en el servidor:
//   claude mcp add --transport http --scope user higgsfield https://mcp.higgsfield.ai/mcp
//   claude mcp login higgsfield --no-browser
// En la carpeta del Laboratorio:
//   imagenes/<encargo>/        lo que se genera (jpg, png, mp4) y _encargo.md
//   imagenes/_referencias/     fotos o vídeos de referencia que subes
//   imagenes/_mi-cara/         tus fotos para entrenar tu personaje y personaje.json (su soul_id)

export class ImagenesError extends Error {
  constructor(m) { super(m); this.publico = true; }
}

export const URL_HIGGSFIELD = 'https://mcp.higgsfield.ai/mcp';
export const TIPOS_IMAGEN = {
  imagen: 'Imagen (para un diseño, una portada, un fondo…)',
  conmigo: 'Foto contigo (con tu cara)',
  broll: 'B-roll (vídeo corto)',
  animar: 'Animar una imagen (de foto a vídeo)',
};
export const FORMATOS_IMAGEN = { '9:16': 'Vertical 9:16 (reel, story)', '4:5': 'Feed 4:5 (carrusel)', '1:1': 'Cuadrado 1:1', '16:9': 'Horizontal 16:9' };
const MEDIO = /\.(jpe?g|png|webp|mp4|mov|webm)$/i;
const VIDEO = /\.(mp4|mov|webm)$/i;

const slug = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50).replace(/-+$/, '');

// Lee la salida de `claude mcp get higgsfield`:
//   No MCP server named "higgsfield"…            → sin añadir
//   Status: ✓ Connected | ⚠ Needs authentication | × Failed to connect (Issue: …)
export function estadoDeSalida(ok, salida) {
  const t = String(salida || '');
  if (/No MCP server named/i.test(t)) return { anadido: false, conectado: false, estado: 'sin-anadir' };
  const linea = t.split('\n').find((l) => /^\s*Status:/i.test(l)) || '';
  const detalle = (t.split('\n').find((l) => /^\s*Issue:/i.test(l)) || '').replace(/^\s*Issue:\s*/i, '').slice(0, 200) || null;
  if (!linea) return ok && /higgsfield/i.test(t) ? { anadido: true, conectado: false, estado: 'desconocido', detalle } : { anadido: false, conectado: false, estado: 'desconocido', detalle: t.trim().split('\n')[0]?.slice(0, 200) || null };
  if (/needs auth|authenticat|login/i.test(linea)) return { anadido: true, conectado: false, estado: 'falta-login', detalle };
  if (/fail|error|×|✗/i.test(linea)) return { anadido: true, conectado: false, estado: 'fallo', detalle };
  if (/✓|connected/i.test(linea)) return { anadido: true, conectado: true, estado: 'conectado' };
  return { anadido: true, conectado: false, estado: 'desconocido', detalle };
}

export function createImagenes({ base, jarvis = null, bin = process.env.JARVIS_CLAUDE_BIN || 'claude', ejecutarComando = null, cacheMs = 60_000, env = process.env }) {
  const raiz = path.join(path.resolve(base), 'imagenes');
  const referencias = path.join(raiz, '_referencias');
  const cara = path.join(raiz, '_mi-cara');
  const ayudante = path.join(ROOT, 'laboratorio', 'higgsfield.mjs');

  const correr = ejecutarComando || ((args) => new Promise((resolve) => {
    execFile(bin, args, { timeout: 45_000, windowsHide: true, shell: process.platform === 'win32', env: { ...process.env, ...env } }, (err, out, errOut) => resolve({ ok: !err, salida: `${out || ''}\n${errOut || ''}` }));
  }));

  // ---------- El conector ----------
  let cache = null;
  async function conector({ fresco = false } = {}) {
    if (!fresco && cache && Date.now() - cache.t < cacheMs) return cache.v;
    const r = await correr(['mcp', 'get', 'higgsfield']);
    const v = { ...estadoDeSalida(r.ok, r.salida), url: URL_HIGGSFIELD };
    cache = { t: Date.now(), v };
    return v;
  }
  async function anadirConector() {
    const actual = await conector({ fresco: true });
    if (!actual.anadido) {
      const r = await correr(['mcp', 'add', '--transport', 'http', '--scope', 'user', 'higgsfield', URL_HIGGSFIELD]);
      if (!r.ok) throw new ImagenesError(`No he podido añadir el conector de Higgsfield: ${r.salida.trim().split('\n')[0]?.slice(0, 200) || 'error'}`);
    }
    return conector({ fresco: true });
  }

  // ---------- Tu cara (personaje Soul) ----------
  function personaje() {
    try {
      const p = JSON.parse(readFileSync(path.join(cara, 'personaje.json'), 'utf8'));
      // Tres maneras de tener tu cara en Higgsfield: un personaje entrenado (Soul), un Elemento o tus fotos subidas
      const tipo = p.element_id ? 'elemento' : p.soul_id ? 'soul' : Array.isArray(p.media_ids) && p.media_ids.length ? 'fotos' : null;
      if (!tipo) return null;
      return {
        tipo, nombre: p.nombre || null, estado: p.estado || 'listo', fecha: p.fecha || null,
        soul_id: p.soul_id || null, soul_tipo: ['soul_2', 'soul_cinematic', 'soul'].includes(p.soul_tipo) ? p.soul_tipo : 'soul_2',
        element_id: p.element_id || null, media_ids: Array.isArray(p.media_ids) ? p.media_ids.slice(0, 8).map(String) : [],
      };
    } catch { return null; }
  }
  const lista = (dir, rel) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && MEDIO.test(e.name) && !e.name.startsWith('.'))
    .map((e) => { const st = statSync(path.join(dir, e.name)); return { ruta: `${rel}/${e.name}`, nombre: e.name, tamano: st.size, mod: st.mtime.toISOString() }; })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true })) : []);

  // ---------- Resultados ----------
  function trabajos() {
    if (!existsSync(raiz)) return [];
    return readdirSync(raiz, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.'))
      .map((e) => {
        const archivos = lista(path.join(raiz, e.name), `imagenes/${e.name}`);
        let meta = {};
        try { meta = JSON.parse(readFileSync(path.join(raiz, e.name, '_encargo.json'), 'utf8')); } catch { /* sin datos */ }
        return {
          nombre: e.name, titulo: meta.titulo || e.name, tipo: meta.tipo || null, formato: meta.formato || null, pieza: meta.pieza || null,
          creado: meta.creado || null, archivos, videos: archivos.filter((a) => VIDEO.test(a.nombre)).length,
          mod: archivos.map((a) => a.mod).sort().at(-1) || meta.creado || '',
        };
      })
      .sort((a, b) => String(b.mod).localeCompare(String(a.mod)));
  }

  async function estado({ fresco = false } = {}) {
    return {
      conector: await conector({ fresco }), personaje: personaje(),
      fotosCara: lista(cara, 'imagenes/_mi-cara'), referencias: lista(referencias, 'imagenes/_referencias'),
      trabajos: trabajos(), tipos: TIPOS_IMAGEN, formatos: FORMATOS_IMAGEN,
    };
  }

  function borrar(nombre) {
    if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(String(nombre || ''))) throw new ImagenesError('No válido');
    rmSync(path.join(raiz, nombre), { recursive: true, force: true });
    return { ok: true };
  }

  // ---------- Encargos para Claude ----------
  const pasosComunes = (carpeta, presupuesto) => `
Herramientas: las del conector mcp__higgsfield (tu cuenta de Higgsfield). Ayudante para archivos (node):
- Subir un archivo local: llama a media_upload con su nombre, después  node "${ayudante}" subir <archivo> "<upload_url>"  y, si dice OK, media_confirm.
- Bajar un resultado:  node "${ayudante}" bajar "<url>" ${carpeta}  (lo guarda con el siguiente número).
Reglas:
- Antes de generar, mira el coste con get_cost:true. Presupuesto: ${presupuesto} créditos en total. Si cuesta más, NO generes: di en el chat cuánto cuesta y espera mi sí.
- No uses las generaciones ilimitadas (use_unlim) salvo que yo lo pida.
- Espera los resultados con jobs_wait y BÁJALOS todos a ${carpeta}/ (sin eso no los veo en JARVIS).
- Termina con un resumen corto: qué has generado, con qué modelo, los créditos gastados y cuál te parece mejor. No publiques nada.`;

  // Cómo se usa tu cara en cada caso (lo dicen las herramientas del conector)
  function comoMiCara(p) {
    if (!p) return '';
    if (p.tipo === 'soul') return `Con mi personaje entrenado: model '${p.soul_tipo === 'soul_cinematic' ? 'soul_cinematic' : 'soul_2'}' con soul_id ${p.soul_id}.`;
    if (p.tipo === 'elemento') return `Con mi Elemento de Higgsfield: pon <<<${p.element_id}>>> dentro del prompt (no en medias) y usa un modelo que admita Elementos (p. ej. nano_banana_pro o gpt_image_2 para imagen; seedance_2_0 para vídeo).`;
    return `Con mis fotos subidas a Higgsfield como referencia de cara (medias, media_id: ${p.media_ids.join(', ')}) y un modelo que respete la identidad con referencias (p. ej. nano_banana_pro). Que se me reconozca: misma cara, sin inventar rasgos.`;
  }

  // Ya tienes tu cara en Higgsfield (personaje, Elemento o fotos): JARVIS lo busca y lo guarda para usarlo
  function buscarCara() {
    return {
      prompt: `Quiero usar en JARVIS lo que YA tengo de mi cara en Higgsfield. No generes nada ni gastes créditos: solo mira y guarda.
1. list_workspaces: si ninguno está marcado como seleccionado, selecciona el privado con select_workspace.
2. Busca, en este orden: personajes entrenados (show_characters action 'list' con type 'soul_2', luego 'soul_cinematic' y 'soul', status 'ready'); Elementos (show_reference_elements action 'list', category character, status completed); y mis fotos subidas (show_medias type image).
3. Enséñame en el chat lo que encuentres (nombre, tipo y, de las fotos, sus enlaces) y pregúntame cuál uso. Si solo hay una opción clara, propónmela.
4. Con mi respuesta, escribe imagenes/_mi-cara/personaje.json con UNA de estas formas:
   - personaje: {"soul_id": "...", "soul_tipo": "soul_2|soul_cinematic|soul", "nombre": "...", "estado": "listo"}
   - Elemento: {"element_id": "...", "nombre": "...", "estado": "listo"}
   - fotos: {"media_ids": ["...", "..."] (de 1 a 4 de las mejores, solo yo, cara clara), "nombre": "Mis fotos", "estado": "listo"}
5. Si no hay nada, dímelo: entonces subo fotos en «Tu cara» y lo entrenamos.`,
    };
  }

  function nuevo(d = {}) {
    const tipo = TIPOS_IMAGEN[d.tipo] ? d.tipo : 'imagen';
    const descripcion = String(d.descripcion || '').trim().slice(0, 3000);
    if (!descripcion) throw new ImagenesError('Describe lo que quieres');
    const formato = FORMATOS_IMAGEN[d.formato] ? d.formato : '9:16';
    const cantidad = Math.max(1, Math.min(4, Number(d.cantidad) || (tipo === 'broll' || tipo === 'animar' ? 1 : 2)));
    const presupuesto = Math.max(1, Math.min(2000, Number(d.presupuesto) || 60));
    const duracion = Math.max(3, Math.min(15, Number(d.duracion) || 5));
    const refs = (Array.isArray(d.referencias) ? d.referencias : []).map(String).filter((r) => /^imagenes\/_referencias\/[^/]+$/.test(r)).slice(0, 8);
    if (tipo === 'animar' && !refs.length) throw new ImagenesError('Sube la imagen que quieres animar');
    const p = personaje();
    if (tipo === 'conmigo' && !p) throw new ImagenesError('Primero elige tu cara en «Tu cara»: busca lo que ya tienes en Higgsfield o sube tus fotos');

    const titulo = String(d.titulo || '').trim().slice(0, 80) || descripcion.split(/[.\n]/)[0].slice(0, 60);
    let nombre = slug(titulo) || 'imagenes';
    for (let i = 2; existsSync(path.join(raiz, nombre)); i++) nombre = `${slug(titulo).slice(0, 45) || 'imagenes'}-${i}`;
    const carpeta = `imagenes/${nombre}`;
    mkdirSync(path.join(raiz, nombre), { recursive: true });
    const meta = { titulo, tipo, formato, cantidad, creado: new Date().toISOString(), ...(d.pieza ? { pieza: Number(d.pieza) } : {}) };
    writeFileSync(path.join(raiz, nombre, '_encargo.json'), JSON.stringify(meta, null, 2));

    const pieza = d.pieza && jarvis ? (() => { try { return jarvis.listarPiezas().find((x) => x.id === Number(d.pieza)); } catch { return null; } })() : null;
    const que = {
      imagen: `${cantidad} ${cantidad === 1 ? 'imagen' : 'variantes de imagen'}. Modelo: el general por defecto del conector (o el que mejor encaje: models_explore action:'recommend').`,
      conmigo: `${cantidad} ${cantidad === 1 ? 'foto' : 'fotos'} MÍAS. ${comoMiCara(p)}`,
      broll: `${cantidad} ${cantidad === 1 ? 'clip' : 'clips'} de B-roll de unos ${duracion} s, sin texto en pantalla ni marcas de agua. Modelo de vídeo general por defecto del conector.`,
      animar: `Anima la imagen de referencia: ${cantidad} ${cantidad === 1 ? 'vídeo' : 'variantes'} de unos ${duracion} s, movimiento natural, sin deformar caras ni texto.`,
    }[tipo];
    return {
      nombre,
      prompt: `Genera con Higgsfield: ${TIPOS_IMAGEN[tipo]}.
Qué quiero: ${descripcion}
${que}
Formato: ${formato} (${FORMATOS_IMAGEN[formato]}).
${refs.length ? `Referencias (súbelas primero y úsalas como medias con el rol que pida el modelo): ${refs.join(', ')}\n` : ''}${pieza ? `Es para la pieza «${pieza.titulo}» (${pieza.formato || 'pieza'})${pieza.caption ? `; caption: «${String(pieza.caption).slice(0, 300)}»` : ''}.\n` : ''}${d.indicaciones ? `Indicaciones: ${String(d.indicaciones).slice(0, 1500)}\n` : ''}
Escribe tú el prompt para el modelo (en inglés si el modelo lo agradece): concreto, con luz, encuadre y estilo. Si es para mi marca, mira los colores de mi sistema de diseño (_diseno/ del vault) y nada de texto dentro de la imagen salvo que lo pida.
Guárdalo todo en ${carpeta}/ y escribe ${carpeta}/_encargo.md con el prompt que has usado y el modelo.
${pasosComunes(carpeta, presupuesto)}`,
    };
  }

  function entrenarCara({ nombre } = {}) {
    const fotos = lista(cara, 'imagenes/_mi-cara').filter((a) => !VIDEO.test(a.nombre));
    if (fotos.length < 5) throw new ImagenesError(`Sube al menos 5 fotos tuyas (llevas ${fotos.length}); mejor 10-20, con luz y ángulos distintos`);
    const n = String(nombre || '').trim().slice(0, 40) || 'Yo';
    return {
      prompt: `Quiero entrenar en Higgsfield mi personaje con mi cara (Soul): es una petición explícita de entrenar.
Nombre del personaje: ${n}
Mis fotos (${fotos.length}): ${fotos.slice(0, 20).map((f) => f.ruta).join(', ')}
Pasos:
1. Súbelas: media_upload con los nombres (files[]), después  node "${ayudante}" subir <archivo> "<upload_url>"  para cada una y media_confirm con todos los media_id (type image).
2. Entrena con show_characters action 'train', name «${n}», type 'soul_2' y los media_id. Antes dime el coste si el conector lo da.
3. Escribe imagenes/_mi-cara/personaje.json con {"soul_id": "...", "nombre": "${n}", "estado": "entrenando", "fecha": "<hoy>"}.
4. Comprueba con show_characters action 'status' hasta que esté listo (tarda unos 10 min; puedes decirme que vuelva luego) y entonces pon "estado": "listo".
No generes nada más.`,
    };
  }

  return { estado, conector, anadirConector, personaje, trabajos, nuevo, entrenarCara, buscarCara, borrar, carpetas: { raiz, referencias, cara } };
}
