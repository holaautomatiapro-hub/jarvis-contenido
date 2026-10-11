// Reglas para publicar una pieza en Instagram con la API oficial. Las usan el dashboard (para avisar en vivo
// de lo que falta) y el publicador del servidor (para no mandar a Meta algo que va a rechazar).

export const MAX_CAPTION_IG = 2200;
const esVideo = (a) => /^video\//.test(a?.mime || '') || /\.(mp4|mov|m4v)$/i.test(a?.nombre || '');
const esJpg = (a) => /^image\/jpe?g$/.test(a?.mime || '') || /\.jpe?g$/i.test(a?.nombre || '');
const videoValido = (a) => /^video\/(mp4|quicktime)$/.test(a?.mime || '') || /\.(mp4|mov)$/i.test(a?.nombre || '');

// Tipo de publicación en Instagram según el formato de la pieza (y sus archivos)
export function tipoIg(p) {
  const f = String(p.formato || '').trim().toLowerCase();
  const archivos = p.archivos || [];
  if (f === 'story') return 'STORIES';
  if (f === 'carrusel') return 'CAROUSEL';
  if (['reel', 'reel split', 'b-roll', 'short'].includes(f)) return 'REELS';
  // Post (o sin formato): un vídeo se publica como reel; varias fotos, como carrusel
  if (archivos.length > 1) return 'CAROUSEL';
  return archivos[0] && esVideo(archivos[0]) ? 'REELS' : 'IMAGE';
}

export const NOMBRE_TIPO_IG = { IMAGE: 'foto', REELS: 'reel', CAROUSEL: 'carrusel', STORIES: 'story' };

// conFecha: si se programa (hace falta día y hora); para «Publicar ahora» no
export function planDePublicacion(p, { conFecha = true } = {}) {
  const problemas = [];
  const archivos = p.archivos || [];
  const tipo = tipoIg(p);
  const f = String(p.formato || '').trim().toLowerCase();
  if (conFecha && (!p.fecha || !p.hora)) problemas.push('Pon día y hora: es cuando se publicará.');
  if ((p.caption || '').length > MAX_CAPTION_IG) problemas.push(`El caption pasa de ${MAX_CAPTION_IG} caracteres.`);
  if (!archivos.length) problemas.push('Sube aquí el vídeo o la foto. Instagram necesita el archivo: un enlace de Drive no le sirve.');
  for (const a of archivos) {
    if (esVideo(a) && !videoValido(a)) problemas.push(`«${a.nombre}» tiene que ser MP4 o MOV.`);
    else if (!esVideo(a) && !esJpg(a)) problemas.push(`«${a.nombre}» no es JPG, y la API de Instagram solo admite JPG. Vuelve a subirla: JARVIS convierte las imágenes nuevas.`);
  }
  if (tipo === 'STORIES' && archivos.length > 1) problemas.push('Una story lleva un solo archivo. Haz una pieza por story.');
  if (tipo === 'CAROUSEL' && archivos.length && archivos.length < 2) problemas.push('Un carrusel necesita al menos 2 archivos.');
  if (tipo === 'CAROUSEL' && archivos.length > 10) problemas.push('Un carrusel admite como mucho 10 archivos.');
  if (tipo === 'REELS') {
    if (archivos.length > 1) problemas.push(f === 'post' || !f ? 'Un post lleva un solo archivo. Si son varios, cámbialo a carrusel.' : 'Un reel lleva un solo vídeo.');
    else if (archivos[0] && !esVideo(archivos[0])) problemas.push('Un reel necesita un vídeo.');
  }
  if (tipo === 'IMAGE' && archivos.length > 1) problemas.push('Un post lleva un solo archivo. Si son varios, cámbialo a carrusel.');
  return { tipo, problemas: [...new Set(problemas)] };
}

// Momento de publicación en la hora de este PC ("2026-10-20" + "18:30")
export const instanteDe = (p) => (p.fecha && p.hora ? new Date(`${p.fecha}T${p.hora}:00`) : null);
