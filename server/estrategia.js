import { ajustes, row, rows } from './db.js';

// Estrategia: qué tipo de contenido toca cada día según la semana sea para atraer audiencia, educar (preparar la
// venta) o vender. Cada semana del calendario de marketing tiene su objetivo, su táctica y su campaña (como el
// Excel del calendario de marketing), y su estructura dice qué va cada día en directo, post y stories.
// Las estructuras de serie salen de «Cómo organizar tus semanas de contenido» y se pueden cambiar.

export class EstrategiaError extends Error {
  constructor(m) { super(m); this.publico = true; }
}

export const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
export const FILAS = [
  { id: 'directo', nombre: 'Directo', formato: null },
  { id: 'post', nombre: 'Post', formato: null },
  { id: 'stories', nombre: 'Stories', formato: 'Story' },
];
export const TIPOS_SEMANA = ['atraer', 'educar', 'vender'];

// Cada hueco de la tabla son uno o varios botones: una categoría (LM, Viral, Educar…) y, si hace falta, una nota
const b = (c, n = null) => (n ? { c, n } : { c });
export const CATEGORIAS_DE_SERIE = {
  directo: ['Valor', 'Q&A', 'Testimonio', 'Roadmap'],
  post: ['LM', 'Viral', 'Testimonio', 'Educar', 'Conexión'],
  stories: ['Educar', 'LM', 'Testimonio', 'Q&A', 'Comunidad', 'Personal'],
};

export const ESTRUCTURAS_DE_SERIE = {
  atraer: {
    nombre: 'Atraer audiencia', etiqueta: 'Semana tipo', color: '#3987e5', objetivoPieza: 'atraer',
    resumen: 'La semana habitual. Los posts atraen audiencia nueva aportando valor útil a quien aún no sabe que tiene un problema o no conoce la solución, y las stories educan sobre el problema y cómo resolverlo. Acciones puntuales de venta: 2-3 CTA en la semana.',
    posts: 'Niveles de conciencia bajos (1-2)', stories: 'Educar a niveles 2-3',
    filas: {
      directo: [[], [], [b('Valor')], [], [], [], []],
      post: [[b('Viral')], [b('LM')], [b('Viral')], [b('Educar')], [b('Viral')], [b('Viral')], [b('Testimonio')]],
      stories: [[b('Educar')], [b('LM')], [b('Educar', 'con prueba social · ¿con CTA?')], [b('Educar', '¿LM?')], [b('Educar')], [b('Personal', 'conexión')], [b('Testimonio', 'con CTA')]],
    },
    tipos: [],
    pasos: [],
  },
  educar: {
    nombre: 'Semana educativa', etiqueta: 'Preparar para la venta', color: '#d9534f', objetivoPieza: 'nutrir',
    resumen: 'La semana previa a la de venta. Educa sobre tu solución y te posiciona como guía para quien tiene un nivel de conciencia medio o alto (3-4): trabaja las creencias, anticipa las objeciones, educa sobre la responsabilidad de actuar y crea «hype» con la oportunidad que vas a presentar.',
    posts: 'Nivel de conciencia medio (2-3)', stories: 'Educar a niveles 3-4',
    filas: {
      directo: [[], [], [b('Valor', '+ Hype')], [], [], [], []],
      post: [[b('Educar', 'Problema 1 · conciencia 1-2')], [b('LM')], [b('Educar', 'Problema 2 · conciencia 1-2')], [b('Viral')], [b('Educar', 'Responsabilidad · general')], [b('Testimonio', 'aspiracional')], [b('Viral')]],
      stories: [[b('Educar', 'Problema 3 · conciencia 3-4')], [b('LM')], [b('Educar', 'Problema 4 · conciencia 3-4')], [b('Personal', 'oportunidad aspiracional (Hype)')], [b('Educar', 'Responsabilidad · específico')], [b('Personal', 'oportunidad aspiracional (Hype)')], [b('Testimonio', 'aspiracional con prueba social')]],
    },
    tipos: [
      { nombre: 'Hype en historias', descripcion: 'Hacer ver a la persona cómo va a cambiar su vida y los beneficios que va a obtener con la oportunidad que vas a ofrecer.' },
      { nombre: 'Educar sobre la responsabilidad', descripcion: 'De forma general en los posts (un tema transversal para cualquier persona) y más específica en las stories (un tema concreto de su problema del que se debe responsabilizar).' },
      { nombre: 'Educar sobre el problema', descripcion: 'Cambiar las creencias sobre los principales problemas (uno distinto cada día) ajustando el nivel de conciencia: más bajo en posts (2-3) y más alto en stories (3-4).' },
      { nombre: 'Aspiracional', descripcion: 'Hacerle ver la vida que podría tener si lograra su resultado soñado. Idealmente, con prueba social.' },
    ],
    pasos: [],
  },
  vender: {
    nombre: 'Semana de venta', etiqueta: 'Conversión', color: '#2f9e5b', objetivoPieza: 'convertir',
    resumen: 'Para convertir seguidores en clientes con un nivel de conciencia alto (4-5). Rompe objeciones y dudas de forma racional y emocional, con prueba social y testimonios casi a diario. Todo el contenido busca que te escriban para saber cómo les puedes ayudar.',
    posts: 'Nivel de conciencia alto (4-5)', stories: 'Storytelling a nivel 4-5',
    filas: {
      directo: [[], [b('Testimonio', 'con cliente')], [b('Testimonio', 'con cliente')], [b('Q&A')], [b('Testimonio', 'con cliente')], [], [b('Roadmap', 'o valor: cómo es el programa')]],
      post: [[b('Educar', 'info de la oferta')], [b('Educar', 'FAQs (racional)')], [b('Educar', '3 decisiones (racional)')], [b('Testimonio', 'carrusel o vídeo (emocional)')], [b('Educar', 'objeciones comunes (racional)')], [b('Testimonio', 'carrusel o vídeo (emocional)')], [b('Testimonio', 'carrusel o vídeo (emocional)')]],
      stories: [[b('Testimonio', 'storytelling con captura de apertura')], [b('Educar', 'storytelling con captura educativa')], [b('Educar', 'storytelling con captura educativa')], [b('Testimonio', 'storytelling con captura aspiracional')], [b('Educar', 'storytelling con captura educativa')], [b('Testimonio', 'storytelling con captura aspiracional')], [b('Educar', 'cierre de la estrategia (urgencia)')]],
    },
    tipos: [
      { nombre: 'Post racionales', descripcion: 'Explicar desde el beneficio el porqué de la oferta, rompiendo objeciones comunes y explicando el coste de la decisión (p. ej. «Tienes 3 opciones: no hacer nada, intentarlo por tu cuenta o decidir cambiar ahora»).' },
      { nombre: 'Testimonios en directo', descripcion: 'Romper las principales objeciones de forma emocional con una entrevista a un caso de éxito.' },
      { nombre: 'Testimonios en post', descripcion: 'Conexión emocional, rompiendo objeciones de forma emocional.' },
      { nombre: 'Directo Q&A (opcional)', descripcion: 'Resolver FAQ y dudas. Solo si tienes una comunidad grande: si no va a ir nadie, mejor no hacerlo.' },
      { nombre: 'Directo Roadmap', descripcion: 'Enseñar cómo es el programa, sus fases y las garantías que ofreces.' },
      { nombre: 'Cierre', descripcion: 'Post simple y corto con un deadline claro que genere urgencia real.' },
      { nombre: 'Storytelling educativo / aspiracional', descripcion: 'Resolver objeciones y educar sobre cómo tu programa les dará los beneficios que esperan, con prueba social.' },
    ],
    pasos: [
      'Elige las objeciones que vas a rebatir y el mensaje de la oferta.',
      'Elige los testimonios según el mensaje, para acomodar el resto de contenidos.',
      'Organiza los días y horarios de los testimonios.',
      'Cuadra el resto de contenidos siguiendo la estructura.',
    ],
  },
};

// Los objetivos de semana del calendario de marketing y la estructura que toca con cada uno
export const OBJETIVOS_SEMANA = [
  { id: 'recurrente', nombre: 'Recurrente', tipo: 'atraer' },
  { id: 'valor', nombre: 'Aportar valor sin venta', tipo: 'atraer' },
  { id: 'educacion', nombre: 'Educación', tipo: 'educar' },
  { id: 'anuncio', nombre: 'Anuncio de la oferta', tipo: 'educar' },
  { id: 'venta', nombre: 'Venta', tipo: 'vender' },
];
export const TACTICAS = [
  'Tráfico frío + contenido orgánico',
  'Tráfico frío + contenido orgánico + recontacto antiguos clientes',
  'Tráfico frío + contenido orgánico + oferta a clientes actuales',
  'Retargeting + contenido orgánico',
  'Tráfico para seguidores + contenido orgánico',
  'Tráfico para seguidores + 1 LM + 2 CTAs',
  'Tráfico para seguidores + 2 LM + 1 CTA',
  'Contenido orgánico',
];
export const PRINCIPIOS = [
  { titulo: 'Atraes lo que eres', texto: 'El contenido es el primer contacto con tu marca: que refleje tu personalidad, tu forma de ser y tus valores.' },
  { titulo: 'Conecta con tu audiencia', texto: 'No crees contenido por cumplir: hazlo para transmitir un mensaje. La intención se nota.' },
  { titulo: 'Copiar te hace uno más', texto: 'Piensa en lo que tu cliente necesita escuchar, lo que le ayuda y las palabras que usa.' },
];

// Las tablas antiguas (un texto por hueco) se pasan a botones: primero las de serie de antes, tal cual; si no,
// «Categoría (nota)» o «Categoría nota»; si no, la categoría que encaje y el texto entero como nota
const VIEJAS = {
  Atraer: b('Viral'), 'Educar con prueba social (¿con CTA?)': b('Educar', 'con prueba social · ¿con CTA?'), 'Educar (¿LM?)': b('Educar', '¿LM?'),
  'Testimonio con CTA': b('Testimonio', 'con CTA'), 'Valor + Hype': b('Valor', '+ Hype'), 'Testimonio aspiracional': b('Testimonio', 'aspiracional'),
  'Presentar oportunidad aspiracional (Hype)': b('Personal', 'oportunidad aspiracional (Hype)'), 'Aspiracional con prueba social': b('Testimonio', 'aspiracional con prueba social'),
  'Testimonio con cliente': b('Testimonio', 'con cliente'), 'Valor o Roadmap del programa': b('Roadmap', 'o valor: cómo es el programa'),
  'Info oferta (informativo)': b('Educar', 'info de la oferta'), 'FAQs (racional)': b('Educar', 'FAQs (racional)'), '3 decisiones (racional)': b('Educar', '3 decisiones (racional)'),
  'Testimonio en carrusel o vídeo (emocional)': b('Testimonio', 'carrusel o vídeo (emocional)'), 'Objeciones comunes (racional)': b('Educar', 'objeciones comunes (racional)'),
  'Storytelling con captura de apertura': b('Testimonio', 'storytelling con captura de apertura'), 'Storytelling con captura educativa': b('Educar', 'storytelling con captura educativa'),
  'Storytelling con captura aspiracional': b('Testimonio', 'storytelling con captura aspiracional'), 'Cierre estrategia (urgencia)': b('Educar', 'cierre de la estrategia (urgencia)'),
};
const NOMBRES = ['LM', 'Viral', 'Testimonio', 'Educar', 'Conexión', 'Q&A', 'Comunidad', 'Personal', 'Valor', 'Roadmap'];
const CATEGORIA_DE = [[/\bLM\b|lead ?magnet/i, 'LM'], [/testimonio|prueba social|aspiracional/i, 'Testimonio'], [/viral|atraer/i, 'Viral'],
  [/q ?& ?a|preguntas/i, 'Q&A'], [/comunidad/i, 'Comunidad'], [/personal|hype/i, 'Personal'], [/conexi/i, 'Conexión'], [/roadmap/i, 'Roadmap'], [/valor/i, 'Valor'], [/educa|faq|objeci|decisi|oferta/i, 'Educar']];
const aBoton = (x) => {
  if (x && typeof x === 'object') {
    const c = String(x.c || '').trim().slice(0, 30);
    const n = String(x.n || '').trim().slice(0, 120);
    // Los que salieron de pasar una tabla antigua con la versión anterior (nota = el texto viejo de serie)
    if (n && VIEJAS[n]) return { ...VIEJAS[n] };
    return c ? (n ? { c, n } : { c }) : null;
  }
  const t = String(x || '').trim().slice(0, 120);
  if (!t) return null;
  if (VIEJAS[t]) return { ...VIEJAS[t] };
  const cabeza = NOMBRES.find((c) => t.toLowerCase() === c.toLowerCase() || t.toLowerCase().startsWith(`${c.toLowerCase()} `));
  if (cabeza) {
    const resto = t.slice(cabeza.length).trim().replace(/^\((.*)\)$/, '$1').trim();
    return resto ? { c: cabeza, n: resto } : { c: cabeza };
  }
  const c = CATEGORIA_DE.find(([re]) => re.test(t))?.[1] || t.slice(0, 30);
  return c.toLowerCase() === t.toLowerCase() ? { c } : { c, n: t };
};
export const celda = (v) => (Array.isArray(v) ? v : v ? [v] : []).map(aBoton).filter(Boolean).slice(0, 6);
// «LM + Educar (Problema 1)»
export const textoCelda = (v) => celda(v).map((x) => (x.n ? `${x.c} (${x.n})` : x.c)).join(' + ');

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const deIso = (s) => { const [a, m, d] = String(s).split('-').map(Number); return new Date(a, m - 1, d); };
// El lunes de la semana de una fecha
export const lunesDe = (fecha) => { const d = deIso(fecha); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); };
const masDias = (fecha, n) => { const d = deIso(fecha); d.setDate(d.getDate() + n); return iso(d); };
const esFecha = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(deIso(s).getTime());
const texto = (v, max) => (v == null ? null : String(v).trim().slice(0, max) || null);

export function createEstrategia({ db, jarvis = null, hoy = () => iso(new Date()) }) {
  const aj = ajustes(db);
  const q = {
    una: db.prepare('SELECT * FROM estrategia_semanas WHERE lunes = ?'),
    rango: db.prepare('SELECT * FROM estrategia_semanas WHERE lunes BETWEEN ? AND ? ORDER BY lunes'),
    guardar: db.prepare(`INSERT INTO estrategia_semanas (lunes, tipo, objetivo, detalle, tactica, campana, celdas, notas) VALUES (@lunes, @tipo, @objetivo, @detalle, @tactica, @campana, @celdas, @notas)
      ON CONFLICT(lunes) DO UPDATE SET tipo = excluded.tipo, objetivo = excluded.objetivo, detalle = excluded.detalle, tactica = excluded.tactica, campana = excluded.campana,
        celdas = excluded.celdas, notas = excluded.notas, actualizado = datetime('now','localtime')`),
    borrar: db.prepare('DELETE FROM estrategia_semanas WHERE lunes = ?'),
  };

  // ---------- Estructuras (las de serie, o las tuyas si las has cambiado) ----------
  function estructuras() {
    const propias = aj.leer('estrategia_estructuras', {}) || {};
    const out = {};
    for (const t of TIPOS_SEMANA) {
      const e = { ...ESTRUCTURAS_DE_SERIE[t], ...(propias[t] || {}), id: t, cambiada: Boolean(propias[t]) };
      out[t] = { ...e, filas: filasValidas(e.filas) };
    }
    return out;
  }

  // ---------- Los botones de cada fila (se pueden añadir y quitar) ----------
  function categorias() {
    const propias = aj.leer('estrategia_categorias', {}) || {};
    return Object.fromEntries(FILAS.map(({ id }) => [id, Array.isArray(propias[id]) && propias[id].length ? propias[id] : CATEGORIAS_DE_SERIE[id]]));
  }
  function guardarCategorias(d = {}) {
    const propias = aj.leer('estrategia_categorias', {}) || {};
    for (const { id } of FILAS) {
      if (!(id in d)) continue;
      if (d[id] === null) { delete propias[id]; continue; }
      if (!Array.isArray(d[id])) throw new EstrategiaError('Lista de botones no válida');
      const lista = [...new Set(d[id].map((x) => String(x || '').trim().slice(0, 30)).filter(Boolean))].slice(0, 20);
      if (!lista.length) throw new EstrategiaError('Deja al menos un botón');
      propias[id] = lista;
    }
    aj.guardar('estrategia_categorias', propias);
    return categorias();
  }
  const filasValidas = (f) => Object.fromEntries(FILAS.map(({ id }) => [id, DIAS.map((_, i) => celda(f?.[id]?.[i]))]));
  function guardarEstructura(tipo, d = {}) {
    if (!TIPOS_SEMANA.includes(tipo)) throw new EstrategiaError('Esa estructura no existe');
    const propias = aj.leer('estrategia_estructuras', {}) || {};
    const actual = estructuras()[tipo];
    const nueva = {
      nombre: texto(d.nombre, 60) || actual.nombre,
      etiqueta: d.etiqueta !== undefined ? texto(d.etiqueta, 60) || '' : actual.etiqueta,
      resumen: d.resumen !== undefined ? texto(d.resumen, 2000) || '' : actual.resumen,
      posts: d.posts !== undefined ? texto(d.posts, 120) || '' : actual.posts,
      stories: d.stories !== undefined ? texto(d.stories, 120) || '' : actual.stories,
      filas: d.filas ? filasValidas(d.filas) : actual.filas,
      tipos: Array.isArray(d.tipos) ? d.tipos.map((x) => ({ nombre: texto(x?.nombre, 80), descripcion: texto(x?.descripcion, 600) || '' })).filter((x) => x.nombre).slice(0, 20) : actual.tipos,
      pasos: Array.isArray(d.pasos) ? d.pasos.map((x) => texto(x, 300)).filter(Boolean).slice(0, 10) : actual.pasos,
    };
    propias[tipo] = nueva;
    aj.guardar('estrategia_estructuras', propias);
    return estructuras();
  }
  function restaurarEstructura(tipo) {
    const propias = tipo ? aj.leer('estrategia_estructuras', {}) || {} : {};
    if (tipo) delete propias[tipo];
    aj.guardar('estrategia_estructuras', propias);
    return estructuras();
  }

  // ---------- Semanas ----------
  const tipoDeObjetivo = (o) => OBJETIVOS_SEMANA.find((x) => x.id === o)?.tipo || null;
  function vistaSemana(lunes, r, est = estructuras()) {
    // Sin nada apuntado, la semana es la «semana tipo» (atraer audiencia)
    const tipo = r?.tipo || tipoDeObjetivo(r?.objetivo) || 'atraer';
    let celdas = null;
    try { celdas = r?.celdas ? JSON.parse(r.celdas) : null; } catch { /* la de la estructura */ }
    return {
      lunes, domingo: masDias(lunes, 6), tipo, porDefecto: !r?.tipo && !r?.objetivo,
      objetivo: r?.objetivo || null, detalle: r?.detalle || null, tactica: r?.tactica || null, campana: r?.campana || null, notas: r?.notas || null,
      propia: Boolean(celdas), filas: celdas ? filasValidas(celdas) : est[tipo].filas,
    };
  }
  function semana(lunes) {
    if (!esFecha(lunes)) throw new EstrategiaError('Fecha no válida');
    const l = lunesDe(lunes);
    return vistaSemana(l, row(q.una, l));
  }
  // Las semanas de un año (las que tienen algún día en él), como el calendario de marketing
  function anio(a) {
    const n = Number(a) || deIso(hoy()).getFullYear();
    const desde = lunesDe(`${n}-01-01`);
    const hasta = lunesDe(`${n}-12-31`);
    const guardadas = new Map(rows(q.rango, desde, hasta).map((r) => [r.lunes, r]));
    const est = estructuras();
    const lista = [];
    for (let l = desde; l <= hasta; l = masDias(l, 7)) lista.push(vistaSemana(l, guardadas.get(l), est));
    return lista;
  }
  function guardarSemana(lunes, d = {}) {
    if (!esFecha(lunes)) throw new EstrategiaError('Fecha no válida');
    const l = lunesDe(lunes);
    const actual = row(q.una, l) || {};
    const v = (k, max) => (k in d ? texto(d[k], max) : actual[k] ?? null);
    const objetivo = 'objetivo' in d ? (OBJETIVOS_SEMANA.some((x) => x.id === d.objetivo) ? d.objetivo : null) : actual.objetivo ?? null;
    let tipo = 'tipo' in d ? (TIPOS_SEMANA.includes(d.tipo) ? d.tipo : null) : actual.tipo ?? null;
    // Al elegir el objetivo sin decir la estructura, va la que le toca
    if ('objetivo' in d && !('tipo' in d) && objetivo) tipo = tipoDeObjetivo(objetivo);
    const celdas = 'celdas' in d ? (d.celdas ? JSON.stringify(filasValidas(d.celdas)) : null) : actual.celdas ?? null;
    q.guardar.run({ lunes: l, tipo, objetivo, detalle: v('detalle', 120), tactica: v('tactica', 160), campana: v('campana', 120), celdas, notas: v('notas', 2000) });
    return semana(l);
  }
  // Varias semanas de golpe (p. ej. una campaña: educativa, anuncio y venta)
  function guardarSemanas(lista = []) {
    if (!Array.isArray(lista) || !lista.length) throw new EstrategiaError('No hay semanas');
    return lista.slice(0, 60).map((s) => guardarSemana(s.lunes, s));
  }
  function borrarSemana(lunes) {
    if (!esFecha(lunes)) throw new EstrategiaError('Fecha no válida');
    q.borrar.run(lunesDe(lunes));
    return semana(lunes);
  }

  // ---------- El plan de cada día ----------
  // Qué toca cada día entre dos fechas (lo usan el calendario de Contenido y JARVIS)
  function plan({ desde = hoy(), dias = 14 } = {}) {
    if (!esFecha(desde)) throw new EstrategiaError('Fecha no válida');
    const n = Math.max(1, Math.min(120, Number(dias) || 14));
    const est = estructuras();
    const cache = new Map();
    const out = [];
    for (let i = 0; i < n; i++) {
      const fecha = masDias(desde, i);
      const l = lunesDe(fecha);
      if (!cache.has(l)) cache.set(l, vistaSemana(l, row(q.una, l), est));
      const s = cache.get(l);
      const d = (deIso(fecha).getDay() + 6) % 7;
      out.push({
        fecha, dia: DIAS[d], tipo: s.tipo, semana: est[s.tipo].nombre, color: est[s.tipo].color, porDefecto: s.porDefecto, objetivo: OBJETIVOS_SEMANA.find((x) => x.id === s.objetivo)?.nombre || null,
        detalle: s.detalle, tactica: s.tactica, campana: s.campana,
        directo: textoCelda(s.filas.directo[d]) || null, post: textoCelda(s.filas.post[d]) || null, stories: textoCelda(s.filas.stories[d]) || null,
        botones: { directo: s.filas.directo[d], post: s.filas.post[d], stories: s.filas.stories[d] },
      });
    }
    return out;
  }

  // «Pasar al calendario»: cada botón de cada día pasa a Contenido como un hueco (una idea con su día, su
  // categoría y lo que toca como título) para ir metiendo el contenido. Sin repetir y sin los días que ya pasaron.
  function crearPiezas(lunes, huecos = null) {
    if (!jarvis) throw new EstrategiaError('Aquí no se pueden crear piezas');
    const s = semana(lunes);
    const est = estructuras()[s.tipo];
    const hoyIso = hoy();
    const ya = new Set(jarvis.listarPiezas().map((p) => p.origen_ref).filter((r) => String(r || '').startsWith('estrategia:')));
    const todos = [];
    for (let d = 0; d < 7; d++) for (const f of FILAS) todos.push({ dia: d, fila: f.id });
    const creadas = [];
    for (const h of Array.isArray(huecos) ? huecos : todos) {
      const d = Number(h?.dia);
      const fila = FILAS.find((f) => f.id === h?.fila);
      if (!fila || !(d >= 0 && d < 7)) continue;
      const fecha = masDias(s.lunes, d);
      if (fecha < hoyIso) continue;
      s.filas[fila.id][d].forEach((x, i) => {
        const ref = `estrategia:${s.lunes}:${d}:${fila.id}:${i}`;
        if (ya.has(ref) || (i === 0 && ya.has(`estrategia:${s.lunes}:${d}:${fila.id}`))) return;
        const titulo = `${fila.nombre} · ${x.c}${x.n ? ` · ${x.n}` : ''}`;
        creadas.push(jarvis.crearPieza({ titulo, estado: 'idea', fecha, formato: fila.formato, categoria: x.c, objetivo: est.objetivoPieza, origen_ref: ref, origen: 'dashboard', registrarActividad: false }));
        ya.add(ref);
      });
    }
    if (creadas.length) jarvis.registrar('Contenido', `Estrategia: ${creadas.length} ${creadas.length === 1 ? 'hueco pasado' : 'huecos pasados'} al calendario (semana del ${s.lunes})`, 'dashboard');
    return { creadas: creadas.length, piezas: creadas };
  }
  // Todo un mes (las semanas cuyo jueves cae en él)
  function pasarMes(anioN, mes) {
    const a = Number(anioN);
    const m = Number(mes);
    if (!(a > 2000 && m >= 1 && m <= 12)) throw new EstrategiaError('Mes no válido');
    let creadas = 0;
    let semanas = 0;
    for (let l = lunesDe(`${a}-${String(m).padStart(2, '0')}-01`); ; l = masDias(l, 7)) {
      const jueves = deIso(masDias(l, 3));
      if (jueves.getFullYear() > a || (jueves.getFullYear() === a && jueves.getMonth() + 1 > m)) break;
      if (jueves.getMonth() + 1 !== m) continue;
      semanas += 1;
      creadas += crearPiezas(l).creadas;
    }
    return { creadas, semanas };
  }

  // Lo que necesita JARVIS para proponer los temas de una semana
  function promptSemana(lunes, { indicaciones = '' } = {}) {
    const s = semana(lunes);
    const est = estructuras()[s.tipo];
    const obj = OBJETIVOS_SEMANA.find((x) => x.id === s.objetivo)?.nombre;
    const tabla = DIAS.map((dia, i) => `- ${dia} ${masDias(s.lunes, i)}: ${FILAS.map((f) => (s.filas[f.id][i].length ? `${f.nombre}: ${textoCelda(s.filas[f.id][i])}` : null)).filter(Boolean).join(' · ') || 'nada'}`).join('\n');
    return `Planifica el contenido de MI semana del ${s.lunes} al ${s.domingo} siguiendo mi estrategia.
Tipo de semana: ${est.nombre}${est.etiqueta ? ` (${est.etiqueta})` : ''}. ${est.resumen}
Posts: ${est.posts}. Stories: ${est.stories}.
${obj ? `Objetivo del calendario de marketing: ${obj}${s.detalle ? ` (${s.detalle})` : ''}.\n` : ''}${s.tactica ? `Táctica: ${s.tactica}.\n` : ''}${s.campana ? `Campaña / game plan: ${s.campana}.\n` : ''}${s.notas ? `Notas de la semana: ${s.notas}\n` : ''}
Qué toca cada día:
${tabla}
${est.tipos?.length ? `\nTipos de contenido de esta semana:\n${est.tipos.map((t) => `- ${t.nombre}: ${t.descripcion}`).join('\n')}\n` : ''}${est.pasos?.length ? `\nCómo prepararla:\n${est.pasos.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n` : ''}${indicaciones ? `\nIndicaciones (mandan sobre todo lo demás): ${String(indicaciones).slice(0, 1500)}\n` : ''}
Cómo hacerlo:
1. Lee _voz.md y CLAUDE.md (mi oferta, mi cliente, mis pilares). Mira con mi_semana y listar_pipeline lo que ya tengo esos días para no repetirlo, y con buscar_notas mis ideas en 01-Ideas que encajen.
2. Para cada botón de cada día (directo, post y stories; la categoría dice el tipo de contenido y la nota, el matiz), propón un tema concreto que cumpla lo que toca ese día y el nivel de conciencia de la semana. Que los días tengan hilo entre sí.
3. Si ese día ya hay huecos pasados al calendario (piezas en Idea con su categoría), complétalos con mover_pieza: título con el tema, gancho y cta. Si no, crea cada uno con crear_pieza: estado "idea", fecha de ese día, su categoría (la del botón: LM, Viral, Educar…), formato (Reel, Carrusel o Post para los posts; Story para las stories), un título claro con el tema, el gancho, el cta y objetivo "${est.objetivoPieza}". Nunca dupliques un hueco.
4. No publiques nada. Responde con la semana en una tabla corta (día, hueco, tema).`;
  }

  // Varias semanas a la vez (las elegidas en el calendario de marketing)
  const lista = (l) => {
    if (!Array.isArray(l) || !l.length) throw new EstrategiaError('Elige alguna semana');
    return [...new Set(l.filter(esFecha).map(lunesDe))].slice(0, 60);
  };
  const pasarSemanas = (l) => ({ creadas: lista(l).reduce((n, x) => n + crearPiezas(x).creadas, 0) });
  const vaciarSemanas = (l) => { for (const x of lista(l)) q.borrar.run(x); return { ok: true }; };

  return { estructuras, guardarEstructura, restaurarEstructura, categorias, guardarCategorias, semana, anio, guardarSemana, guardarSemanas, borrarSemana, plan, crearPiezas, pasarMes, pasarSemanas, vaciarSemanas, promptSemana };
}
