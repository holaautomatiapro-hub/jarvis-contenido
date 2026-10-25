// Fotos con IA con Kie AI (modelo nano-banana-pro), como en Claude Code: una escena en texto → foto fotorrealista.
// «Contigo»: se pasan tus fotos de referencia (las de Laboratorio → Imágenes → Mi cara, hasta 8) y un bloque de
// identidad para que salga tu cara tal cual. Las fotos se guardan en la biblioteca (carpeta «Fotos con IA») para usarlas
// en un diseño. La clave (KIE_API_KEY) se queda en el servidor y nunca sale en un error.
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { rutaFfmpeg } from './diseno/motor.js';
import { guardarEnv } from './env-archivo.js';

const SUBIR = 'https://kieai.redpandaai.co/api/file-base64-upload';
const CREAR = 'https://api.kie.ai/api/v1/jobs/createTask';
const INFO = 'https://api.kie.ai/api/v1/jobs/recordInfo';
const CREDITOS = 'https://api.kie.ai/api/v1/chat/credit';
export const MODELO_FOTOS = 'nano-banana-pro';
export const FORMATOS_FOTO = ['4:5', '1:1', '9:16', '16:9', '3:4', '2:3', '3:2'];
export const COSTE_FOTO_EUR = 0.12; // a 2K, aproximado
const MAX_REFERENCIAS = 8;
const CADUCAN_MS = 20 * 3600_000; // las subidas a Kie caducan a las 24 h
export const NOTA_IDENTIDAD = '_identidad-foto.md';

export class FotosIaError extends Error {
  constructor(m) { super(m); this.publico = true; }
}

// Lo que va delante de la escena cuando sales tú. Lo propio de cada persona (color de ojos, pelo, tatuajes…) va en la
// nota _identidad-foto.md del vault, no aquí.
export const IDENTIDAD_BASE = 'IDENTITY — the reference images are the definitive source for this person. Copy the face directly from them: facial structure, nose, mouth, jaw, cheekbones, hairline, hairstyle, facial hair, eyeglasses and body. Do not redesign any feature from imagination and do not blend them with a generic model. Someone who knows them must recognise them instantly.';
export const NEGATIVOS_CONMIGO = 'Photorealistic photograph. Not a cartoon, 3D render or illustration. No plastic or airbrushed skin, no toothy grin, no distorted hands, no extra fingers, no text, no watermark, and above all not a different person.';
export const ESTILO_SIN_PERSONA = 'Photorealistic editorial photo, natural light, shallow depth of field. No text, no words, no logos, no watermarks.';

export function promptFoto({ descripcion, conmigo, identidad = '' }) {
  const escena = String(descripcion || '').trim();
  if (!conmigo) return `${escena}${/[.!]$/.test(escena) ? '' : '.'} ${ESTILO_SIN_PERSONA}`;
  return [IDENTIDAD_BASE, identidad.trim(), `SCENE: ${escena}`, NEGATIVOS_CONMIGO].filter(Boolean).join('\n\n');
}

const sinClave = (texto, clave) => (clave ? String(texto).split(clave).join('••••') : String(texto));

// PNG (2K, ~7 MB) → JPG de calidad alta, más ligero para la biblioteca y los diseños
export async function aJpg(buf) {
  const ff = await rutaFfmpeg();
  return new Promise((ok, mal) => {
    const p = spawn(ff, ['-v', 'error', '-f', 'image2pipe', '-i', '-', '-frames:v', '1', '-q:v', '2', '-f', 'image2', '-c:v', 'mjpeg', '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const trozos = [];
    p.stdout.on('data', (d) => trozos.push(d));
    p.on('error', mal);
    p.on('close', (code) => (code === 0 && trozos.length ? ok(Buffer.concat(trozos)) : mal(new Error('No se pudo convertir la foto'))));
    p.stdin.on('error', () => {});
    p.stdin.end(buf);
  });
}

export function createFotosIa({ env = process.env, jarvis, archivos, ajustesDb, carpetaCara, fetchImpl = fetch, guardarClaves = (c) => guardarEnv(c), convertir = aJpg, esperaMs = 8000, primeraEsperaMs = 12_000, maxIntentos = 45, alCambiar = () => {}, log = () => {} }) {
  const trabajos = new Map();
  const clave = () => String(env.KIE_API_KEY || '').trim();
  const configurado = () => Boolean(clave());
  const maxDia = () => Number(env.KIE_MAX_FOTOS_DIA) || 30;
  const hoy = () => new Date().toLocaleDateString('sv-SE');

  function fotosCara() {
    if (!carpetaCara || !existsSync(carpetaCara)) return [];
    return readdirSync(carpetaCara).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort().slice(0, MAX_REFERENCIAS).map((f) => path.join(carpetaCara, f));
  }
  // Tus correcciones (color de ojos, pelo, barba, tatuajes…): nota _identidad-foto.md del vault, sin la cabecera ---
  function identidad() {
    try { return jarvis.vault.read(NOTA_IDENTIDAD).contenido.replace(/^---[\s\S]*?---\s*/, '').trim(); } catch { return ''; }
  }
  function uso() {
    const u = ajustesDb.leer('fotos_ia_uso', {});
    return u.dia === hoy() ? u.n || 0 : 0;
  }
  function estado() {
    const cara = fotosCara();
    return {
      configurado: configurado(), final: configurado() ? `••••${clave().slice(-4)}` : null, modelo: MODELO_FOTOS, referencias: cara.length, maxReferencias: MAX_REFERENCIAS,
      fotosCara: cara.map((f) => ({ nombre: path.basename(f), ruta: `imagenes/_mi-cara/${path.basename(f)}` })),
      identidad: Boolean(identidad()), identidadTexto: identidad(), hoy: uso(), maxDia: maxDia(), costeAprox: COSTE_FOTO_EUR,
    };
  }
  // Tus correcciones para que la cara salga bien (se guardan en la nota _identidad-foto.md del vault)
  function guardarIdentidad(texto) {
    const t = String(texto || '').trim().slice(0, 6000);
    jarvis.vault.write(NOTA_IDENTIDAD, `---\ntipo: identidad-foto\n---\n${t}\n`);
    return estado();
  }

  async function kie(url, opciones = {}) {
    let r;
    try {
      r = await fetchImpl(url, { ...opciones, headers: { authorization: `Bearer ${clave()}`, ...(opciones.body ? { 'content-type': 'application/json' } : {}), ...(opciones.headers || {}) }, signal: AbortSignal.timeout(120_000) });
    } catch (e) {
      throw new FotosIaError(`No he podido conectar con Kie AI (${sinClave(e.message, clave())})`);
    }
    let j = null;
    try { j = await r.json(); } catch { /* sin JSON */ }
    if (r.status === 401 || j?.code === 401) throw new FotosIaError('Kie AI no acepta la clave (KIE_API_KEY). Revísala con npm run claves.');
    if (r.status === 402 || j?.code === 402) throw new FotosIaError('No te quedan créditos en Kie AI.');
    if (!r.ok || (j && j.code && j.code !== 200)) throw new FotosIaError(`Kie AI respondió ${j?.code || r.status}: ${sinClave(j?.msg || j?.message || '', clave()).slice(0, 200)}`);
    return j || {};
  }

  // Sube tus fotos de referencia (se reutilizan 20 h: las subidas caducan a las 24 h)
  async function referencias() {
    const fotos = fotosCara();
    if (!fotos.length) throw new FotosIaError('Para salir tú hacen falta tus fotos de referencia: súbelas en Laboratorio → Imágenes → Mi cara (hasta 8: cara de frente, de perfil, de tres cuartos, medio cuerpo y cuerpo entero).');
    const huella = createHash('sha1').update(fotos.map((f) => `${path.basename(f)}:${statSync(f).size}:${statSync(f).mtimeMs}`).join('|')).digest('hex');
    const cache = ajustesDb.leer('kie_referencias', null);
    if (cache?.huella === huella && Date.now() - cache.t < CADUCAN_MS && cache.urls?.length) return cache.urls;
    const urls = [];
    for (const f of fotos) {
      const mime = /\.png$/i.test(f) ? 'image/png' : /\.webp$/i.test(f) ? 'image/webp' : 'image/jpeg';
      const j = await kie(SUBIR, { method: 'POST', body: JSON.stringify({ base64Data: `data:${mime};base64,${readFileSync(f).toString('base64')}`, uploadPath: 'images/jarvis-referencias', fileName: path.basename(f) }) });
      const url = j.data?.downloadUrl || j.data?.fileUrl || j.data?.url;
      if (!url) throw new FotosIaError(`Kie AI no ha devuelto la dirección de ${path.basename(f)}`);
      urls.push(url);
    }
    ajustesDb.guardar('kie_referencias', { huella, t: Date.now(), urls });
    return urls;
  }

  async function esperarTarea(taskId) {
    await new Promise((r) => setTimeout(r, primeraEsperaMs));
    for (let i = 0; i < maxIntentos; i++) {
      const j = await kie(`${INFO}?taskId=${encodeURIComponent(taskId)}`);
      const d = j.data || {};
      const st = String(d.state || d.status || '').toLowerCase();
      if (['success', 'succeeded', 'completed'].includes(st)) {
        let res = d.resultJson || d.result || {};
        if (typeof res === 'string') { try { res = JSON.parse(res); } catch { res = {}; } }
        const urls = res.resultUrls || (res.resultUrl ? [res.resultUrl] : []);
        if (!urls.length) throw new FotosIaError('Kie AI terminó sin devolver la foto');
        return urls;
      }
      if (['fail', 'failed', 'error'].includes(st)) throw new FotosIaError(`Kie AI no ha podido generar la foto: ${String(d.failMsg || d.failCode || 'error').slice(0, 200)}`);
      await new Promise((r) => setTimeout(r, esperaMs));
    }
    throw new FotosIaError('Kie AI está tardando demasiado; prueba otra vez en un rato');
  }

  async function trabajar(t) {
    try {
      const urlsRef = t.conmigo ? await referencias() : [];
      const prompt = promptFoto({ descripcion: t.descripcion, conmigo: t.conmigo, identidad: t.conmigo ? identidad() : '' });
      const tareas = [];
      for (let i = 0; i < t.cantidad; i++) {
        const j = await kie(CREAR, { method: 'POST', body: JSON.stringify({ model: MODELO_FOTOS, input: { prompt, ...(urlsRef.length ? { image_input: urlsRef } : {}), aspect_ratio: t.formato, resolution: '2K', output_format: 'png' } }) });
        const id = j.data?.taskId;
        if (!id) throw new FotosIaError('Kie AI no ha aceptado el encargo');
        tareas.push(id);
      }
      const resultados = await Promise.allSettled(tareas.map(esperarTarea));
      const guardados = [];
      let n = 0;
      for (const r of resultados) {
        if (r.status !== 'fulfilled') continue;
        for (const u of r.value) {
          const resp = await fetchImpl(u, { signal: AbortSignal.timeout(180_000) });
          if (!resp.ok) continue;
          const jpg = await convertir(Buffer.from(await resp.arrayBuffer()));
          n++;
          guardados.push(await archivos.guardar(Readable.from(jpg), { nombre: `${t.slug}-${n}.jpg`, mime: 'image/jpeg' }));
        }
      }
      if (!guardados.length) throw resultados.find((r) => r.status === 'rejected')?.reason || new FotosIaError('No ha salido ninguna foto');
      const pieza = jarvis.crearPieza({ titulo: `Foto IA: ${t.descripcion.slice(0, 80)}`, formato: 'Foto', estado: 'editar', archivos: guardados, carpeta: 'Fotos con IA', nota: null, origen: 'fotos-ia', origen_ref: `fotos-ia:${t.id}` });
      Object.assign(t, { estado: 'listo', fotos: guardados.map((g) => ({ url: g.url, nombre: g.nombre, ruta: archivos.ruta(g.path) })), pieza_id: pieza.id, fallidas: resultados.filter((r) => r.status === 'rejected').length });
    } catch (e) {
      Object.assign(t, { estado: 'error', error: e instanceof FotosIaError ? e.message : sinClave(`No se ha podido generar: ${e.message}`, clave()) });
      log(t.error);
    } finally {
      t.fin = Date.now();
      alCambiar();
    }
  }

  // Pegar la clave desde el panel (sin entrar al servidor): se comprueba con Kie y se guarda en el .env
  async function conectar({ clave: nueva } = {}) {
    const c = String(nueva || '').trim();
    if (!/^[A-Za-z0-9_-]{16,}$/.test(c)) throw new FotosIaError('Esa clave no parece de Kie AI (son letras y números, sin espacios)');
    let creditos = null;
    try {
      const r = await fetchImpl(CREDITOS, { headers: { authorization: `Bearer ${c}` }, signal: AbortSignal.timeout(20_000) });
      const j = await r.json().catch(() => null);
      if (r.status === 401 || j?.code === 401) throw new FotosIaError('Kie AI no acepta esa clave. Cópiala otra vez de kie.ai → API Key.');
      if (Number.isFinite(Number(j?.data))) creditos = Number(j.data);
    } catch (e) {
      if (e instanceof FotosIaError) throw e; // sin conexión: se guarda igual y se verá al generar
    }
    guardarClaves({ KIE_API_KEY: c });
    env.KIE_API_KEY = c;
    return { ...estado(), creditos };
  }

  function generar({ descripcion, formato = '4:5', conmigo = false, cantidad = 1 } = {}) {
    if (!configurado()) throw new FotosIaError('Falta la clave de Kie AI: en el servidor, cd ~/JARVIS && npm run claves (KIE_API_KEY) y reinicia JARVIS.');
    const desc = String(descripcion || '').trim();
    if (desc.length < 8) throw new FotosIaError('Describe la escena (dónde, qué hace, ropa, objetos, luz, tipo de foto)');
    if (!FORMATOS_FOTO.includes(formato)) throw new FotosIaError(`Formato no válido. Usa: ${FORMATOS_FOTO.join(', ')}`);
    const n = Math.min(4, Math.max(1, Math.round(Number(cantidad) || 1)));
    if (uso() + n > maxDia()) throw new FotosIaError(`Ya llevas ${uso()} fotos con IA hoy (máximo ${maxDia()}, KIE_MAX_FOTOS_DIA). Mañana se reinicia.`);
    ajustesDb.guardar('fotos_ia_uso', { dia: hoy(), n: uso() + n });
    const id = randomBytes(6).toString('hex');
    const slug = desc.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'foto';
    const t = { id, descripcion: desc.slice(0, 2000), formato, conmigo: Boolean(conmigo), cantidad: n, slug, estado: 'generando', inicio: Date.now(), fotos: [] };
    trabajos.set(id, t);
    for (const [k, v] of trabajos) if (v.fin && Date.now() - v.fin > 6 * 3600_000) trabajos.delete(k);
    trabajar(t);
    return { id, estado: t.estado, cantidad: n, costeAprox: Math.round(n * COSTE_FOTO_EUR * 100) / 100 };
  }

  function ver(id) {
    const t = trabajos.get(String(id));
    if (!t) throw new FotosIaError('No encuentro ese encargo de fotos');
    const { descripcion, formato, conmigo, cantidad, estado: e, fotos, pieza_id, error, fallidas, inicio } = t;
    return { id: t.id, descripcion, formato, conmigo, cantidad, estado: e, fotos, pieza_id, error, fallidas, segundos: Math.round(((t.fin || Date.now()) - inicio) / 1000) };
  }

  return { configurado, estado, conectar, guardarIdentidad, generar, ver };
}
