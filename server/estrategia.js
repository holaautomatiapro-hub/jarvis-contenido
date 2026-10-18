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

export const ESTRUCTURAS_DE_SERIE = {
  atraer: {
    nombre: 'Atraer audiencia', etiqueta: 'Semana tipo', color: '#3987e5', objetivoPieza: 'atraer',
    resumen: 'La semana habitual. Los posts atraen audiencia nueva aportando valor útil a quien aún no sabe que tiene un problema o no conoce la solución, y las stories educan sobre el problema y cómo resolverlo. Acciones puntuales de venta: 2-3 CTA en la semana.',
    posts: 'Niveles de conciencia bajos (1-2)', stories: 'Educar a niveles 2-3',
    filas: {
      directo: ['', '', 'Valor', '', '', '', ''],
      post: ['Atraer', 'LM', 'Atraer', 'Educar', 'Atraer', 'Atraer', 'Testimonio'],
      stories: ['Educar', 'LM', 'Educar con prueba social (¿con CTA?)', 'Educar (¿LM?)', 'Educar', 'Conexión', 'Testimonio con CTA'],
    },
    tipos: [],
    pasos: [],
  },
  educar: {
    nombre: 'Semana educativa', etiqueta: 'Preparar para la venta', color: '#d9534f', objetivoPieza: 'nutrir',
    resumen: 'La semana previa a la de venta. Educa sobre tu solución y te posiciona como guía para quien tiene un nivel de conciencia medio o alto (3-4): trabaja las creencias, anticipa las objeciones, educa sobre la responsabilidad de actuar y crea «hype» con la oportunidad que vas a presentar.',
    posts: 'Nivel de conciencia medio (2-3)', stories: 'Educar a niveles 3-4',
    filas: {
      directo: ['', '', 'Valor + Hype', '', '', '', ''],
      post: ['Educar (Problema 1 · conciencia 1-2)', 'LM', 'Educar (Problema 2 · conciencia 1-2)', 'Atraer', 'Educar (Responsabilidad · general)', 'Testimonio aspiracional', 'Atraer'],
      stories: ['Educar (Problema 3 · conciencia 3-4)', 'LM', 'Educar (Problema 4 · conciencia 3-4)', 'Presentar oportunidad aspiracional (Hype)', 'Educar (Responsabilidad · específico)', 'Presentar oportunidad aspiracional (Hype)', 'Aspiracional con prueba social'],
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
      directo: ['', 'Testimonio con cliente', 'Testimonio con cliente', 'Q&A', 'Testimonio con cliente', '', 'Valor o Roadmap del programa'],
      post: ['Info oferta (informativo)', 'FAQs (racional)', '3 decisiones (racional)', 'Testimonio en carrusel o vídeo (emocional)', 'Objeciones comunes (racional)', 'Testimonio en carrusel o vídeo (emocional)', 'Testimonio en carrusel o vídeo (emocional)'],
      stories: ['Storytelling con captura de apertura', 'Storytelling con captura educativa', 'Storytelling con captura educativa', 'Storytelling con captura aspiracional', 'Storytelling con captura educativa', 'Storytelling con captura aspiracional', 'Cierre estrategia (urgencia)'],
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

const DIA_MS = 86400000;
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
    for (const t of TIPOS_SEMANA) out[t] = { ...ESTRUCTURAS_DE_SERIE[t], ...(propias[t] || {}), id: t, cambiada: Boolean(propias[t]) };
    return out;
  }
  const filasValidas = (f) => Object.fromEntries(FILAS.map(({ id }) => [id, DIAS.map((_, i) => texto(f?.[id]?.[i], 120) || '')]));
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
      propia: Boolean(celdas), filas: celdas || est[tipo].filas,
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
        directo: s.filas.directo[d] || null, post: s.filas.post[d] || null, stories: s.filas.stories[d] || null,
      });
    }
    return out;
  }

  // Crea en Contenido las piezas de la semana (como ideas, con su día): una por hueco elegido, sin repetir
  function crearPiezas(lunes, huecos = []) {
    if (!jarvis) throw new EstrategiaError('Aquí no se pueden crear piezas');
    const s = semana(lunes);
    const est = estructuras()[s.tipo];
    const ya = new Set(jarvis.listarPiezas().map((p) => p.origen_ref).filter((r) => String(r || '').startsWith('estrategia:')));
    const creadas = [];
    for (const h of Array.isArray(huecos) ? huecos : []) {
      const d = Number(h?.dia);
      const fila = FILAS.find((f) => f.id === h?.fila);
      const que = fila && d >= 0 && d < 7 ? s.filas[fila.id][d] : null;
      if (!que) continue;
      const ref = `estrategia:${s.lunes}:${d}:${fila.id}`;
      if (ya.has(ref)) continue;
      const fecha = masDias(s.lunes, d);
      const titulo = `${fila.nombre}: ${que}`;
      creadas.push(jarvis.crearPieza({ titulo, estado: 'idea', fecha, formato: fila.formato, objetivo: est.objetivoPieza, origen_ref: ref, origen: 'dashboard', registrarActividad: false }));
      ya.add(ref);
    }
    if (creadas.length) jarvis.registrar('Contenido', `Estrategia: ${creadas.length} ${creadas.length === 1 ? 'pieza creada' : 'piezas creadas'} para la semana del ${s.lunes}`, 'dashboard');
    return { creadas: creadas.length, piezas: creadas };
  }

  // Lo que necesita JARVIS para proponer los temas de una semana
  function promptSemana(lunes, { indicaciones = '' } = {}) {
    const s = semana(lunes);
    const est = estructuras()[s.tipo];
    const obj = OBJETIVOS_SEMANA.find((x) => x.id === s.objetivo)?.nombre;
    const tabla = DIAS.map((dia, i) => `- ${dia} ${masDias(s.lunes, i)}: ${FILAS.map((f) => (s.filas[f.id][i] ? `${f.nombre}: ${s.filas[f.id][i]}` : null)).filter(Boolean).join(' · ') || 'nada'}`).join('\n');
    return `Planifica el contenido de MI semana del ${s.lunes} al ${s.domingo} siguiendo mi estrategia.
Tipo de semana: ${est.nombre}${est.etiqueta ? ` (${est.etiqueta})` : ''}. ${est.resumen}
Posts: ${est.posts}. Stories: ${est.stories}.
${obj ? `Objetivo del calendario de marketing: ${obj}${s.detalle ? ` (${s.detalle})` : ''}.\n` : ''}${s.tactica ? `Táctica: ${s.tactica}.\n` : ''}${s.campana ? `Campaña / game plan: ${s.campana}.\n` : ''}${s.notas ? `Notas de la semana: ${s.notas}\n` : ''}
Qué toca cada día:
${tabla}
${est.tipos?.length ? `\nTipos de contenido de esta semana:\n${est.tipos.map((t) => `- ${t.nombre}: ${t.descripcion}`).join('\n')}\n` : ''}${est.pasos?.length ? `\nCómo prepararla:\n${est.pasos.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n` : ''}${indicaciones ? `\nIndicaciones (mandan sobre todo lo demás): ${String(indicaciones).slice(0, 1500)}\n` : ''}
Cómo hacerlo:
1. Lee _voz.md y CLAUDE.md (mi oferta, mi cliente, mis pilares). Mira con mi_semana y listar_pipeline lo que ya tengo esos días para no repetirlo, y con buscar_notas mis ideas en 01-Ideas que encajen.
2. Para cada hueco con contenido (directo, post y stories de cada día), propón un tema concreto que cumpla lo que toca ese día y el nivel de conciencia de la semana. Que los días tengan hilo entre sí.
3. Crea cada uno con crear_pieza: estado "idea", fecha de ese día, formato (Reel, Carrusel o Post para los posts; Story para las stories; Directo para los directos), un título claro con el tema, el gancho, el cta y objetivo "${est.objetivoPieza}". Si ya hay una pieza para ese hueco, no la dupliques: complétala con mover_pieza.
4. No publiques nada. Responde con la semana en una tabla corta (día, hueco, tema).`;
  }

  return { estructuras, guardarEstructura, restaurarEstructura, semana, anio, guardarSemana, guardarSemanas, borrarSemana, plan, crearPiezas, promptSemana };
}
