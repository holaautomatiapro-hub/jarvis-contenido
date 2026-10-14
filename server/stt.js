// Transcripción de audio/vídeo con ElevenLabs Speech-to-Text (Scribe).

// ElevenLabs responde 401 tanto si la clave está mal como si le falta un permiso o se ha acabado el saldo:
// el motivo viene en detail.status, y es lo que hay que decir (si no, parece que la clave está mal)
export function errorElevenLabs(status, detalle, { permiso = 'Speech to Text', que = '' } = {}) {
  let d = null;
  try { d = JSON.parse(detalle)?.detail; } catch { /* no es JSON */ }
  const motivo = typeof d === 'object' && d ? String(d.status || '') : '';
  const mensaje = typeof d === 'object' && d ? String(d.message || '') : String(d || detalle || '');
  if (motivo === 'missing_permissions') return `La clave de ElevenLabs no tiene permiso de «${permiso}». En elevenlabs.io → Developers → API Keys, edita la clave y activa ${permiso} (o crea una sin restricciones).`;
  if (motivo === 'quota_exceeded' || /quota|credits/i.test(motivo)) return `Se han acabado los créditos de ElevenLabs: ${mensaje.slice(0, 160)}`;
  if (status === 401 && (motivo === 'invalid_api_key' || !motivo)) return 'La clave de ElevenLabs no es válida: comprueba que la has copiado entera (en el VPS: npm run claves).';
  return `ElevenLabs${que ? ` (${que})` : ''} respondió ${status}${mensaje ? `: ${mensaje.slice(0, 200)}` : ''}`;
}

export function sttConfigurado(env = process.env) {
  return Boolean(env.ELEVENLABS_API_KEY);
}

// alPalabras (opcional): recibe cada palabra con su tiempo, [inicio, fin, palabra] (para subtítulos)
export async function transcribir(buffer, { nombre = 'reel.mp4', tipo = 'video/mp4', env = process.env, fetchImpl = fetch, signal = null, alPalabras = null } = {}) {
  if (!sttConfigurado(env)) throw new Error('Para transcribir hace falta ELEVENLABS_API_KEY en .env');
  const form = new FormData();
  form.append('model_id', env.ELEVENLABS_STT_MODEL || 'scribe_v1');
  form.append('language_code', 'es');
  form.append('tag_audio_events', 'false');
  form.append('file', new Blob([buffer], { type: tipo }), nombre);
  const r = await fetchImpl('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': env.ELEVENLABS_API_KEY },
    body: form,
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(600_000)]) : AbortSignal.timeout(600_000), // una entrevista larga tarda
  });
  if (!r.ok) {
    const detalle = await r.text().catch(() => '');
    throw new Error(errorElevenLabs(r.status, detalle, { permiso: 'Speech to Text', que: 'transcripción' }));
  }
  const data = await r.json();
  if (alPalabras && Array.isArray(data.words)) alPalabras(data.words.filter((w) => w.type === 'word' && Number.isFinite(w.start)).map((w) => [w.start, w.end, String(w.text || '').trim()]));
  return String(data.text || '').trim();
}
