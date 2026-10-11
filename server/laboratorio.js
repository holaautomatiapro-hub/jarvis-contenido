import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, cpSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { ROOT } from './config.js';
import { leerZip } from './diseno/zip.js';
import { nombreSeguro } from './archivos.js';
import { rutaFfmpeg } from './diseno/motor.js';

// Laboratorio: clips de testimonios y edición de reels con el plugin «testimonios» de la persona.
// Todo vive en una carpeta de trabajo propia (fuera del vault: los vídeos pesan mucho):
//   crudo/ fichas/ transcripciones/ marca/ fotos/ clips/ testimonios/ reels/  (las del plugin)
//   .jarvis/plugin/   el plugin importado (privado: no está en el código de JARVIS)
//   .venv/            Python con sus librerías (lo prepara scripts/preparar-laboratorio.sh)

export class LaboratorioError extends Error {
  constructor(m) { super(m); this.publico = true; }
}

const CARPETAS = ['crudo', 'fichas/clips', 'fichas/testimonios', 'fichas/reels', 'transcripciones', 'marca', 'fotos', 'clips', 'testimonios', 'reels'];
const VIDEO = /\.(mp4|mov|m4v|mkv|webm)$/i;
const IMAGEN = /\.(jpe?g|png|webp)$/i;
const MIME = { mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', mkv: 'video/x-matroska', webm: 'video/webm', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', md: 'text/markdown; charset=utf-8', json: 'application/json' };
const MAX_SUBIDA = 8 * 1024 ** 3;
// Lo que se enseña en el Laboratorio y se puede abrir desde el navegador
const VISIBLES = ['clips', 'testimonios', 'reels', 'marca', 'fotos', 'crudo'];
export const PIEZAS_TESTIMONIO = {
  stories: 'Stories en vídeo (9:16)', carrusel: 'Carrusel en vídeo (4:5)', reel: 'Clips en reel (9:16)',
  carrusel4x5: 'Clips en 4:5', youtube: 'Entrevista completa para YouTube', portada: 'Portada', captions: 'Los 3 captions',
};
export const PLANTILLAS_REEL = { pantalla: 'Pantalla completa (9:16)', ventana: 'Ventana con marco (9:16)', feed: 'Feed 4:5' };

const slug = (s) => nombreSeguro(String(s || '').trim() || 'cliente').replace(/\.[^.]*$/, '');

export function createLaboratorio({ dir, archivos, jarvis, env = process.env, reelScript = path.join(ROOT, 'laboratorio', 'reel.py'), log = () => {} }) {
  const base = path.resolve(dir);
  const pluginDir = path.join(base, '.jarvis', 'plugin');
  const venv = path.join(base, '.venv');
  const binVenv = path.join(venv, process.platform === 'win32' ? 'Scripts' : 'bin');
  const python = () => (env.LABORATORIO_PYTHON || (existsSync(path.join(binVenv, process.platform === 'win32' ? 'python.exe' : 'python')) ? path.join(binVenv, process.platform === 'win32' ? 'python.exe' : 'python') : null));

  function iniciar() {
    for (const c of CARPETAS) mkdirSync(path.join(base, ...c.split('/')), { recursive: true });
  }

  // Ruta segura dentro de la carpeta de trabajo
  function ruta(rel, { visibles = true } = {}) {
    const limpio = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const abs = path.resolve(base, limpio);
    if (!abs.startsWith(base + path.sep)) throw new LaboratorioError('Ruta fuera del Laboratorio');
    if (limpio.split('/').some((p) => p.startsWith('.') || p === '')) throw new LaboratorioError('Ruta no permitida');
    if (visibles && !VISIBLES.includes(limpio.split('/')[0])) throw new LaboratorioError('Ruta no permitida');
    return abs;
  }

  // ---------- Plugin ----------
  function plugin() {
    try {
      const p = JSON.parse(readFileSync(path.join(pluginDir, '.claude-plugin', 'plugin.json'), 'utf8'));
      return { instalado: true, nombre: p.name, version: p.version || null, skills: readdirSync(path.join(pluginDir, 'skills')).filter((s) => existsSync(path.join(pluginDir, 'skills', s, 'SKILL.md'))) };
    } catch { return { instalado: false }; }
  }

  function importarPlugin(buf) {
    let entradas;
    try { entradas = leerZip(buf, { maxArchivos: 2000, maxTotal: 500 * 1024 ** 2 }); } catch (e) { throw new LaboratorioError(e.message); }
    const manifiesto = entradas.find((a) => /(^|\/)\.claude-plugin\/plugin\.json$/.test(a.nombre));
    if (!manifiesto) throw new LaboratorioError('El .zip no es un plugin de Claude Code: le falta .claude-plugin/plugin.json');
    const raiz = manifiesto.nombre.replace(/\.claude-plugin\/plugin\.json$/, '');
    const dentro = entradas.filter((a) => a.nombre.startsWith(raiz) && !/(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)(\/|$)/.test(a.nombre));
    const tiene = (rel) => dentro.some((a) => a.nombre === raiz + rel);
    if (!tiene('motor/montar.py') || !tiene('skills/testimonio-completo/SKILL.md')) throw new LaboratorioError('Este plugin no parece el de testimonios: le falta motor/montar.py o la skill testimonio-completo');
    iniciar();
    const tmp = `${pluginDir}.importando`;
    rmSync(tmp, { recursive: true, force: true });
    for (const a of dentro) {
      const destino = path.resolve(tmp, a.nombre.slice(raiz.length));
      if (!destino.startsWith(tmp + path.sep)) throw new LaboratorioError(`Ruta no permitida en el .zip: ${a.nombre}`);
      mkdirSync(path.dirname(destino), { recursive: true });
      writeFileSync(destino, a.contenido);
    }
    if (existsSync(pluginDir)) {
      const copia = path.join(base, '.jarvis', 'plugins-anteriores', new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-'));
      mkdirSync(path.dirname(copia), { recursive: true });
      try { renameSync(pluginDir, copia); } catch { cpSync(pluginDir, copia, { recursive: true }); rmSync(pluginDir, { recursive: true, force: true }); }
    }
    renameSync(tmp, pluginDir);
    return estado();
  }

  // ---------- Estado ----------
  function marca() {
    try {
      const m = JSON.parse(readFileSync(path.join(base, 'marca', 'marca.json'), 'utf8'));
      return { existe: true, verificado: m.verificado === true, nombre: m.nombre || null, usuario: m.usuario || null, fecha: m.fecha || null, muestra: existsSync(path.join(base, 'marca', 'muestra.jpg')) ? 'marca/muestra.jpg' : null };
    } catch { return { existe: false, verificado: false }; }
  }

  function estado() {
    return { carpeta: base, plugin: plugin(), python: Boolean(python()), marca: marca(), piezasTestimonio: PIEZAS_TESTIMONIO, plantillasReel: PLANTILLAS_REEL };
  }

  // Lo que comprueba el propio plugin (marca.py requisitos): ffmpeg, Node, librerías de Python…
  function requisitos() {
    const py = python();
    if (!py) return Promise.resolve({ ok: false, lineas: [{ ok: false, texto: 'Python del Laboratorio (falta: ejecuta bash ~/instalar-vps.sh en el VPS)' }] });
    if (!plugin().instalado) return Promise.resolve({ ok: false, lineas: [{ ok: false, texto: 'Plugin de testimonios (impórtalo con el .zip)' }] });
    return new Promise((resolve) => {
      const p = spawn(py, [path.join(pluginDir, 'motor', 'marca.py'), 'requisitos'], { cwd: base, env: { ...process.env, ...entorno().env }, windowsHide: true });
      let out = '';
      p.stdout.on('data', (d) => { out += d; });
      p.stderr.on('data', (d) => { out += d; });
      p.on('error', (e) => resolve({ ok: false, lineas: [{ ok: false, texto: e.message }] }));
      p.on('close', () => {
        const lineas = out.split('\n').filter((l) => /^(OK|FALTA)\s/.test(l)).map((l) => ({ ok: l.startsWith('OK'), texto: l.replace(/^(OK|FALTA)\s+/, '') }));
        resolve({ ok: lineas.length > 0 && lineas.every((l) => l.ok), lineas });
      });
    });
  }

  // ---------- Subir entrevistas, fotos, logos y vídeos para reels ----------
  async function subir(stream, { tipo, nombre, cliente }) {
    iniciar();
    const n = nombreSeguro(nombre);
    const ext = (n.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
    let carpeta;
    if (tipo === 'entrevista' || tipo === 'video') {
      if (!VIDEO.test(n)) throw new LaboratorioError('Sube un vídeo (mp4, mov, m4v, mkv o webm)');
      carpeta = 'crudo';
    } else if (tipo === 'foto') {
      if (!IMAGEN.test(n)) throw new LaboratorioError('Sube una foto (jpg, png o webp)');
      carpeta = `fotos/${slug(cliente)}`;
    } else if (tipo === 'logo') {
      if (!IMAGEN.test(n)) throw new LaboratorioError('Sube el logo en png o jpg');
      carpeta = 'marca';
    } else throw new LaboratorioError('Tipo de archivo no válido');
    mkdirSync(path.join(base, carpeta), { recursive: true });
    // Sin pisar otro con el mismo nombre
    let final = n;
    for (let i = 2; existsSync(path.join(base, carpeta, final)); i++) final = n.replace(/(\.[^.]+)$/, `-${i}$1`);
    const destino = path.join(base, carpeta, final);
    let tamano = 0;
    try {
      await pipeline(stream, async function* (fuente) {
        for await (const trozo of fuente) {
          tamano += trozo.length;
          if (tamano > MAX_SUBIDA) throw new LaboratorioError('El archivo pesa más de 8 GB');
          yield trozo;
        }
      }, createWriteStream(destino));
    } catch (e) {
      rmSync(destino, { force: true });
      throw e instanceof LaboratorioError ? e : new LaboratorioError(`No se pudo guardar «${nombre}»`);
    }
    if (!tamano) { rmSync(destino, { force: true }); throw new LaboratorioError('El archivo está vacío'); }
    // El motor del plugin busca los vídeos como .mp4: los demás se pasan a mp4 (sin recomprimir si se puede)
    let rel = `${carpeta}/${final}`;
    if (carpeta === 'crudo' && ext !== 'mp4') rel = await aMp4(rel);
    return { ruta: rel, nombre: path.basename(rel), tamano };
  }

  async function aMp4(rel) {
    const origen = path.join(base, rel);
    const destinoRel = rel.replace(/\.[^.]+$/, '.mp4');
    const destino = path.join(base, destinoRel);
    const ffmpeg = await rutaFfmpeg();
    const correr = (args) => new Promise((ok) => {
      const p = spawn(ffmpeg, ['-v', 'error', '-y', '-i', origen, ...args, destino], { windowsHide: true });
      p.on('error', () => ok(false));
      p.on('close', (c) => ok(c === 0));
    });
    if (await correr(['-c', 'copy', '-movflags', '+faststart']) || await correr(['-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'])) {
      rmSync(origen, { force: true });
      return destinoRel;
    }
    rmSync(destino, { force: true });
    log(`No se pudo pasar ${rel} a mp4: se deja tal cual`);
    return rel;
  }

  // ---------- Resultados ----------
  const lista = (relDir, filtro) => {
    const abs = path.join(base, relDir);
    if (!existsSync(abs)) return [];
    return readdirSync(abs, { withFileTypes: true }).filter((e) => e.isFile() && filtro.test(e.name) && !e.name.startsWith('.'))
      .map((e) => { const st = statSync(path.join(abs, e.name)); return { ruta: `${relDir}/${e.name}`, nombre: e.name, tamano: st.size, mod: st.mtime.toISOString() }; })
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true }));
  };
  const subcarpetas = (relDir) => {
    const abs = path.join(base, relDir);
    if (!existsSync(abs)) return [];
    return readdirSync(abs, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_')).map((e) => e.name).sort((a, b) => a.localeCompare(b, 'es'));
  };
  const NOMBRES_GRUPO = { stories: 'Stories', 'carrusel-video': 'Carrusel en vídeo', 'reel-9x16': 'Clips en reel', 'carrusel-4x5': 'Clips en 4:5', youtube: 'YouTube', pantalla: 'Pantalla completa', ventana: 'Ventana con marco', feed: 'Feed 4:5' };

  // Recorre clips/<Cliente>/[subcarpeta/]<formato>/*.mp4
  function gruposClips(relCliente) {
    const out = [];
    for (const sub of subcarpetas(relCliente)) {
      const enSub = lista(`${relCliente}/${sub}`, /\.mp4$/i);
      if (enSub.length) out.push({ id: sub, nombre: NOMBRES_GRUPO[sub] || sub, archivos: enSub });
      for (const fmt of subcarpetas(`${relCliente}/${sub}`)) {
        const a = lista(`${relCliente}/${sub}/${fmt}`, /\.mp4$/i);
        if (a.length) out.push({ id: `${sub}/${fmt}`, nombre: `${NOMBRES_GRUPO[fmt] || fmt} · ${sub}`, archivos: a });
      }
    }
    return out;
  }

  function resultados() {
    const porCliente = new Map();
    const de = (nombre) => { if (!porCliente.has(nombre)) porCliente.set(nombre, { cliente: nombre, grupos: [], portadas: [], caption: null, indice: null, mod: '' }); return porCliente.get(nombre); };
    for (const c of subcarpetas('testimonios')) {
      const r = de(c);
      for (const g of ['stories', 'carrusel-video']) {
        const a = lista(`testimonios/${c}/${g}`, /\.mp4$/i);
        if (a.length) r.grupos.push({ id: g, nombre: NOMBRES_GRUPO[g], archivos: a });
      }
      r.portadas = lista(`testimonios/${c}`, /^portada.*\.(jpe?g|png)$/i);
      if (existsSync(path.join(base, 'testimonios', c, '_caption.md'))) r.caption = `testimonios/${c}/_caption.md`;
    }
    for (const c of subcarpetas('clips')) {
      const r = de(c);
      r.grupos.push(...gruposClips(`clips/${c}`));
      if (existsSync(path.join(base, 'clips', c, '_clips.md'))) r.indice = `clips/${c}/_clips.md`;
    }
    const testimonios = [...porCliente.values()].filter((r) => r.grupos.length || r.portadas.length || r.caption).map((r) => ({
      ...r, mod: [...r.grupos.flatMap((g) => g.archivos), ...r.portadas].map((a) => a.mod).sort().at(-1) || '',
    })).sort((a, b) => b.mod.localeCompare(a.mod));

    const reels = subcarpetas('reels').map((c) => {
      const grupos = subcarpetas(`reels/${c}`).map((p) => ({ id: p, nombre: NOMBRES_GRUPO[p] || p, archivos: lista(`reels/${c}/${p}`, /\.mp4$/i) })).filter((g) => g.archivos.length);
      const previas = lista(`reels/${c}`, /^_preview.*\.jpg$/i);
      return { nombre: c, grupos, previas, caption: existsSync(path.join(base, 'reels', c, '_caption.md')) ? `reels/${c}/_caption.md` : null, mod: [...grupos.flatMap((g) => g.archivos), ...previas].map((a) => a.mod).sort().at(-1) || '' };
    }).sort((a, b) => b.mod.localeCompare(a.mod));

    return { testimonios, reels, entrevistas: lista('crudo', VIDEO) };
  }

  function archivo(rel) {
    const abs = ruta(rel);
    if (!existsSync(abs) || !statSync(abs).isFile()) throw new LaboratorioError('Ese archivo ya no está');
    return { abs, mime: MIME[path.extname(abs).slice(1).toLowerCase()] || 'application/octet-stream' };
  }

  function texto(rel) {
    if (!/\.md$/i.test(rel)) throw new LaboratorioError('Solo se leen notas .md');
    return { ruta: rel, texto: readFileSync(archivo(rel).abs, 'utf8') };
  }

  function borrar(rel) {
    const abs = ruta(rel);
    const raiz = String(rel).split('/')[0];
    if (!['clips', 'testimonios', 'reels', 'crudo'].includes(raiz)) throw new LaboratorioError('Eso no se puede borrar desde aquí');
    rmSync(abs, { recursive: true, force: true });
    return { ok: true };
  }

  // Pasa vídeos o imágenes a la biblioteca de Contenido como una pieza (un carrusel lleva varios archivos)
  async function aBiblioteca({ rutas = [], titulo, formato = 'Reel', caption = null }) {
    if (!archivos) throw new LaboratorioError('La biblioteca no está disponible');
    if (!rutas.length) throw new LaboratorioError('Elige al menos un archivo');
    const guardados = [];
    for (const rel of rutas.slice(0, 20)) {
      const { abs, mime } = archivo(rel);
      if (!/^(video|image)\//.test(mime)) throw new LaboratorioError(`«${path.basename(rel)}» no es un vídeo ni una imagen`);
      guardados.push(await archivos.guardar(createReadStream(abs), { nombre: path.basename(rel), mime }));
    }
    const nombre = String(titulo || '').trim() || path.basename(rutas[0]).replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
    return jarvis.crearPieza({ titulo: nombre.slice(0, 200), formato, estado: 'listo', archivos: guardados, caption: caption ? String(caption).slice(0, 5000) : null, origen: 'laboratorio' });
  }

  // ---------- Claude con el plugin ----------
  // Permisos de Bash: solo los programas del montaje (y moverse por carpetas). Nada de borrar ni instalar.
  const BASH = ['python', 'python3', 'py', 'ffmpeg', 'ffprobe', 'npx', 'npm', 'node', 'ls', 'cd', 'mkdir', 'cp', 'mv', 'cat', 'head', 'tail', 'wc', 'echo', 'pwd'].map((c) => `Bash(${c}:*)`);
  function entorno() {
    const extraPath = [python() ? binVenv : null].filter(Boolean);
    return {
      cwd: base,
      pluginDirs: plugin().instalado ? [pluginDir] : [],
      herramientasExtra: BASH,
      env: {
        PATH: [...extraPath, env.PATH || process.env.PATH || ''].join(path.delimiter),
        TESTIMONIOS_TRABAJO: base,
        TESTIMONIOS_PLUGIN: pluginDir,
        PYTHONIOENCODING: 'utf-8',
        // Transcribir o renderizar puede tardar mucho: los comandos tienen hasta 2 h
        BASH_DEFAULT_TIMEOUT_MS: '3600000',
        BASH_MAX_TIMEOUT_MS: '7200000',
      },
      sistema: `Carpeta de trabajo (la actual): ${base}
Plugin «testimonios»: ${pluginDir} (es el <PLUGIN> de sus skills; la carpeta actual es <TRABAJO>).
Python con todas las librerías: el comando \`python\` (ya está en el PATH).
Editor de reels: python "${reelScript}" (sin argumentos explica la ficha y los comandos).
Lo que generes aparece solo en el Laboratorio de JARVIS; la persona lo pasa a la biblioteca desde allí.`,
    };
  }

  function prompt(tipo, d = {}) {
    if (!plugin().instalado) throw new LaboratorioError('Primero importa el plugin de testimonios (.zip)');
    const linea = (k, v) => (v ? `${k}: ${v}\n` : '');
    if (tipo === 'marca') {
      return `Usa la skill configurar-marca del plugin testimonios para fijar mi marca.\n${linea('Lo que quiero cambiar', d.cambios)}${linea('Mi logo', d.logo)}`;
    }
    if (tipo === 'testimonio') {
      if (!d.entrevista) throw new LaboratorioError('Sube la entrevista');
      if (!String(d.cliente || '').trim()) throw new LaboratorioError('Escribe el nombre del cliente');
      const piezas = (Array.isArray(d.piezas) && d.piezas.length ? d.piezas : Object.keys(PIEZAS_TESTIMONIO)).filter((p) => PIEZAS_TESTIMONIO[p]);
      const todo = piezas.length === Object.keys(PIEZAS_TESTIMONIO).length;
      return `${todo ? 'Usa la skill testimonio-completo del plugin testimonios: haz todo el testimonio.' : `Usa las skills del plugin testimonios para hacer SOLO estas piezas: ${piezas.map((p) => PIEZAS_TESTIMONIO[p]).join(', ')}.`}
Cliente: ${String(d.cliente).trim()}
Entrevista: ${d.entrevista}
${d.foto ? `Foto del cliente: ${d.foto}\n` : 'Sin foto del cliente (si hace falta para la portada, se omite y se dice).\n'}${d.frase ? `Frase de la portada: «${String(d.frase).trim()}»\n` : ''}${d.queHicimos ? `Qué hicimos con el cliente: ${String(d.queHicimos).trim()}\n` : 'Qué hicimos con el cliente: pregúntamelo en la parada de revisión (no lo inventes).\n'}${linea('Fotos extra', d.extra)}${linea('Indicaciones', d.indicaciones)}
Recuerda: antes de montar, enséñame en el chat el guion y los clips y espera mi visto bueno.`;
    }
    if (tipo === 'reel') {
      if (!d.video) throw new LaboratorioError('Sube el vídeo');
      const plantillas = (Array.isArray(d.plantillas) && d.plantillas.length ? d.plantillas : ['pantalla']).filter((p) => PLANTILLAS_REEL[p]);
      const nombre = String(d.nombre || '').trim() || path.basename(d.video).replace(/\.[^.]+$/, '');
      const modo = d.modo === 'entero' ? 'el vídeo entero, limpio (sin silencios ni muletillas), en un solo clip'
        : `${Math.max(1, Math.min(10, Number(d.clips) || 3))} clips con los MEJORES momentos, de unos ${Math.max(15, Math.min(90, Number(d.duracion) || 45))} s cada uno`;
      return `Edita mi reel con el editor de reels del Laboratorio (motor del plugin testimonios).
Vídeo: ${d.video}
Nombre del reel: ${nombre} (ficha: fichas/reels/${slug(nombre)}.json, "cliente": "${nombre.replace(/"/g, '')}")
Quiero: ${modo}.
Plantillas: ${plantillas.map((p) => `${p} (${PLANTILLAS_REEL[p]})`).join(', ')}.
${d.titulo ? `Título: ${d.titulo}\n` : 'Título: propón uno con gancho por clip (dos líneas cortas, en mayúsculas, con datos reales de lo que digo).\n'}Quitar muletillas («eh», «em», «mmm»): ${d.muletillas === false ? 'no' : 'sí'}. Los tacos, según mi marca.
${linea('Indicaciones', d.indicaciones)}
Pasos:
1. Transcribe: python "${path.join(pluginDir, 'motor', 'transcribir.py')}" "${d.video}" (queda en transcripciones/).
2. Lee la transcripción y elige los cortes (usa python "${path.join(pluginDir, 'motor', 'herramientas.py')}" palabras <id> <ini> <fin> para afinar el segundo exacto). Cada clip: gancho fuerte en los primeros segundos, una sola idea, que se entienda sin el resto y sin frases a medias. Si el vídeo es horizontal o la cara no está centrada, mira un fotograma (herramientas.py fotos) y ajusta "foco_y".
3. Escribe la ficha y comprueba con reel.py <nombre> limpiar y reel.py <nombre> textos; corrige con "reemplazos" y "correcciones" lo que la transcripción haya roto (palabras de mi sector).
4. Enséñame en el chat cada clip (título, texto y duración) y ESPERA mi visto bueno.
5. Con el sí: saca un fotograma de prueba (reel.py <nombre> preview <clip> <plantilla>), míralo con Read y, si está bien, monta todo con reel.py <nombre> all.
6. Escribe reels/<nombre>/_caption.md con un caption para cada clip (mi tono, el de la marca) y dime qué clips son los más fuertes.`;
    }
    throw new LaboratorioError('Trabajo no válido');
  }

  return { dir: base, pluginDir, iniciar, estado, requisitos, importarPlugin, subir, resultados, archivo, texto, borrar, aBiblioteca, entorno, prompt, ruta };
}

export const carpetaPorDefecto = (envObj = process.env) => envObj.LABORATORIO_PATH || path.join(os.homedir(), 'JARVIS-Laboratorio');
