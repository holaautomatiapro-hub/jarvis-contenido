import path from 'node:path';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { rutaFfmpeg } from './diseno/motor.js';
import { ROOT } from './config.js';
import { sttConfigurado, transcribir as transcribirElevenLabs } from './stt.js';

// Adjuntos del chat: fotos y vídeos que la persona manda a JARVIS para que los tenga en cuenta (p. ej. al cambiar
// un carrusel). Se guardan en la biblioteca de archivos (así se pueden poner en un diseño con su url) y, para que
// Claude los «vea», se deja en el vault (.jarvis/adjuntos/) la foto o unos fotogramas del vídeo, y su transcripción.
// Lo mismo sirve para ver una pieza que ya está en la biblioteca (verPieza): p. ej. un carrusel hecho de vídeos,
// para replicar su diseño. Esos fotogramas van a .jarvis/vistas/.

const FOTOGRAMAS = 8;
const MAX_TRANSCRIBIR = 300 * 1024 ** 2; // más grande no se manda a transcribir
const MAX_TEXTO = 6000;
const MAX_VISTAS = 40; // fotogramas como mucho en una sola llamada a verPieza

// Ejecuta ffmpeg y devuelve lo que escribe en stderr (ahí dice la duración)
function ejecutar(bin, args) {
  return new Promise((ok, ko) => {
    let err = '';
    let p;
    try { p = spawn(bin, args, { windowsHide: true }); } catch (e) { ko(e); return; }
    p.stderr.on('data', (d) => { err += d; if (err.length > 200_000) err = err.slice(-100_000); });
    p.on('error', ko);
    p.on('close', (code) => ok({ code, err }));
  });
}
export const duracionDe = (stderr) => {
  const m = String(stderr).match(/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
};
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

export function createAdjuntos({ archivos, vaultPath, env = process.env, ffmpeg = rutaFfmpeg, sttImpl = transcribirElevenLabs, fetchImpl = fetch, python = () => null, whisperImpl = null, whisperScript = path.join(ROOT, 'laboratorio', 'transcribir-audio.py') }) {
  const base = path.join(vaultPath, '.jarvis', 'adjuntos');
  const vistas = path.join(vaultPath, '.jarvis', 'vistas');

  // n fotogramas repartidos por todo el vídeo (en uno corto, uno por segundo como mucho); final: además el último
  // (en un carrusel animado es la diapositiva ya montada del todo)
  async function fotogramas(origen, dir, { n = FOTOGRAMAS, final = false } = {}) {
    const bin = await ffmpeg();
    const info = await ejecutar(bin, ['-hide_banner', '-i', origen]).catch(() => null);
    if (!info) return { fotos: [], duracion: null, aviso: 'No encuentro ffmpeg: JARVIS no puede sacar fotogramas del vídeo' };
    const duracion = duracionDe(info.err);
    // Si ya se sacaron (o se sacaron menos de los que se piden ahora), se reaprovechan o se vuelven a sacar
    if (n > 0 && readdirSync(dir).filter((f) => /^\d{2}\.jpg$/.test(f)).length < n) {
      const fps = duracion ? Math.min(1, n / duracion) : 0.5;
      await ejecutar(bin, ['-hide_banner', '-loglevel', 'error', '-y', '-i', origen, '-vf', `fps=${fps.toFixed(4)},scale=720:-2`, '-frames:v', String(n), '-q:v', '4', path.join(dir, '%02d.jpg')]).catch(() => null);
    }
    const fotos = readdirSync(dir).filter((f) => /^\d{2}\.jpg$/.test(f)).sort().slice(0, n).map((f) => path.join(dir, f));
    if (final) {
      const fin = path.join(dir, 'final.jpg');
      if (!existsSync(fin)) {
        await ejecutar(bin, ['-hide_banner', '-loglevel', 'error', '-y', '-sseof', '-0.3', '-i', origen, '-vf', 'scale=720:-2', '-frames:v', '1', '-q:v', '3', fin]).catch(() => null);
        // Si el vídeo es muy corto para buscar desde el final, el último fotograma que se pueda
        if (!existsSync(fin)) await ejecutar(bin, ['-hide_banner', '-loglevel', 'error', '-y', '-i', origen, '-vf', 'scale=720:-2', '-update', '1', '-q:v', '3', fin]).catch(() => null);
      }
      if (existsSync(fin)) fotos.push(fin);
    }
    return { fotos, duracion, aviso: fotos.length ? null : 'No he podido sacar fotogramas del vídeo' };
  }

  // Whisper en este ordenador (el que instala el Laboratorio): gratis, sin internet; más lento que ElevenLabs
  const whisperDisponible = () => Boolean(whisperImpl || python());
  function whisper(ruta) {
    if (whisperImpl) return whisperImpl(ruta);
    return new Promise((ok, ko) => {
      let out = '', err = '';
      let p;
      try { p = spawn(python(), [whisperScript, ruta], { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }); } catch (e) { ko(e); return; }
      const reloj = setTimeout(() => p.kill('SIGKILL'), 45 * 60_000);
      p.stdout.on('data', (d) => { out += d; });
      p.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
      p.on('error', (e) => { clearTimeout(reloj); ko(e); });
      p.on('close', (c) => { clearTimeout(reloj); if (c === 0) ok(out.trim()); else ko(new Error(err.trim().split('\n').pop() || `Whisper ha fallado (código ${c})`)); });
    });
  }

  // Se transcribe solo el audio (mucho más ligero que el vídeo, y así cabe una entrevista larga); si no se puede
  // sacar, el vídeo tal cual. Primero ElevenLabs (rápido) y, si falla o no hay clave, Whisper (gratis); con
  // JARVIS_TRANSCRIPCION=whisper, al revés. dir: dónde dejar el audio y el texto (se reaprovechan la próxima vez)
  // rapido: solo ElevenLabs (al subir un adjunto no se puede esperar a Whisper)
  async function transcribir(origen, a, r, dir, { rapido = false } = {}) {
    const guardada = path.join(dir, 'transcripcion.txt');
    if (existsSync(guardada)) { r.transcripcion = readFileSync(guardada, 'utf8') || null; r.yaEstaba = true; return; }
    const motores = [
      sttConfigurado(env) && { de: 'ElevenLabs', fn: (f) => {
        if (statSync(f.ruta).size > MAX_TRANSCRIBIR) throw new Error('el vídeo es demasiado grande');
        return sttImpl(readFileSync(f.ruta), { nombre: f.nombre, tipo: f.tipo, env, fetchImpl });
      } },
      !rapido && whisperDisponible() && { de: 'Whisper', fn: (f) => whisper(f.ruta) },
    ].filter(Boolean);
    const conWhisper = rapido && whisperDisponible() && a.url ? ` Para transcribirlo gratis con Whisper (tarda unos minutos): transcribir_video con url ${a.url}` : '';
    if (env.JARVIS_TRANSCRIPCION === 'whisper') motores.reverse();
    if (!motores.length) { r.avisos.push(conWhisper ? `Sin clave de ElevenLabs no se transcribe al subirlo.${conWhisper}` : 'No hay con qué transcribir: pon la clave de ElevenLabs (npm run claves) o prepara el Laboratorio en el VPS (trae Whisper, gratis)'); return; }
    let fuente = { ruta: origen, nombre: a.nombre, tipo: a.mime };
    const audio = path.join(dir, 'audio.mp3');
    if (!existsSync(audio)) {
      const bin = await ffmpeg().catch(() => null);
      if (bin) await ejecutar(bin, ['-hide_banner', '-loglevel', 'error', '-y', '-i', origen, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', audio]).catch(() => null);
    }
    if (existsSync(audio) && statSync(audio).size > 0) fuente = { ruta: audio, nombre: 'audio.mp3', tipo: 'audio/mpeg' };
    const fallos = [];
    for (const m of motores) {
      try {
        r.transcripcion = (await m.fn(fuente)) || null;
        if (r.transcripcion) { r.de = m.de; break; }
        fallos.push(`${m.de}: no ha sacado texto (¿el vídeo no tiene voz?)`);
      } catch (e) { fallos.push(`${m.de}: ${e.message}`); }
    }
    if (r.transcripcion) writeFileSync(guardada, r.transcripcion); // la próxima vez no se vuelve a hacer
    else r.avisos.push(`No se ha podido transcribir. ${fallos.join(' · ')}${conWhisper}`);
  }

  // a: lo que devuelve archivos.guardar. Devuelve lo que necesita Claude para tenerlo en cuenta.
  async function preparar(a) {
    const origen = archivos.ruta(a.path);
    const dir = path.join(base, path.basename(a.path).replace(/\.[^.]+$/, '').replace(/[^\w-]/g, '_'));
    mkdirSync(dir, { recursive: true });
    const r = { nombre: a.nombre, url: a.url, mime: a.mime, tipo: a.mime.startsWith('video/') ? 'video' : 'foto', fotogramas: [], transcripcion: null, duracion: null, avisos: [] };
    if (r.tipo === 'foto') {
      const copia = path.join(dir, `foto${path.extname(origen) || '.jpg'}`);
      copyFileSync(origen, copia);
      r.fotogramas = [copia];
      return r;
    }
    const f = await fotogramas(origen, dir);
    Object.assign(r, { fotogramas: f.fotos, duracion: f.duracion });
    if (f.aviso) r.avisos.push(f.aviso);
    await transcribir(origen, a, r, dir, { rapido: true });
    return r;
  }

  // Carpeta de cada archivo de una pieza en .jarvis/vistas (fotogramas, audio y transcripción, para reaprovecharlos)
  const dirVista = (pieza, num, a) => {
    const dir = path.join(vistas, String(pieza.id), `${String(num).padStart(2, '0')}-${path.basename(a.path).replace(/\.[^.]+$/, '').replace(/[^\w-]/g, '_')}`);
    mkdirSync(dir, { recursive: true });
    return dir;
  };

  // Lo que se dice en los vídeos de una pieza (una entrevista, un reel…). diapositiva: solo ese archivo (desde 1)
  async function transcribirPieza(pieza, { diapositiva = null } = {}) {
    const lista = (pieza.archivos || []).map((a, i) => ({ a, n: i + 1 })).filter((x) => x.a.mime?.startsWith('video/') && (!diapositiva || x.n === diapositiva));
    if (!lista.length) throw Object.assign(new Error(diapositiva ? `La diapositiva ${diapositiva} no es un vídeo` : 'La pieza no tiene vídeos que transcribir'), { publico: true });
    const salida = [];
    for (const { a, n } of lista) {
      let origen;
      try { origen = archivos.ruta(a.path); } catch { origen = null; }
      if (!origen || !existsSync(origen)) { salida.push({ n, nombre: a.nombre, aviso: 'El archivo ya no está en la biblioteca' }); continue; }
      const r = { n, nombre: a.nombre, transcripcion: null, avisos: [] };
      await transcribir(origen, a, r, dirVista(pieza, n, a));
      salida.push({ n, nombre: a.nombre, texto: r.transcripcion, ...(r.de ? { con: r.de } : {}), nueva: Boolean(r.transcripcion) && !r.yaEstaba, ...(r.avisos.length ? { aviso: r.avisos.join('; ') } : {}) });
    }
    return { pieza: { id: pieza.id, titulo: pieza.titulo, carpeta: pieza.carpeta || null }, transcripciones: salida };
  }

  // Un vídeo de la biblioteca por su url (p. ej. uno adjuntado al chat): /api/contenido/archivos/…
  async function transcribirVideo(url) {
    const rel = decodeURIComponent(String(url || '').replace(/^.*\/api\/contenido\/archivos\//, '').split(/[?#]/)[0]);
    let origen = null;
    try { origen = rel ? archivos.ruta(rel) : null; } catch { origen = null; }
    if (!origen || !existsSync(origen)) throw Object.assign(new Error('No encuentro ese vídeo en la biblioteca: pasa la url tal cual (/api/contenido/archivos/…)'), { publico: true });
    const dir = path.join(vistas, 'archivos', path.basename(rel).replace(/\.[^.]+$/, '').replace(/[^\w-]/g, '_'));
    mkdirSync(dir, { recursive: true });
    const r = { transcripcion: null, avisos: [] };
    await transcribir(origen, { nombre: path.basename(rel), mime: 'video/mp4' }, r, dir);
    if (!r.transcripcion) throw Object.assign(new Error(r.avisos[0] || 'No se ha podido transcribir'), { publico: true });
    return { url, texto: r.transcripcion, ...(r.de ? { con: r.de } : {}), nueva: !r.yaEstaba };
  }

  // Ver una pieza de la biblioteca: sus fotos (copiadas al vault) y, de cada vídeo, cómo queda al final (el
  // último fotograma) y, si se piden, fotogramas repartidos para ver la animación. diapositiva: solo esa (desde 1).
  async function verPieza(pieza, { diapositiva = null, fotogramas: n = null, transcribir: conTexto = false } = {}) {
    const lista = (pieza.archivos || []).map((a, i) => ({ a, n: i + 1 })).filter((x) => !diapositiva || x.n === diapositiva);
    if (!lista.length) throw Object.assign(new Error(diapositiva ? `La pieza no tiene la diapositiva ${diapositiva} (tiene ${pieza.archivos?.length || 0})` : 'La pieza no tiene fotos ni vídeos'), { publico: true });
    const videos = lista.filter((x) => x.a.mime?.startsWith('video/')).length;
    // Repartidos (además del final): por defecto ninguno al ver toda la pieza y 6 al ver una diapositiva
    const pedidos = n ?? (diapositiva ? 6 : 0);
    const porVideo = videos ? Math.max(0, Math.min(pedidos, Math.floor(MAX_VISTAS / videos) - 1, 12)) : 0;
    const salida = [];
    for (const { a, n: num } of lista) {
      let origen;
      try { origen = archivos.ruta(a.path); } catch { origen = null; }
      if (!origen || !existsSync(origen)) { salida.push({ n: num, nombre: a.nombre, aviso: 'El archivo ya no está en la biblioteca' }); continue; }
      const dir = dirVista(pieza, num, a);
      if (!a.mime?.startsWith('video/')) {
        const copia = path.join(dir, `foto${path.extname(origen) || '.jpg'}`);
        if (!existsSync(copia)) copyFileSync(origen, copia);
        salida.push({ n: num, nombre: a.nombre, tipo: 'foto', url: a.url, ver: [copia] });
        continue;
      }
      const f = await fotogramas(origen, dir, { n: porVideo, final: true });
      const r = { n: num, nombre: a.nombre, tipo: 'video', url: a.url, duracion: f.duracion ? Math.round(f.duracion * 10) / 10 : null, ver: f.fotos, avisos: f.aviso ? [f.aviso] : [] };
      if (conTexto) { await transcribir(origen, a, r, dir); delete r.yaEstaba; delete r.de; }
      if (!r.avisos.length) delete r.avisos;
      salida.push(r);
    }
    return {
      pieza: { id: pieza.id, titulo: pieza.titulo, formato: pieza.formato, carpeta: pieza.carpeta || null, diapositivas: pieza.archivos.length },
      como_verlo: porVideo
        ? 'Lee con Read cada ruta de «ver», en orden: en los vídeos, los fotogramas van del principio al final y el último (final.jpg) es cómo queda la diapositiva montada.'
        : 'Lee con Read cada ruta de «ver». En los vídeos es el último fotograma: cómo queda la diapositiva montada. Para ver cómo se anima una, vuelve a llamar con diapositiva y fotogramas.',
      archivos: salida,
    };
  }

  return { preparar, verPieza, transcribirPieza, transcribirVideo };
}

// El bloque que se añade al mensaje para Claude. La interfaz lo reconoce por «[Adjuntos]» y enseña solo los nombres.
export function textoAdjuntos(lista = []) {
  if (!lista.length) return '';
  const lineas = lista.map((a) => {
    if (a.tipo === 'foto') return `- Foto «${a.nombre}». Para verla: Read ${a.fotogramas[0]}. Para usarla en un diseño: ${a.url}`;
    const partes = [`- Vídeo «${a.nombre}»${a.duracion ? ` (${mmss(a.duracion)})` : ''}.`];
    if (a.fotogramas.length) partes.push(`Para verlo, sus fotogramas en orden (léelos con Read): ${a.fotogramas.join(', ')}.`);
    partes.push(`Para usarlo en un diseño (en <video src>): ${a.url}.`);
    if (a.transcripcion) partes.push(`Lo que se dice:\n"""\n${String(a.transcripcion).slice(0, MAX_TEXTO)}\n"""`);
    else if (a.avisos?.length) partes.push(`(${a.avisos.join('; ')})`);
    return partes.join(' ');
  });
  return `\n\n[Adjuntos]\nTenlos en cuenta para lo que te pido. Míralos antes de responder.\n${lineas.join('\n')}`;
}
