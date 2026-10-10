// Transcripción de audio/vídeo con ElevenLabs Speech-to-Text (Scribe).

export function sttConfigurado(env = process.env) {
  return Boolean(env.ELEVENLABS_API_KEY);
}

export async function transcribir(buffer, { nombre = 'reel.mp4', tipo = 'video/mp4', env = process.env, fetchImpl = fetch } = {}) {
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
    signal: AbortSignal.timeout(180000),
  });
  if (!r.ok) {
    const detalle = await r.text().catch(() => '');
    throw new Error(r.status === 401 ? 'La clave de ElevenLabs no es válida' : `ElevenLabs (transcripción) respondió ${r.status}${detalle ? `: ${detalle.slice(0, 160)}` : ''}`);
  }
  const data = await r.json();
  return String(data.text || '').trim();
}
