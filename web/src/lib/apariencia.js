// Apariencia del dashboard: modo oscuro/claro y color de acento (el azul de botones, pestañas y brillos).
// Se guarda en este navegador. index.html aplica lo guardado antes de pintar para que no parpadee.

const CLAVE = 'jarvis-apariencia';

export const MODOS = [
  { id: 'oscuro', label: 'Oscuro' },
  { id: 'claro', label: 'Claro' },
  { id: 'sistema', label: 'Sistema' },
];

export const COLORES = [
  { nombre: 'Azul', hex: '#2f6bff' },
  { nombre: 'Violeta', hex: '#7c3aed' },
  { nombre: 'Rosa', hex: '#db2777' },
  { nombre: 'Rojo', hex: '#e11d48' },
  { nombre: 'Naranja', hex: '#ea580c' },
  { nombre: 'Ámbar', hex: '#eab308' },
  { nombre: 'Verde', hex: '#16a34a' },
  { nombre: 'Turquesa', hex: '#0d9488' },
  { nombre: 'Cian', hex: '#0891b2' },
  { nombre: 'Grafito', hex: '#64748b' },
];

export const POR_DEFECTO = { modo: 'oscuro', acento: '#2f6bff' };

export const esHex = (v) => /^#[0-9a-f]{6}$/i.test(v);

export function hexARgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const aHex = (rgb) => '#' + rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');
export const mezclar = (a, b, t) => a.map((c, i) => c + (b[i] - c) * t);

function luminancia([r, g, b]) {
  const l = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * l(r) + 0.7152 * l(g) + 0.0722 * l(b);
}

// Variables que salen del color elegido: --accent, un tono más claro (--accent-2) y el texto encima.
export function variables(acento) {
  const hex = esHex(acento) ? acento.toLowerCase() : POR_DEFECTO.acento;
  const rgb = hexARgb(hex);
  return {
    '--accent': hex,
    '--accent-2': hex === POR_DEFECTO.acento ? '#3d8bff' : aHex(mezclar(rgb, [255, 255, 255], 0.18)),
    // Blanco salvo en acentos muy claros (amarillos, verdes lima…), donde se lee mejor el texto oscuro
    '--sobre-acento': luminancia(rgb) > 0.4 ? '#0b1220' : '#fff',
  };
}

const temaDe = (modo) =>
  modo === 'claro' || (modo === 'sistema' && window.matchMedia?.('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';

export function leer() {
  try {
    const a = JSON.parse(localStorage.getItem(CLAVE));
    return {
      modo: MODOS.some((m) => m.id === a?.modo) ? a.modo : POR_DEFECTO.modo,
      acento: esHex(a?.acento) ? a.acento : POR_DEFECTO.acento,
    };
  } catch {
    return { ...POR_DEFECTO };
  }
}

export function aplicar({ modo, acento }) {
  const raiz = document.documentElement;
  const vars = variables(acento);
  raiz.dataset.theme = temaDe(modo);
  for (const [k, v] of Object.entries(vars)) raiz.style.setProperty(k, v);
  // La esfera y las gráficas en canvas escuchan este evento para repintarse
  window.dispatchEvent(new Event('apariencia'));
  return { theme: raiz.dataset.theme, vars };
}

export function guardar(a) {
  const { theme, vars } = aplicar(a);
  try {
    // Se guarda ya resuelto para que el script de index.html no tenga que calcular nada
    localStorage.setItem(CLAVE, JSON.stringify({ ...a, theme, vars }));
  } catch { /* sin almacenamiento (modo privado): vale para esta sesión */ }
}

// Con "Sistema", sigue al sistema operativo si cambia mientras JARVIS está abierto
export function seguirSistema() {
  const mq = window.matchMedia?.('(prefers-color-scheme: light)');
  if (!mq) return () => {};
  const f = () => { const a = leer(); if (a.modo === 'sistema') aplicar(a); };
  mq.addEventListener('change', f);
  return () => mq.removeEventListener('change', f);
}
