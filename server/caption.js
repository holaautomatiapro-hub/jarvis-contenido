import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { ROOT } from './config.js';
import { transcribir as transcribirElevenLabs, sttConfigurado } from './stt.js';
import { rutaFfmpeg } from './diseno/motor.js';


// Caption con IA al crear o programar un post: Claude lo escribe con la voz de la persona (_voz.md), su
// negocio (CLAUDE.md), las reglas de caption de su sistema de diseño y lo que se sepa de la pieza.

export class CaptionError extends Error {
  constructor(m) { super(m); this.publico = true; }
}

const MAX_CAPTION = 2200;
const recortar = (v, n) => String(v ?? '').trim().slice(0, n);

export function promptCaption(d = {}, contexto = {}) {
  const titulo = recortar(d.titulo, 200);
  const nota = recortar(d.nota, 300);
  const actual = recortar(d.caption, 3000);
  const indicaciones = recortar(d.indicaciones, 1000);
  const trans = Array.isArray(contexto.transcripciones) ? contexto.transcripciones : [];
  const imgs = Array.isArray(contexto.imagenes) ? contexto.imagenes : [];
  if (!titulo && !nota && !actual && !indicaciones && !trans.length && !imgs.length) throw new CaptionError('Ponle antes un título (o di de qué va) para que JARVIS sepa qué escribir');
  const formato = recortar(d.formato, 40) || 'publicación';
  const palabra = recortar(d.palabra, 30).toUpperCase().replace(/[^A-ZÁÉÍÓÚÜÑ0-9]/g, '');
  const lm = d.leadmagnet ? (/^https?:\/\//i.test(String(d.leadmagnet_url || '')) ? `sí (${recortar(d.leadmagnet_url, 300)})` : 'sí') : null;
  const archivos = (Array.isArray(d.archivos) ? d.archivos : []).map((a) => recortar(a?.nombre || a, 80)).filter(Boolean).slice(0, 10);

  return `Escribe el caption de Instagram de esta publicación.
Tipo: ${formato}
${titulo ? `Título / tema: ${titulo}\n` : ''}${nota ? `Guion: lee la nota ${nota} con leer_nota.\n` : ''}${archivos.length ? `Archivos: ${archivos.join(', ')}\n` : ''}${lm ? `Lleva lead magnet: ${lm}. El cierre es «Comenta **${palabra || 'PALABRA'}** y te lo envío» (${palabra ? 'esa palabra exacta' : 'elige una palabra clave corta en mayúsculas que encaje'}).\n` : palabra ? `Palabra clave para el cierre: ${palabra}.\n` : ''}${trans.length ? `Lo que se dice en el vídeo (transcripción automática; puede tener alguna palabra mal):\n${trans.map((t) => `"""\n${t.texto}\n"""`).join('\n')}\n` : ''}${imgs.length ? `Mira con Read, en orden, ${imgs.some((f) => /fotograma/.test(f)) ? 'estos fotogramas del vídeo (para ver el título y el texto en pantalla)' : 'estas imágenes (las slides del carrusel: lee el título y el texto de cada una)'}:\n${imgs.map((f) => `- ${f}`).join('\n')}\n` : ''}${actual ? `Caption que ya tengo (úsalo de base y mejóralo; no lo copies tal cual):\n"""\n${actual}\n"""\n` : ''}${indicaciones ? `Indicaciones: ${indicaciones}\n` : ''}
Antes de escribir:
- Lee _voz.md (mi forma de escribir) y CLAUDE.md (mi negocio y a quién me dirijo).
- Si existe _diseno/kit.json, lee su guía (el archivo que indica "guia") en lo que diga de captions, palabra clave y cierres, y síguelo.
Cómo:
${trans.length || imgs.length ? '- El caption sale de ESTE contenido: usa sus ideas, sus ejemplos, sus cifras y sus frases concretas (no inventes nada que no esté). El gancho, de lo más potente que se dice o se ve. Nada genérico que valdría para cualquier post.\n' : ''}- Primera línea con gancho (se ve antes del «… más»). Párrafos cortos, frases cortas, español de España y tuteo.
- Emojis con moderación. Pon en **negrita** (con dos asteriscos) solo lo clave, como la palabra clave del cierre: al publicar se verá en negrita.
- Cierra con una llamada a la acción clara${lm ? ' (la del lead magnet)' : ''}. Hashtags: como mucho 3 y solo si encajan con mi forma de escribir.
- Nada de datos inventados. Menos de ${MAX_CAPTION} caracteres.
Responde SOLO con el caption, listo para pegar: sin títulos, sin comillas, sin explicaciones antes ni después.`;
}

// Lo que devuelve Claude, limpio: sin comillas o bloques alrededor y dentro del límite de Instagram
export function limpiarCaption(t) {
  let s = String(t ?? '').trim();
  s = s.replace(/^```[a-z]*\n?|\n?```$/g, '').trim();
  s = s.replace(/^(caption|aquí tienes[^:\n]*):\s*\n?/i, '').trim();
  if (/^["«“]/.test(s) && /["»”]$/.test(s)) s = s.slice(1, -1).trim();
  if (!s) throw new CaptionError('JARVIS no ha devuelto ningún caption. Vuelve a probar.');
  return s.slice(0, MAX_CAPTION);
}

// ---------- Lo que hay DENTRO de la pieza: para no escribir un caption genérico ----------
// Reels y vídeos: se transcriben (ElevenLabs si hay clave; si no, Whisper del Laboratorio) y se sacan un par de
// fotogramas para ver el título en pantalla. Carruseles y fotos: las imágenes se copian al vault para que
// Claude las lea (Read). Las transcripciones se guardan para no repetirlas.
const correr = (cmd, args, { timeout = 600_000, env } = {}) => new Promise((resolve) => {
  const p = spawn(cmd, args, { windowsHide: true, env: env ? { ...process.env, ...env } : process.env });
  let out = '', err = '';
  const reloj = setTimeout(() => p.kill('SIGKILL'), timeout);
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
  p.on('error', (e) => { clearTimeout(reloj); resolve({ ok: false, out, err: e.message }); });
  p.on('close', (c) => { clearTimeout(reloj); resolve({ ok: c === 0, out, err }); });
});

export function createContextoCaption({ archivos, vaultPath, env = process.env, python = () => null, ffmpeg = rutaFfmpeg, transcribirImpl = null, whisperScript = path.join(ROOT, 'laboratorio', 'transcribir-audio.py') }) {
  const cache = path.join(path.resolve(vaultPath), '.jarvis', 'transcripciones');
  const imagenesDir = path.join(path.resolve(vaultPath), '.jarvis', 'caption');

  async function transcribirVideo(abs) {
    const st = statSync(abs);
    const clave = createHash('sha1').update(`${abs}:${st.size}:${st.mtimeMs}`).digest('hex').slice(0, 20);
    const guardada = path.join(cache, `${clave}.txt`);
    if (existsSync(guardada)) return { texto: readFileSync(guardada, 'utf8'), de: 'guardada' };
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'jarvis-audio-'));
    try {
      const bin = await ffmpeg();
      const audio = path.join(tmp, 'audio.mp3');
      const r = await correr(bin, ['-v', 'error', '-y', '-i', abs, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', audio], { timeout: 300_000 });
      if (!r.ok || !existsSync(audio)) return { texto: '', aviso: 'el vídeo no tiene audio o no se ha podido leer' };
      let texto = '', de = '';
      if (transcribirImpl) { texto = await transcribirImpl(audio); de = 'prueba'; }
      else if (sttConfigurado(env)) { texto = await transcribirElevenLabs(readFileSync(audio), { nombre: 'audio.mp3', tipo: 'audio/mpeg', env }); de = 'ElevenLabs'; }
      else if (python()) {
        const w = await correr(python(), [whisperScript, audio], { timeout: 900_000, env: { PYTHONIOENCODING: 'utf-8' } });
        if (!w.ok) return { texto: '', aviso: `no se ha podido transcribir con Whisper (${w.err.trim().split('\n').pop() || 'error'})` };
        texto = w.out.trim(); de = 'Whisper';
      } else return { texto: '', aviso: 'no hay con qué transcribir: pon la clave de ElevenLabs (npm run claves) o prepara el Laboratorio en el VPS' };
      if (texto) { mkdirSync(cache, { recursive: true }); writeFileSync(guardada, texto); }
      return { texto, de };
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  }

  // Dos fotogramas (al principio y a la mitad) para ver el título o el texto en pantalla del reel
  async function fotogramas(abs, destino, base) {
    const bin = await ffmpeg();
    // La duración, de lo que dice ffmpeg al abrirlo (ffprobe no siempre está)
    const info = await correr(bin, ['-hide_banner', '-i', abs], { timeout: 30_000 });
    const m = info.err.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
    const segundos = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
    const momentos = segundos ? [Math.min(1.2, segundos / 4), segundos / 2] : [1];
    const out = [];
    for (const [i, t] of momentos.entries()) {
      const f = path.join(destino, `${base}-fotograma-${i + 1}.jpg`);
      const r = await correr(bin, ['-v', 'error', '-y', '-ss', t.toFixed(2), '-i', abs, '-frames:v', '1', '-vf', 'scale=720:-2', f], { timeout: 60_000 });
      if (r.ok && existsSync(f)) out.push(f);
    }
    return out;
  }

  async function preparar(lista = []) {
    const medios = (Array.isArray(lista) ? lista : []).filter((a) => a?.path && /^(image|video)\//.test(String(a.mime || ''))).slice(0, 12);
    const res = { transcripciones: [], imagenes: [], avisos: [] };
    if (!medios.length || !archivos) return res;
    const id = createHash('sha1').update(medios.map((a) => a.path).join('|')).digest('hex').slice(0, 12);
    const destino = path.join(imagenesDir, id);
    rmSync(destino, { recursive: true, force: true });
    mkdirSync(destino, { recursive: true });
    // Limpieza: solo se guardan las de las últimas peticiones
    try {
      const viejas = readdirSync(imagenesDir).filter((x) => x !== id).map((d) => ({ d, t: statSync(path.join(imagenesDir, d)).mtimeMs })).sort((a, b) => b.t - a.t).slice(20);
      for (const { d } of viejas) rmSync(path.join(imagenesDir, d), { recursive: true, force: true });
    } catch { /* nada */ }
    for (const [i, a] of medios.entries()) {
      let abs;
      try { abs = archivos.ruta(a.path); } catch { continue; }
      if (!existsSync(abs)) continue;
      const n = String(i + 1).padStart(2, '0');
      if (/^video\//.test(a.mime)) {
        try {
          const t = await transcribirVideo(abs);
          if (t.texto) res.transcripciones.push({ nombre: a.nombre || path.basename(abs), texto: t.texto.slice(0, 12_000), de: t.de });
          else if (t.aviso) res.avisos.push(`${a.nombre || 'vídeo'}: ${t.aviso}`);
        } catch (e) { res.avisos.push(`${a.nombre || 'vídeo'}: no se ha podido transcribir (${e.message})`); }
        try { res.imagenes.push(...(await fotogramas(abs, destino, n))); } catch { /* sin fotogramas */ }
      } else {
        const f = path.join(destino, `${n}${path.extname(abs).toLowerCase() || '.jpg'}`);
        copyFileSync(abs, f);
        res.imagenes.push(f);
      }
    }
    return res;
  }

  return { preparar, transcribirVideo };
}
