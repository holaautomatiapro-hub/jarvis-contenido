// Voz de JARVIS con ElevenLabs. La clave se queda en el servidor: el navegador solo recibe el audio.
import { errorElevenLabs } from './stt.js';

// Quita Markdown, enlaces y bloques de código para que suene natural, y lo recorta a un tamaño razonable.
export function textoParaVoz(md, max = 900) {
  let t = String(md || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/[*_~>|]/g, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/\.(\s*\.)+/g, '.')
    .trim();
  if (t.length > max) {
    const corte = t.slice(0, max);
    const fin = Math.max(corte.lastIndexOf('. '), corte.lastIndexOf('? '), corte.lastIndexOf('! '));
    t = (fin > max * 0.5 ? corte.slice(0, fin + 1) : corte.replace(/\s+\S*$/, '') + '…');
  }
  return t;
}

export function vozConfigurada(env = process.env) {
  return Boolean(env.ELEVENLABS_API_KEY && env.ELEVENLABS_VOICE_ID);
}

export async function sintetizar(texto, { env = process.env, fetchImpl = fetch } = {}) {
  if (!vozConfigurada(env)) {
    const e = new Error('ElevenLabs no está configurado');
    e.codigo = 'sin_voz';
    throw e;
  }
  const limpio = textoParaVoz(texto);
  if (!limpio) throw new Error('No hay texto que leer');
  const modelo = env.ELEVENLABS_MODEL || 'eleven_flash_v2_5';
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(env.ELEVENLABS_VOICE_ID)}/stream?output_format=mp3_44100_128`;
  const r = await fetchImpl(url, {
    method: 'POST',
    headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({
      text: limpio,
      model_id: modelo,
      // Solo los modelos v2.5 aceptan fijar el idioma; el resto lo detecta solo
      ...(/v2_5/.test(modelo) ? { language_code: 'es' } : {}),
      voice_settings: { stability: 0.45, similarity_boost: 0.8 },
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) {
    const detalle = await r.text().catch(() => '');
    throw new Error(errorElevenLabs(r.status, detalle, { permiso: 'Text to Speech', que: 'voz' }));
  }
  return Buffer.from(await r.arrayBuffer());
}
