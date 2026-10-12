// Redes para las que JARVIS prepara versiones de una pieza (las usan el servidor y el dashboard)
export const REDES = [
  { id: 'instagram_reel', nombre: 'Instagram Reel', corto: 'IG Reel', color: '#d6249f', grupo: 'Instagram' },
  { id: 'instagram_carrusel', nombre: 'Instagram Carrusel', corto: 'Carrusel', color: '#e1306c', grupo: 'Instagram' },
  { id: 'instagram_historia', nombre: 'Instagram Historias', corto: 'Historias', color: '#f77737', grupo: 'Instagram' },
  { id: 'tiktok', nombre: 'TikTok', corto: 'TikTok', color: '#25f4ee', grupo: 'TikTok' },
  { id: 'youtube_shorts', nombre: 'YouTube Shorts', corto: 'Shorts', color: '#ff0033', grupo: 'YouTube' },
  { id: 'linkedin', nombre: 'LinkedIn', corto: 'LinkedIn', color: '#0a66c2', grupo: 'LinkedIn' },
  { id: 'x', nombre: 'X (hilo)', corto: 'X', color: '#e7e9ea', grupo: 'X' },
  { id: 'threads', nombre: 'Threads', corto: 'Threads', color: '#b4b4b4', grupo: 'Threads' },
  { id: 'facebook', nombre: 'Facebook', corto: 'Facebook', color: '#1877f2', grupo: 'Facebook' },
  { id: 'pinterest', nombre: 'Pinterest', corto: 'Pinterest', color: '#e60023', grupo: 'Pinterest' },
  { id: 'telegram', nombre: 'Canal de Telegram', corto: 'Telegram', color: '#2aabee', grupo: 'Telegram' },
  { id: 'newsletter', nombre: 'Newsletter', corto: 'Email', color: '#8b5cf6', grupo: 'Email' },
];
export const redDe = (id) => REDES.find((r) => r.id === id) || { id, nombre: id, corto: id, color: 'var(--muted)' };
