import { normaliza } from './vault.js';

// JEV: el clasificador. Decide al instante (sin gastar tokens) qué modelo y qué ruta usar.
// Haiku para lo rápido y la memoria, Sonnet para escribir y buscar en la web, Opus para analizar y planificar.

export const RUTAS = {
  estrategia: { modelo: 'opus', etiqueta: 'Claude Opus', actividad: 'Analisis', motivo: 'análisis o estrategia' },
  escritura: { modelo: 'sonnet', etiqueta: 'Claude Sonnet', actividad: 'Contenido', motivo: 'escribir contenido' },
  web: { modelo: 'sonnet', etiqueta: 'Web', actividad: 'Analisis', motivo: 'buscar en internet' },
  memoria: { modelo: 'haiku', etiqueta: 'Obsidian', actividad: 'Nota', motivo: 'memoria y organización' },
  rapido: { modelo: 'haiku', etiqueta: 'Claude Haiku', actividad: null, motivo: 'pregunta rápida' },
};

// Orden = prioridad en caso de empate
const REGLAS = [
  ['estrategia', /\b(analiza\w*|analisis|estrategia|planific\w*|plan de|competencia|competidor\w*|metricas?|campana|diagnostic\w*|auditori\w*|por que (no )?funciona|que (reel|contenido|post) (deberia|conviene)|boostear|impulsar)\b/g],
  ['escritura', /\b(guion\w*|escrib\w*|redact\w*|carrusel\w*|caption\w*|copy|ganchos?|hooks?|historias?|reescrib\w*|adapta\w*|posts?|reels?|titular\w*|cta|hilo|newsletter|email)\b/g],
  ['web', /\b(internet|en la web|busca online|tendencias?|noticias?|actualidad|ultimas novedades|que se esta|google)\b/g],
  ['memoria', /\b(?:apunta\w*|anota\w*|guarda\w*|captura\w*|recuerda\w*|tareas?|pendientes?|mis notas|el vault|que tengo|resume mi dia|resumen del dia|mi dia|mueve|pipeline|calendario)\b|\bidea:/g],
];

export function clasificar(texto, { forzarModelo } = {}) {
  const t = normaliza(texto);
  let mejor = 'rapido', puntos = 0;
  for (const [ruta, re] of REGLAS) {
    const n = (t.match(re) || []).length;
    if (n > puntos) { mejor = ruta; puntos = n; }
  }
  // Peticiones largas y abiertas merecen más modelo
  if (mejor === 'rapido' && t.split(/\s+/).length > 45) mejor = 'escritura';
  const r = RUTAS[mejor];
  const modelo = forzarModelo && ['haiku', 'sonnet', 'opus'].includes(forzarModelo) ? forzarModelo : r.modelo;
  return { ruta: mejor, modelo, etiqueta: forzarModelo ? `Claude ${modelo[0].toUpperCase()}${modelo.slice(1)}` : r.etiqueta, motivo: forzarModelo ? 'elegido a mano' : r.motivo, actividad: r.actividad };
}
