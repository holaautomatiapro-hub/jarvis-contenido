// Flujos de las automatizaciones de Instagram (el tablero tipo ManyChat). Lo usan la interfaz y el servidor.
//
// Un flujo es { nodos: [{ id, tipo, x, y, datos }], conexiones: [{ de, salida, a }] }, siempre con un nodo «inicio».
// Bloques: mensaje (texto y hasta 3 botones: de enlace o que siguen un camino), pregunta (guarda la respuesta;
// con respuestas rápidas, un camino por opción), esperar, condicion (sí / no), etiqueta y fin.

export const TIPOS_BLOQUE = {
  mensaje: { nombre: 'Mensaje', color: 'var(--blue)' },
  pregunta: { nombre: 'Pregunta', color: 'var(--purple)' },
  esperar: { nombre: 'Esperar', color: 'var(--orange)' },
  condicion: { nombre: 'Condición', color: 'var(--cyan)' },
  etiqueta: { nombre: 'Etiqueta', color: 'var(--green)' },
  fin: { nombre: 'Fin', color: 'var(--muted)' },
};
export const DISPARADORES = {
  post: 'Comentan una publicación',
  story: 'Responden a una story',
  mensaje: 'Te escriben una palabra por privado',
};
// Los de comentarios y stories empiezan con la respuesta privada de Zernio: para seguir, hace falta que pulsen un botón
export const empiezaConComentario = (tipo) => tipo === 'post' || tipo === 'story';
export const MAX_BOTONES = 3;
export const MAX_OPCIONES = 13;
const SEGUNDOS = { segundos: 1, minutos: 60, horas: 3600, dias: 86400 };
export const segundosDeEspera = (d) => Math.round((Number(d?.cantidad) || 0) * (SEGUNDOS[d?.unidad] || 3600));
export const minutosDeEspera = (d) => segundosDeEspera(d) / 60;
export const ZONA_HORARIA = 'Europe/Madrid';

// Tras un comentario puede ir primero un «Esperar» (segundos antes de la respuesta privada) y luego el primer mensaje
export function esperaInicial(flujo, disparador) {
  if (!empiezaConComentario(disparador?.tipo)) return null;
  const n = flujo.nodos.find((x) => x.id === destinoDe(flujo, 'inicio', 'siguiente'));
  return n?.tipo === 'esperar' ? n : null;
}
export function primerMensajeId(flujo, disparador) {
  if (!empiezaConComentario(disparador?.tipo)) return null;
  const espera = esperaInicial(flujo, disparador);
  return espera ? destinoDe(flujo, espera.id, 'siguiente') : destinoDe(flujo, 'inicio', 'siguiente');
}
// ¿Es el primer mensaje (el que sale como respuesta privada al comentario)?
export const esPrimero = (flujo, disparador, id) => Boolean(id) && primerMensajeId(flujo, disparador) === id;

// Las salidas de cada bloque (cada una, una flecha) con su etiqueta
export function salidasDe(nodo, { primero = false } = {}) {
  const d = nodo.datos || {};
  switch (nodo.tipo) {
    case 'inicio': return [{ id: 'siguiente', etiqueta: '' }];
    case 'mensaje': {
      const caminos = (d.botones || []).map((b, i) => ({ b, i })).filter(({ b }) => b.tipo === 'camino');
      if (!caminos.length) return primero ? [] : [{ id: 'siguiente', etiqueta: '' }];
      return [...caminos.map(({ b, i }) => ({ id: `b${i}`, etiqueta: b.titulo || `Botón ${i + 1}` })), ...(primero ? [] : [{ id: 'sin_respuesta', etiqueta: 'Si no pulsa' }])];
    }
    case 'pregunta': {
      const ops = (d.opciones || []).filter(Boolean);
      return ops.length
        ? [...ops.map((o, i) => ({ id: `o${i}`, etiqueta: o })), { id: 'otra', etiqueta: 'Otra respuesta' }, { id: 'sin_respuesta', etiqueta: 'Si no responde' }]
        : [{ id: 'respuesta', etiqueta: 'Cuando responde' }, { id: 'sin_respuesta', etiqueta: 'Si no responde' }];
    }
    case 'condicion': return [{ id: 'si', etiqueta: 'Sí' }, { id: 'no', etiqueta: 'No' }];
    case 'fin': return [];
    default: return [{ id: 'siguiente', etiqueta: '' }];
  }
}

export const destinoDe = (flujo, de, salida) => flujo.conexiones.find((c) => c.de === de && c.salida === salida)?.a || null;

let contador = 0;
export const nuevoId = () => `n${Date.now().toString(36)}${(contador++).toString(36)}`;

export function bloqueNuevo(tipo, x = 0, y = 0) {
  const datos = {
    mensaje: { texto: '', botones: [], esperaHoras: 24 },
    pregunta: { texto: '', opciones: [], campo: '', esperaHoras: 24 },
    esperar: { cantidad: 1, unidad: 'horas', horario: { activo: false, desde: 9, hasta: 21 } },
    condicion: { tipo: 'etiqueta', valor: '' },
    etiqueta: { accion: 'poner', etiqueta: '' },
    fin: {},
  }[tipo];
  return { id: nuevoId(), tipo, x, y, datos };
}

// Al crear una, solo el disparador: los bloques los va añadiendo la persona
export function flujoInicial() {
  return { nodos: [{ id: 'inicio', tipo: 'inicio', x: 0, y: 0, datos: {} }], conexiones: [] };
}

// Las automatizaciones hechas con el formulario de antes, como flujo
export function flujoDesdeFormulario(c = {}) {
  const nodos = [{ id: 'inicio', tipo: 'inicio', x: 0, y: 0, datos: {} }];
  const conexiones = [];
  let x = 340;
  const poner = (n, de, salida) => { nodos.push({ ...n, x, y: 0 }); x += 340; if (de) conexiones.push({ de, salida, a: n.id }); return n.id; };
  const enlace = c.recurso?.enlace || '';
  const pregunta = c.pregunta?.texto || '';
  const primero = poner({ id: 'm1', tipo: 'mensaje', datos: { texto: c.mensaje || '', esperaHoras: 24, botones: [pregunta ? { titulo: c.boton || 'Lo quiero', tipo: 'camino' } : { titulo: c.boton || 'Lo quiero', tipo: 'enlace', url: enlace }] } }, 'inicio', 'siguiente');
  if (!pregunta) return { nodos, conexiones };
  let ultimo = primero;
  let salida = 'b0';
  if (enlace || c.recurso?.texto) {
    ultimo = poner({ id: 'm2', tipo: 'mensaje', datos: { texto: c.recurso?.texto || '¡Aquí lo tienes! 👇', esperaHoras: 24, botones: enlace ? [{ titulo: c.recurso?.titulo || 'Ver recurso', tipo: 'enlace', url: enlace }] : [] } }, ultimo, salida);
    salida = 'siguiente';
  }
  const p = poner({ id: 'p1', tipo: 'pregunta', datos: { texto: pregunta, opciones: c.pregunta?.opciones || [], campo: '', esperaHoras: 24 } }, ultimo, salida);
  if (c.pregunta?.gracias) {
    const g = poner({ id: 'm3', tipo: 'mensaje', datos: { texto: c.pregunta.gracias, botones: [], esperaHoras: 24 } }, null);
    for (const s of salidasDe(nodos.find((n) => n.id === p))) if (s.id !== 'sin_respuesta') conexiones.push({ de: p, salida: s.id, a: g });
  }
  return { nodos, conexiones };
}

const esUrl = (u) => /^https:\/\/\S+$/i.test(String(u || '').trim());

// Qué falta o está mal (errores: no deja guardar) y avisos (deja guardar)
export function validarFlujo(flujo, disparador = {}) {
  const errores = [];
  const avisos = [];
  const nodo = (id) => flujo.nodos.find((n) => n.id === id);
  const primeroId = destinoDe(flujo, 'inicio', 'siguiente');
  if (!primeroId) errores.push('Añade el primer bloque (arriba) y únelo al disparador');
  const comentario = empiezaConComentario(disparador.tipo);
  const espera = esperaInicial(flujo, disparador);
  const mensajeId = primerMensajeId(flujo, disparador);
  if (comentario && primeroId && nodo(mensajeId)?.tipo !== 'mensaje') errores.push(espera ? 'Tras la espera inicial va un Mensaje: es la respuesta privada al comentario' : 'Tras el disparador va un Mensaje (o un Esperar y luego el Mensaje): es la respuesta privada al comentario');
  if (espera) {
    if (espera.datos?.horario?.activo) errores.push('La espera antes de la respuesta privada no puede llevar horario (pon el horario en una espera más adelante)');
    if (segundosDeEspera(espera.datos) > 86400) errores.push('Antes de la respuesta privada se puede esperar como mucho 24 horas');
  }
  const nombre = (n, i) => `${TIPOS_BLOQUE[n.tipo]?.nombre || n.tipo}${n.datos?.texto ? ` «${String(n.datos.texto).slice(0, 25)}…»` : ` ${i}`}`;
  // Solo cuenta lo que se alcanza desde el inicio
  const vistos = new Set();
  const pila = primeroId ? [primeroId] : [];
  while (pila.length) {
    const id = pila.pop();
    if (vistos.has(id) || !nodo(id)) continue;
    vistos.add(id);
    for (const c of flujo.conexiones) if (c.de === id) pila.push(c.a);
  }
  const sueltos = flujo.nodos.filter((n) => n.tipo !== 'inicio' && n.tipo !== 'fin' && !vistos.has(n.id)).length;
  if (sueltos) avisos.push(`${sueltos} bloque${sueltos === 1 ? '' : 's'} sin conectar: no se ${sueltos === 1 ? 'usa' : 'usan'}`);
  let i = 0;
  for (const n of flujo.nodos.filter((x) => vistos.has(x.id))) {
    i++;
    const d = n.datos || {};
    const quien = nombre(n, i);
    const primero = comentario && n.id === mensajeId;
    if (n.tipo === 'mensaje') {
      const botones = d.botones || [];
      if (!String(d.texto || '').trim()) errores.push(`${quien}: falta el texto`);
      if (botones.length > MAX_BOTONES) errores.push(`${quien}: como mucho ${MAX_BOTONES} botones`);
      if (botones.length && String(d.texto || '').length > 640) errores.push(`${quien}: con botones, el texto va hasta 640 caracteres`);
      botones.forEach((b, j) => {
        if (!String(b.titulo || '').trim()) errores.push(`${quien}: el botón ${j + 1} no tiene texto`);
        else if (String(b.titulo).length > 20) errores.push(`${quien}: el botón «${b.titulo}» pasa de 20 caracteres`);
        if (b.tipo === 'enlace' && !esUrl(b.url)) errores.push(`${quien}: el botón «${b.titulo || j + 1}» necesita un enlace https://`);
        if (b.tipo === 'camino' && primero && !destinoDe(flujo, n.id, `b${j}`)) errores.push(`${quien}: el botón «${b.titulo || j + 1}» no lleva a ningún bloque (conéctalo o hazlo de enlace)`);
      });
    }
    if (n.tipo === 'pregunta') {
      if (!String(d.texto || '').trim()) errores.push(`${quien}: falta la pregunta`);
      const ops = (d.opciones || []).filter(Boolean);
      if (ops.length > MAX_OPCIONES) errores.push(`${quien}: como mucho ${MAX_OPCIONES} respuestas rápidas`);
      if (ops.some((o) => o.length > 20)) errores.push(`${quien}: las respuestas rápidas van hasta 20 caracteres`);
    }
    if (n.tipo === 'esperar') {
      const seg = segundosDeEspera(d);
      const h = d.horario || {};
      if (seg < 1 && !h.activo) errores.push(`${quien}: pon cuánto esperar`);
      else if (seg > 30 * 86400) errores.push(`${quien}: como mucho 30 días`);
      else if (seg >= 86400) avisos.push('Una espera de 24 h o más: Meta solo deja escribir en las 24 h siguientes al último mensaje de la persona, así que lo que venga después puede no llegar');
      if (n !== espera && seg > 0 && seg < 60) avisos.push('Entre mensajes Zernio espera como mínimo 1 minuto: los segundos solo valen justo después del disparador (antes de la respuesta privada); aquí se redondea a 1 minuto');
      if (h.activo && (!(Number(h.desde) >= 0 && Number(h.desde) <= 23) || !(Number(h.hasta) >= 0 && Number(h.hasta) <= 23) || Number(h.desde) === Number(h.hasta))) errores.push(`${quien}: el horario necesita una hora de inicio y otra de fin distintas`);
    }
    if (n.tipo === 'etiqueta' && !String(d.etiqueta || '').trim()) errores.push(`${quien}: falta la etiqueta`);
    if (n.tipo === 'condicion' && d.tipo !== 'sigue' && !String(d.valor || '').trim()) errores.push(`${quien}: falta con qué comparar`);
  }
  return { errores, avisos };
}
