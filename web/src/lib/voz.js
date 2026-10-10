// Voz en el navegador: reconocimiento (Web Speech API, Chrome/Edge) y reproducción de la respuesta.

const Reconocimiento = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
export const reconocimientoDisponible = Boolean(Reconocimiento);

// Escucha una frase y llama a onParcial (mientras hablas) y onFinal (al terminar).
export function escuchar({ onParcial, onFinal, onError, onFin }) {
  if (!Reconocimiento) { onError?.('Tu navegador no reconoce voz. Usa Chrome o Edge.'); return { parar() {} }; }
  const r = new Reconocimiento();
  r.lang = 'es-ES';
  r.interimResults = true;
  r.continuous = false;
  r.maxAlternatives = 1;
  let final = '';
  r.onresult = (e) => {
    let parcial = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) final += e.results[i][0].transcript;
      else parcial += e.results[i][0].transcript;
    }
    onParcial?.((final + parcial).trim());
  };
  r.onerror = (e) => {
    const msg = { 'not-allowed': 'Permite el micrófono en el navegador para hablar con JARVIS.', 'no-speech': 'No te he oído. Prueba otra vez.', network: 'El reconocimiento de voz necesita conexión a internet.' }[e.error];
    onError?.(msg || `Error de micrófono (${e.error})`);
  };
  r.onend = () => { if (final.trim()) onFinal?.(final.trim()); onFin?.(); };
  r.start();
  return { parar: () => r.stop() };
}

let audioActual = null;

// Lee el texto con ElevenLabs (a través del servidor). Si no está configurado, usa la voz del navegador.
export async function hablar(texto, { elevenlabs = true, onInicio, onFin } = {}) {
  callar();
  try {
    if (!elevenlabs) throw Object.assign(new Error('sin ElevenLabs'), { status: 501 });
    const r = await fetch('/api/voz/hablar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ texto }) });
    if (!r.ok) throw Object.assign(new Error((await r.json().catch(() => ({}))).error || 'voz'), { status: r.status });
    const url = URL.createObjectURL(await r.blob());
    audioActual = new Audio(url);
    audioActual.onplay = () => onInicio?.();
    audioActual.onended = audioActual.onerror = () => { URL.revokeObjectURL(url); audioActual = null; onFin?.(); };
    await audioActual.play();
    return 'elevenlabs';
  } catch (e) {
    if (!('speechSynthesis' in window)) { onFin?.(); return null; }
    const u = new SpeechSynthesisUtterance(limpiar(texto).slice(0, 900));
    u.lang = 'es-ES';
    const es = speechSynthesis.getVoices().find((v) => v.lang?.startsWith('es-ES')) || speechSynthesis.getVoices().find((v) => v.lang?.startsWith('es'));
    if (es) u.voice = es;
    u.onstart = () => onInicio?.();
    u.onend = u.onerror = () => onFin?.();
    speechSynthesis.speak(u);
    return e.status === 501 ? 'navegador' : 'navegador (ElevenLabs falló)';
  }
}

export function callar() {
  if (audioActual) { audioActual.pause(); audioActual.onended?.(); }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) speechSynthesis.cancel();
}

const limpiar = (t) => String(t).replace(/```[\s\S]*?```/g, ' ').replace(/[#*_`>~|]/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ');
