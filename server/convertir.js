import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createReadStream, mkdtempSync, rmSync } from 'node:fs';
import { rutaFfmpeg } from './diseno/motor.js';

// «Generar vídeo» / «Generar imagen» en la ficha de una pieza: saca la otra versión de su contenido para verla
// antes de cambiarla. Si la pieza sale de un diseño, se vuelve a exportar desde él (con su animación); si no,
// cada foto pasa a un vídeo corto con un zoom suave, o de cada vídeo se saca un fotograma. Nada cambia en la pieza
// hasta que la persona dice «Usar esta versión».

export class ConvertirError extends Error {
  constructor(m) { super(m); this.publico = true; }
}

const esImagen = (a) => /^image\//.test(a?.mime || '');
const esVideo = (a) => /^video\//.test(a?.mime || '');
const VERTICAL = ['Story', 'Reel', 'Short', 'Reel split', 'B-roll'];
const SEGUNDOS = 6;

function ffmpeg(args, { signal } = {}) {
  return new Promise((ok, ko) => {
    rutaFfmpeg().then((bin) => {
      let err = '';
      const p = spawn(bin, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true, signal });
      p.stderr.on('data', (d) => { err += d; });
      p.on('error', (e) => ko(new ConvertirError(e.code === 'ENOENT' ? 'No encuentro ffmpeg: ejecuta  npm install  en la carpeta de JARVIS' : e.name === 'AbortError' ? 'Parado' : e.message)));
      p.on('close', (c) => (c === 0 ? ok() : ko(new ConvertirError(`ffmpeg no ha podido convertirlo: ${err.trim().slice(-200)}`))));
    }).catch(ko);
  });
}

export function createConversiones({ jarvis, archivos, disenos = null, emitir = () => {}, alCambiar = () => {}, ff = ffmpeg }) {
  const enCurso = new Map(); // piezaId → { estado, a, inicio, progreso, archivos, error, diseno, huellas, solo, titulo }

  const vista = (pid) => {
    const c = enCurso.get(pid);
    if (!c) return null;
    const { estado, a, inicio, progreso, error, titulo } = c;
    return { pieza: pid, estado, a, inicio, progreso, error, titulo, archivos: c.archivos || [], deDiseno: Boolean(c.diseno) };
  };
  const avisar = (pid) => { emitir({ type: 'conversion', pieza: pid }); alCambiar(); };
  const borrarArchivos = (l) => { for (const a of l || []) if (a?.path) archivos.borrar(a.path); };

  // Qué se puede sacar de una pieza: «video» si son fotos, «imagen» si son vídeos
  function destinoDe(pieza) {
    const l = pieza.archivos || [];
    if (!l.length) return null;
    if (l.every(esImagen)) return 'video';
    if (l.every(esVideo)) return 'imagen';
    return null;
  }

  const PARADO = 'Parado';
  const siParado = (c) => { if (c.parado) throw new ConvertirError(PARADO); };

  async function desdeArchivos(pieza, a, c) {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'jarvis-convertir-'));
    const [w, h] = VERTICAL.includes(pieza.formato) ? [1080, 1920] : [1080, 1350];
    const salida = [];
    try {
      const o = { signal: c.abort.signal };
      for (const [i, f] of pieza.archivos.entries()) {
        siParado(c);
        const origen = archivos.ruta(f.path);
        const base = f.nombre.replace(/\.[^.]+$/, '') || `archivo-${i + 1}`;
        if (a === 'video') {
          const out = path.join(tmp, `${i}.mp4`);
          const fps = 30;
          await ff(['-loop', '1', '-i', origen, '-t', String(SEGUNDOS), '-vf',
            `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},zoompan=z='min(zoom+0.0006,1.08)':d=${SEGUNDOS * fps}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${w}x${h}:fps=${fps}`,
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', out], o);
          salida.push(await archivos.guardar(createReadStream(out), { nombre: `${base}.mp4`, mime: 'video/mp4' }));
        } else {
          const out = path.join(tmp, `${i}.jpg`);
          // Un fotograma del principio (al segundo, que el primero suele ser negro); si es muy corto, el primero
          try { await ff(['-ss', '1', '-i', origen, '-frames:v', '1', '-q:v', '2', out], o); } catch { siParado(c); await ff(['-i', origen, '-frames:v', '1', '-q:v', '2', out], o); }
          salida.push(await archivos.guardar(createReadStream(out), { nombre: `${base}.jpg`, mime: 'image/jpeg' }));
        }
        siParado(c);
        c.progreso = Math.round(((i + 1) / pieza.archivos.length) * 100);
        avisar(pieza.id);
      }
      return salida;
    } catch (e) {
      borrarArchivos(salida); // lo que ya se había hecho no se queda suelto
      throw e;
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  }

  function empezar(piezaId, { a: pedido } = {}) {
    const pid = Number(piezaId);
    const pieza = jarvis.leerPieza(pid);
    if (!pieza) throw new ConvertirError('Esa pieza ya no está');
    if (enCurso.get(pid)?.estado === 'haciendo') throw new ConvertirError('Ya se está sacando otra versión de esta pieza');
    const a = pedido || destinoDe(pieza);
    if (!a) throw new ConvertirError(pieza.archivos?.length ? 'Tiene fotos y vídeos mezclados: deja solo fotos (para sacar el vídeo) o solo vídeos (para sacar la imagen)' : 'La pieza aún no tiene fotos ni vídeos');
    const previo = enCurso.get(pid);
    if (previo?.estado === 'listo') borrarArchivos(previo.archivos);
    const d = disenos?.deLaPieza(pid) || null;
    const solo = d && d.formato === 'story' ? [d.indice + 1] : null;
    const c = { estado: 'haciendo', a, inicio: Date.now(), progreso: 0, titulo: pieza.titulo, diseno: d?.id || null, solo, abort: new AbortController() };
    enCurso.set(pid, c);
    avisar(pid);
    (async () => {
      try {
        if (d) {
          const r = await disenos.otraVersion(d.id, a === 'video' ? 'mp4' : 'jpg', { solo, alProgreso: ({ avance }) => { siParado(c); const p = Math.round(avance * 100); if (p - c.progreso >= 5 || p === 100) { c.progreso = p; avisar(pid); } } });
          Object.assign(c, { archivos: r.archivos, huellas: r.huellas });
        } else {
          c.archivos = await desdeArchivos(pieza, a, c);
        }
        // Parado mientras se guardaba: lo hecho no se queda
        if (c.parado) { borrarArchivos(c.archivos); return; }
        c.estado = 'listo';
      } catch (e) {
        if (c.parado) return;
        Object.assign(c, { estado: 'error', error: e.message });
      }
      avisar(pid);
    })();
    return vista(pid);
  }

  // La pieza pasa a llevar la versión nueva (y su tipo, si cambia: un post en vídeo es un reel y al revés)
  function aceptar(piezaId) {
    const pid = Number(piezaId);
    const c = enCurso.get(pid);
    if (c?.estado !== 'listo') throw new ConvertirError('No hay ninguna versión lista para usar');
    const pieza = jarvis.leerPieza(pid);
    const viejos = pieza.archivos || [];
    const cambios = { archivos: c.archivos };
    if (c.a === 'video' && pieza.formato === 'Post') cambios.formato = 'Reel';
    if (c.a === 'imagen' && ['Reel', 'Short', 'B-roll'].includes(pieza.formato)) cambios.formato = c.archivos.length > 1 ? 'Carrusel' : 'Post';
    const r = jarvis.actualizarPieza(pid, cambios);
    if (c.diseno) disenos.aceptarOtraVersion(c.diseno, { tipo: c.a === 'video' ? 'mp4' : 'jpg', archivos: c.archivos, huellas: c.huellas, solo: c.solo });
    // Lo anterior se borra si ya no lo usa ninguna pieza
    const enUso = new Set(jarvis.listarPiezas().flatMap((p) => p.archivos.map((x) => x.path)));
    for (const a of viejos) if (a.path && !enUso.has(a.path)) archivos.borrar(a.path);
    enCurso.delete(pid);
    avisar(pid);
    return r;
  }

  function descartar(piezaId) {
    const pid = Number(piezaId);
    const c = enCurso.get(pid);
    if (c?.estado === 'haciendo') throw new ConvertirError('Espera a que termine');
    if (c) borrarArchivos(c.archivos);
    enCurso.delete(pid);
    avisar(pid);
    return { ok: true };
  }

  // Parar a medias (desde «Trabajando»): se corta ffmpeg o la exportación del diseño y no se queda nada
  function parar(piezaId) {
    const pid = Number(piezaId);
    const c = enCurso.get(pid);
    if (c?.estado !== 'haciendo') throw new ConvertirError('Ya ha terminado');
    c.parado = true;
    c.abort.abort();
    enCurso.delete(pid);
    avisar(pid);
    return { ok: true };
  }

  const estado = (piezaId) => vista(Number(piezaId));
  const trabajos = () => [...enCurso.keys()].map(vista).filter((v) => v.estado === 'haciendo');
  const listas = () => [...enCurso.keys()].map(vista).filter((v) => v.estado !== 'haciendo');

  return { empezar, aceptar, descartar, parar, estado, trabajos, listas, destinoDe };
}
