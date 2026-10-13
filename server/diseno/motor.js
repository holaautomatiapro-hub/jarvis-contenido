// Motor de diseño: convierte cada diapositiva (HTML + CSS del kit + animación GSAP) en una imagen JPG
// o en un vídeo MP4, con un navegador sin ventana (Edge o Chrome; en el VPS, el Chromium de Playwright).
//
// Cada diapositiva se abre en una página aislada (origen falso http://diseno.jarvis): solo puede cargar
// los archivos del kit, GSAP, los medios de la biblioteca y las fuentes de Google. No llega a la API de
// JARVIS, así que un diseño nunca puede tocar tus datos.
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readSync, renameSync, rmSync, statSync, readFileSync } from 'node:fs';
import { FORMATOS } from './kit.js';

const require = createRequire(import.meta.url);
const ORIGEN = 'http://diseno.jarvis';
const GSAP = require.resolve('gsap/dist/gsap.min.js');
const FUERA_PERMITIDO = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;
const MIME = { css: 'text/css', js: 'text/javascript', json: 'application/json', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf' };
const VERIFICADO = '<svg class="verificado" viewBox="0 0 24 24" aria-hidden="true"><path fill="#0095F6" d="M12 1.2l2.6 2 3.3-.3 1 3.2 2.9 1.6-1.2 3.1 1.2 3.1-2.9 1.6-1 3.2-3.3-.3-2.6 2-2.6-2-3.3.3-1-3.2-2.9-1.6 1.2-3.1-1.2-3.1 2.9-1.6 1-3.2 3.3.3z"/><path d="M7.6 12.3l3 3 5.8-6.2" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const enScript = (s) => String(s || '').replace(/<\/script/gi, '<\\/script');

// ---------------------------------------------------------------------------------------------------
// Qué es un diseño: el mismo formato que los guion.json de HyperFrames, más formato, plantilla y caption.
//   { titulo, formato: 'carrusel'|'story', plantilla, caption,
//     slides: [{ bg: 'black'|'grey'|…, glow: 'top'|'mid'|null, blocks: [{ html, js }] }] }
// Cada diapositiva puede traer también html/js directamente en lugar de blocks.
export function normalizarDiseno(d, kit) {
  if (!d || typeof d !== 'object') throw new Error('El diseño debe ser un objeto');
  const formato = FORMATOS[d.formato] ? d.formato : 'carrusel';
  const plantilla = kit.plantillas.find((p) => p.id === d.plantilla) || null;
  if (!plantilla) throw new Error(`La plantilla "${d.plantilla}" no existe en el kit. Disponibles: ${kit.plantillas.map((p) => p.id).join(', ')}`);
  if (!plantilla.formatos.includes(formato)) throw new Error(`La plantilla "${plantilla.id}" no tiene formato ${formato} (solo ${plantilla.formatos.join(', ')})`);
  const max = formato === 'story' ? 20 : 10;
  const slides = Array.isArray(d.slides) ? d.slides : [];
  if (!slides.length) throw new Error('El diseño no tiene diapositivas');
  if (slides.length > max) throw new Error(`Demasiadas diapositivas: ${slides.length} (máximo ${max} en ${formato})`);
  const token = (v, def) => (typeof v === 'string' && /^[a-z0-9-]{1,30}$/i.test(v) ? v : def);
  return {
    titulo: String(d.titulo || 'Diseño sin título').slice(0, 160),
    formato, plantilla: plantilla.id,
    caption: typeof d.caption === 'string' ? d.caption.slice(0, 2200) : '',
    slides: slides.map((s, i) => {
      const blocks = Array.isArray(s?.blocks) ? s.blocks : [];
      const html = [s?.html, ...blocks.map((b) => b?.html)].filter((x) => typeof x === 'string').join('\n');
      const js = [s?.js, ...blocks.map((b) => b?.js)].filter((x) => typeof x === 'string').join('\n');
      if (!html.trim()) throw new Error(`La diapositiva ${i + 1} no tiene HTML`);
      if (html.length > 300_000 || js.length > 100_000) throw new Error(`La diapositiva ${i + 1} es demasiado grande`);
      return { bg: token(s.bg, 'black'), glow: s.glow ? token(s.glow, null) : null, clase: token(s.clase, ''), html, js };
    }),
  };
}

// HTML completo de una diapositiva (n empieza en 1, como en HyperFrames: el contenedor es #s{n}-root)
export function paginaDiapositiva(kit, diseno, n) {
  const { ancho, alto } = FORMATOS[diseno.formato];
  const pl = kit.plantillas.find((p) => p.id === diseno.plantilla);
  const s = diseno.slides[n - 1];
  const story = diseno.formato === 'story';
  const cabecera = !story && pl.cabecera && kit.handle;
  const paginacion = !story && pl.paginacion && diseno.slides.length > 1;
  // Los <style> de la diapositiva van al <head>: dentro del contenido, el CSS del kit podría mostrarlos como texto
  const estilos = [];
  const html = s.html.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_, css) => { estilos.push(css); return ''; });
  // El CSS de cada diapositiva apunta a su contenedor (#s3-root…). Si se reordenan, se respeta el que usa.
  const ref = /#s(\d+)-root\b/.exec(estilos.join('\n') + html + s.js);
  const raiz = `s${ref ? ref[1] : n}-root`;
  const clases = ['slide', `on-${s.bg}`, story ? 'fmt-story' : `fmt-${diseno.formato}`, `tpl-${pl.id}`, s.clase].filter(Boolean).join(' ');
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<base href="${ORIGEN}/kit/">
${kit.fuentes.map((u) => `<link rel="stylesheet" href="${esc(u)}">`).join('\n')}
${kit.css.map((c) => `<link rel="stylesheet" href="${esc(c)}">`).join('\n')}
<style>html, body { margin: 0; padding: 0; width: ${ancho}px; height: ${alto}px; overflow: hidden; background: #000; }
#lienzo { position: relative; width: ${ancho}px; height: ${alto}px; overflow: hidden; }</style>
${estilos.length ? `<style>\n${estilos.join('\n')}\n</style>` : ''}
<script src="${ORIGEN}/recursos/gsap.min.js"></script>
<script>window.__errores = []; window.addEventListener('error', function (e) { window.__errores.push(String(e.message || e)); });
var tl = gsap.timeline({ paused: true }); var O = "power3.out";</script>
</head><body><div id="lienzo">
<div class="${clases}" id="${raiz}">
<div class="bg bg-${s.bg}"></div>
${s.glow ? `<div class="glow ${s.glow}"></div>` : ''}
${cabecera ? `<div class="hdr"><span>${esc(kit.handle)}</span>${kit.verificado ? VERIFICADO : ''}</div>` : ''}
<div class="content">
${html}
</div>
${paginacion ? `<div class="dots">${diseno.slides.map((_, i) => `<i${i === n - 1 ? ' class="on"' : ''}></i>`).join('')}</div>` : ''}
</div></div>
<script>
try {
${enScript(s.js)}
} catch (e) { window.__errores.push(String(e.message || e)); }
</script>
<script>${RUNTIME}</script>
</body></html>`;
}

// Lo que corre dentro de la página: esperar a que todo cargue, ir a un instante y revisar el resultado
const RUNTIME = `
window.__listo = async function (limite) {
  var problemas = [];
  try { await Promise.race([document.fonts.ready, new Promise(function (r) { setTimeout(r, 15000); })]); } catch (e) {}
  document.fonts.forEach(function (f) { if (f.status === 'error') problemas.push('No se ha podido cargar la fuente ' + f.family); });
  var imgs = Array.prototype.slice.call(document.images);
  await Promise.all(imgs.map(function (i) { return i.decode ? i.decode().catch(function () {}) : null; }));
  imgs.forEach(function (i) { if (!i.naturalWidth) problemas.push('No se ha podido cargar la imagen ' + (i.getAttribute('src') || '')); });
  var vids = Array.prototype.slice.call(document.querySelectorAll('video'));
  await Promise.all(vids.map(function (v) {
    v.muted = true; v.preload = 'auto'; v.pause();
    if (v.readyState >= 2) return null;
    return new Promise(function (r) { v.addEventListener('loadeddata', r, { once: true }); v.addEventListener('error', r, { once: true }); setTimeout(r, 20000); v.load(); });
  }));
  vids.forEach(function (v) { if (v.error || v.readyState < 2) problemas.push('No se ha podido cargar el vídeo ' + (v.getAttribute('src') || '')); });
  // Lo que empieza a animarse al final no da tiempo a verlo (los vaivenes que siguen después no importan)
  var tarde = window.tl ? tl.getChildren(true, true, false).filter(function (t) { return t.startTime() > limite - 0.4; }).map(function (t) { return t.startTime(); }) : [];
  return { problemas: problemas, errores: window.__errores.slice(), tarde: tarde };
};
window.__seek = async function (t) {
  if (window.tl) tl.seek(t, false);
  document.getAnimations().forEach(function (a) { try { a.pause(); a.currentTime = t * 1000; } catch (e) {} });
  var vids = Array.prototype.slice.call(document.querySelectorAll('video'));
  await Promise.all(vids.map(function (v) {
    if (v.error || !v.duration) return null;
    var inicio = parseFloat(v.dataset.start || '0') || 0;
    var local = Math.min(Math.max(0, t - inicio), Math.max(0, v.duration - 0.04));
    if (Math.abs(v.currentTime - local) < 0.004) return null;
    return new Promise(function (r) { v.addEventListener('seeked', r, { once: true }); setTimeout(r, 5000); v.currentTime = local; });
  }));
  await new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); });
};
window.__revisar = function (zona) {
  var lienzo = document.getElementById('lienzo');
  var W = lienzo.offsetWidth, H = lienzo.offsetHeight, avisos = [];
  var corto = function (t) { t = t.replace(/\\s+/g, ' ').trim(); return t.length > 42 ? t.slice(0, 40) + '…' : t; };
  var visible = function (el) {
    var op = 1;
    for (var e = el; e && e !== document.body; e = e.parentElement) {
      var cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      op *= parseFloat(cs.opacity);
      if (op < 0.08) return false;
    }
    return true;
  };
  var textos = [];
  var w = document.createTreeWalker(lienzo, NodeFilter.SHOW_TEXT);
  for (var nodo = w.nextNode(); nodo; nodo = w.nextNode()) {
    if (!nodo.nodeValue.trim() || !nodo.parentElement || /^(STYLE|SCRIPT)$/.test(nodo.parentElement.tagName)) continue;
    if (!visible(nodo.parentElement)) continue;
    var rg = document.createRange(); rg.selectNodeContents(nodo);
    var lineas = Array.prototype.slice.call(rg.getClientRects()).filter(function (r) { return r.width > 1 && r.height > 1; });
    if (!lineas.length) continue;
    // La caja de cada línea incluye el hueco de la fuente por arriba y por abajo: se recorta para medir las letras
    var fs = parseFloat(getComputedStyle(nodo.parentElement).fontSize) || 16;
    var tinta = lineas.map(function (r) { var m = Math.min(r.height * 0.2, fs * 0.25); return { left: r.left, right: r.right, top: r.top + m, bottom: r.bottom - m, width: r.width, height: r.height - 2 * m }; });
    textos.push({ el: nodo.parentElement, texto: nodo.nodeValue, lineas: tinta });
  }
  textos.forEach(function (t) {
    var fuera = t.lineas.some(function (r) { return r.left < -2 || r.top < -2 || r.right > W + 2 || r.bottom > H + 2; });
    if (fuera) { avisos.push('«' + corto(t.texto) + '» se sale de la imagen'); return; }
    for (var a = t.el; a && a !== lienzo; a = a.parentElement) {
      var cs = getComputedStyle(a);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      var ra = a.getBoundingClientRect();
      if (t.lineas.some(function (r) { return r.left < ra.left - 2 || r.right > ra.right + 2 || r.top < ra.top - 2 || r.bottom > ra.bottom + 2; })) {
        avisos.push('«' + corto(t.texto) + '» queda cortado: no cabe en su caja'); return;
      }
    }
    if (zona && t.lineas.some(function (r) { return r.top < zona[0] || r.bottom > H - zona[1]; })) avisos.push('«' + corto(t.texto) + '» está fuera de la zona segura de las stories');
  });
  for (var i = 0; i < textos.length; i++) for (var j = i + 1; j < textos.length; j++) {
    var A = textos[i], B = textos[j];
    if (A.el === B.el || A.el.contains(B.el) || B.el.contains(A.el)) continue;
    var pisa = A.lineas.some(function (ra) { return B.lineas.some(function (rb) {
      var x = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), y = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      return x > 0 && y > 0 && x * y > 0.3 * Math.min(ra.width * ra.height, rb.width * rb.height);
    }); });
    if (pisa) avisos.push('«' + corto(A.texto) + '» se monta sobre «' + corto(B.texto) + '»');
  }
  return avisos.filter(function (a, k) { return avisos.indexOf(a) === k; }).slice(0, 12);
};
`;

// ---------------------------------------------------------------------------------------------------
async function intentarLanzar() {
  const { chromium } = await import('playwright-core');
  const args = ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--disable-dev-shm-usage', '--font-render-hinting=none', '--hide-scrollbars'];
  const intentos = [{ channel: 'msedge' }, { channel: 'chrome' }, {}];
  if (process.env.CHROME_PATH) intentos.unshift({ executablePath: process.env.CHROME_PATH });
  let ultimo = null;
  for (const o of intentos) {
    try { return await chromium.launch({ headless: true, args, ...o }); } catch (e) { ultimo = e; }
  }
  const err = new Error('sin navegador');
  err.causa = ultimo;
  throw err;
}

// En Linux (el VPS) y macOS, si no hay navegador, JARVIS instala Chromium solo la primera vez (con las
// librerías del sistema si corre como root). En Windows siempre está Edge.
let instalacion = null;
export function instalarChromium({ ejecutar = spawn } = {}) {
  if (!instalacion) {
    instalacion = new Promise((resolve, reject) => {
      const cli = path.join(path.dirname(require.resolve('playwright-core/package.json')), 'cli.js');
      const conDeps = process.platform === 'linux' && process.getuid?.() === 0;
      const p = ejecutar(process.execPath, [cli, 'install', ...(conDeps ? ['--with-deps'] : []), '--only-shell', 'chromium'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let salida = '';
      p.stdout?.on('data', (b) => { salida += b; });
      p.stderr?.on('data', (b) => { salida += b; });
      p.on('error', reject);
      p.on('close', (code) => {
        if (code === 0) return resolve();
        // Del registro, la primera línea de error que explica algo (no las de la pila)
        const lineas = salida.split(/\r?\n/).map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').trim()).filter((l) => l && !/^at /.test(l));
        reject(new Error(lineas.find((l) => /^Error: (?!Download failure|Failed to download)/.test(l)) || lineas.at(-1) || `código ${code}`));
      });
    }).catch((e) => { instalacion = null; throw e; });
  }
  return instalacion;
}

export async function lanzarNavegador({ log = () => {} } = {}) {
  try { return await intentarLanzar(); } catch { /* se intenta instalar */ }
  if (process.platform === 'win32') throw new Error('No encuentro un navegador para dibujar los diseños: instala Microsoft Edge o Google Chrome.');
  log('Instalando Chromium para dibujar los diseños (solo la primera vez, tarda un par de minutos)…');
  try {
    await instalarChromium();
    return await intentarLanzar();
  } catch (e) {
    const detalle = e.causa?.message || e.message;
    throw new Error(`No hay navegador para dibujar los diseños y no se ha podido instalar Chromium (${String(detalle).split('\n')[0].slice(0, 200)}). En la carpeta de JARVIS ejecuta:  npx playwright-core install --with-deps chromium`);
  }
}

export async function rutaFfmpeg() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    const m = await import('ffmpeg-static');
    if (m.default && existsSync(m.default)) return m.default;
  } catch { /* no instalado */ }
  return 'ffmpeg';
}

// Sirve un archivo admitiendo Range (los vídeos lo necesitan para poder ir a un instante)
function servirArchivo(route, abs) {
  const ext = path.extname(abs).slice(1).toLowerCase();
  const tam = statSync(abs).size;
  const contentType = MIME[ext] || 'application/octet-stream';
  const rango = /bytes=(\d*)-(\d*)/.exec(route.request().headers().range || '');
  if (!rango) return route.fulfill({ status: 200, contentType, headers: { 'accept-ranges': 'bytes' }, body: readFileSync(abs) });
  const inicio = rango[1] ? +rango[1] : Math.max(0, tam - +rango[2]);
  const fin = rango[1] && rango[2] ? Math.min(+rango[2], tam - 1) : tam - 1;
  const largo = Math.max(0, Math.min(fin - inicio + 1, 8 * 1024 * 1024));
  const body = Buffer.alloc(largo);
  const fd = openSync(abs, 'r');
  try { readSync(fd, body, 0, largo, inicio); } finally { closeSync(fd); }
  return route.fulfill({ status: 206, contentType, headers: { 'accept-ranges': 'bytes', 'content-range': `bytes ${inicio}-${inicio + largo - 1}/${tam}` }, body });
}

export function createMotor({ kit: kitApi, archivos = null, lanzar = lanzarNavegador, cerrarTrasMs = 120_000, log = () => {} }) {
  let navegador = null;
  let temporizador = null;
  let cola = Promise.resolve();

  const enCola = (fn) => {
    const r = cola.then(fn, fn);
    cola = r.catch(() => {});
    return r;
  };

  async function obtenerNavegador() {
    clearTimeout(temporizador);
    if (!navegador || !navegador.isConnected()) navegador = await lanzar({ log });
    return navegador;
  }

  // Al arrancar JARVIS: deja el navegador listo (y lo instala si falta) para que el primer diseño no espere
  function preparar() {
    return enCola(async () => {
      try { await obtenerNavegador(); log('Navegador para Diseño: listo'); } catch (e) { log(e.message); } finally { soltarNavegador(); }
    });
  }
  function soltarNavegador() {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => { const n = navegador; navegador = null; n?.close().catch(() => {}); }, cerrarTrasMs);
    temporizador.unref?.();
  }

  // El Chromium de Playwright (el del VPS) no reproduce H.264, que es el MP4 de los móviles y de las grabaciones de
  // pantalla: los vídeos de la biblioteca que usa un diseño se le dan convertidos a WebM (una vez; se guardan aparte).
  const VIDEO_BIBLIOTECA = /\/api\/contenido\/archivos\/(\d{4}-\d{2})\/([^"'\s)?#<>]+\.(?:mp4|m4v|mov|mkv))/gi;
  const webmDe = (mes, fichero) => (archivos ? path.join(archivos.dir, '.webm', `${mes}_${fichero}.webm`) : null);
  async function prepararVideos(d) {
    if (!archivos) return;
    const vistos = new Set();
    for (const [, mes, fichero] of JSON.stringify(d.slides).matchAll(VIDEO_BIBLIOTECA)) {
      const clave = `${mes}/${fichero}`;
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      let origen;
      try { origen = archivos.ruta(clave); } catch { continue; }
      const destino = webmDe(mes, fichero);
      if (!existsSync(origen) || existsSync(destino)) continue;
      mkdirSync(path.dirname(destino), { recursive: true });
      const tmp = `${destino}.tmp.webm`;
      log(`Convirtiendo ${fichero} a WebM para el diseño…`);
      const ok = await new Promise((fin) => {
        rutaFfmpeg().then((bin) => {
          const p = spawn(bin, ['-hide_banner', '-loglevel', 'error', '-y', '-i', origen, '-t', '120', '-vf', "scale='min(1080,iw)':-2", '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '4M', '-an', tmp], { windowsHide: true });
          p.on('error', () => fin(false));
          p.on('close', (code) => fin(code === 0));
        }).catch(() => fin(false));
      });
      if (ok) renameSync(tmp, destino); else rmSync(tmp, { force: true });
    }
  }

  async function enrutar(route, kit, html) {
    const url = route.request().url();
    if (FUERA_PERMITIDO.test(url)) return route.continue();
    if (!url.startsWith(ORIGEN + '/')) return route.abort('blockedbyclient');
    const ruta = decodeURIComponent(new URL(url).pathname);
    if (ruta === '/diapositiva.html') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    if (ruta === '/recursos/gsap.min.js') return servirArchivo(route, GSAP);
    const deArchivos = /^\/api\/contenido\/archivos\/(\d{4}-\d{2})\/([^/]+)$/.exec(ruta);
    if (deArchivos && archivos) {
      let abs = null;
      try { abs = archivos.ruta(`${deArchivos[1]}/${deArchivos[2]}`); } catch { /* ruta no válida */ }
      const webm = webmDe(deArchivos[1], deArchivos[2]);
      if (webm && /\.(mp4|m4v|mov|mkv)$/i.test(deArchivos[2]) && existsSync(webm)) return servirArchivo(route, webm);
      if (abs && existsSync(abs)) return servirArchivo(route, abs);
    }
    if (ruta.startsWith('/kit/')) {
      const abs = kitApi.archivo(kit, ruta.slice(5));
      if (abs) return servirArchivo(route, abs);
    }
    return route.fulfill({ status: 404, body: 'no encontrado' });
  }

  // Abre la diapositiva n y llama a fn(page, carga) con todo ya cargado
  async function conDiapositiva(kit, diseno, n, fn) {
    const { ancho, alto } = FORMATOS[diseno.formato];
    const nav = await obtenerNavegador();
    const ctx = await nav.newContext({ viewport: { width: ancho, height: alto }, deviceScaleFactor: 1, serviceWorkers: 'block' });
    try {
      const html = paginaDiapositiva(kit, diseno, n);
      await ctx.route('**/*', (r) => enrutar(r, kit, html).catch(() => r.abort().catch(() => {})));
      const page = await ctx.newPage();
      await page.goto(`${ORIGEN}/diapositiva.html`, { waitUntil: 'load', timeout: 90_000 });
      const carga = await page.evaluate((limite) => window.__listo(limite), kit.duracion);
      return await fn(page, carga);
    } finally {
      await ctx.close().catch(() => {});
    }
  }

  const zonaDe = (kit, diseno) => (diseno.formato === 'story' ? kit.zonaStory || [250, 300] : null);

  function avisosDe(n, carga, revision, kit) {
    const lista = [...carga.problemas, ...carga.errores.map((e) => `Error en la animación: ${e}`), ...revision];
    if (carga.tarde.length) lista.push(`Hay una animación que empieza a los ${Math.min(...carga.tarde).toFixed(1)} s: la diapositiva dura ${kit.duracion} s y casi no se verá`);
    return lista.map((texto) => ({ diapositiva: n, texto }));
  }

  // Fotograma final de cada diapositiva en JPG + revisión de calidad
  function previsualizar(diseno, { calidad = 82 } = {}) {
    return enCola(async () => {
      const kit = kitApi.leer();
      const d = normalizarDiseno(diseno, kit);
      await prepararVideos(d);
      const imagenes = [];
      const avisos = [];
      try {
        for (let n = 1; n <= d.slides.length; n++) {
          await conDiapositiva(kit, d, n, async (page, carga) => {
            await page.evaluate((t) => window.__seek(t), kit.duracion);
            const revision = await page.evaluate((z) => window.__revisar(z), zonaDe(kit, d));
            imagenes.push(await page.screenshot({ type: 'jpeg', quality: calidad }));
            avisos.push(...avisosDe(n, carga, revision, kit));
          });
        }
      } finally {
        soltarNavegador();
      }
      return { imagenes, avisos, diseno: d };
    });
  }

  // Archivos finales: un JPG o un MP4 por diapositiva. Devuelve [{ nombre, mime, buffer | ruta }];
  // las rutas de los MP4 son temporales: quien llama las guarda y las borra con limpiar().
  function exportar(diseno, tipo, { alProgreso = () => {} } = {}) {
    return enCola(async () => {
      const kit = kitApi.leer();
      const d = normalizarDiseno(diseno, kit);
      await prepararVideos(d);
      const total = d.slides.length;
      const salida = [];
      const tmp = tipo === 'mp4' ? mkdtempSync(path.join(os.tmpdir(), 'jarvis-diseno-')) : null;
      const ffmpeg = tipo === 'mp4' ? await rutaFfmpeg() : null;
      try {
        for (let n = 1; n <= total; n++) {
          const nombre = `${String(n).padStart(2, '0')}`;
          await conDiapositiva(kit, d, n, async (page) => {
            if (tipo !== 'mp4') {
              await page.evaluate((t) => window.__seek(t), kit.duracion);
              salida.push({ nombre: `slide-${nombre}.jpg`, mime: 'image/jpeg', buffer: await page.screenshot({ type: 'jpeg', quality: 92 }) });
              alProgreso({ diapositiva: n, total, avance: n / total });
              return;
            }
            const ruta = path.join(tmp, `slide-${nombre}.mp4`);
            const fotogramas = Math.round(kit.duracion * kit.fps);
            await grabarVideo(page, { ffmpeg, ruta, fps: kit.fps, fotogramas, alFotograma: (f) => {
              if (f % 15 === 0) alProgreso({ diapositiva: n, total, avance: (n - 1 + f / fotogramas) / total });
            } });
            salida.push({ nombre: `slide-${nombre}.mp4`, mime: 'video/mp4', ruta });
          });
        }
        alProgreso({ diapositiva: total, total, avance: 1 });
        return { archivos: salida, diseno: d, limpiar: () => tmp && rmSync(tmp, { recursive: true, force: true }) };
      } catch (e) {
        if (tmp) rmSync(tmp, { recursive: true, force: true });
        throw e;
      } finally {
        soltarNavegador();
      }
    });
  }

  async function cerrar() {
    clearTimeout(temporizador);
    const n = navegador; navegador = null;
    await n?.close().catch(() => {});
  }

  return { previsualizar, exportar, cerrar, preparar };
}

// Fotograma a fotograma: ir al instante, capturar y pasárselo a ffmpeg (H.264, yuv420p, faststart, sin audio)
async function grabarVideo(page, { ffmpeg, ruta, fps, fotogramas, alFotograma }) {
  const proc = spawn(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(fps), '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(fps), '-movflags', '+faststart', '-an', ruta],
  { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
  let errores = '';
  proc.stderr.on('data', (b) => { errores += b; });
  const terminado = new Promise((resolve, reject) => {
    proc.on('error', (e) => reject(new Error(e.code === 'ENOENT' ? 'No encuentro ffmpeg para crear los vídeos: ejecuta  npm install  en la carpeta de JARVIS' : e.message)));
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg no ha podido crear el vídeo: ${errores.trim().slice(-300) || `código ${code}`}`))));
  });
  terminado.catch(() => {});
  const escribir = (buf) => new Promise((resolve, reject) => {
    if (proc.stdin.destroyed) return reject(new Error('ffmpeg se ha cerrado'));
    proc.stdin.write(buf, (e) => (e ? reject(e) : resolve()));
  });
  try {
    for (let f = 0; f < fotogramas; f++) {
      await page.evaluate((t) => window.__seek(t), f / fps);
      await escribir(await page.screenshot({ type: 'jpeg', quality: 95 }));
      alFotograma(f);
    }
  } catch (e) {
    proc.kill();
    await terminado.catch(() => {});
    throw e;
  }
  proc.stdin.end();
  await terminado;
}
