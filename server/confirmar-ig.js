import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { ajustes } from './db.js';
import { planDePublicacion, instanteDe, NOMBRE_TIPO_IG } from '../web/src/lib/planIg.js';

// Publicar en Instagram desde Telegram, CON TU CONFIRMACIÓN. Le pides a JARVIS (Hermes) que publique una pieza:
//   1. solicitar: JARVIS te manda por Telegram (con el bot, directamente) las fotos, el texto, el día y la hora y un
//      código de un solo uso. La IA no ve ese mensaje ni el código: solo sabe que te lo ha mandado.
//   2. confirmar: respondes «publica CÓDIGO»; con ese código (y solo con él) la pieza queda programada.
// El código caduca a los 30 min, vale para esa pieza tal y como estaba (si cambian sus archivos o su texto hay que
// pedirlo otra vez) y la hora tiene un margen mínimo para que te dé tiempo a cancelarla.

export class ConfirmarError extends Error {
  constructor(m) { super(m); this.publico = true; }
}

const MIN = 60_000;
const LETRAS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sin 0/O ni 1/I/L, que se confunden
const MAX_FALLOS = 5;
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const hash = (sal, codigo) => createHash('sha256').update(`${sal}:${codigo}`).digest();
const huellaDe = (p) => createHash('sha256').update(JSON.stringify({ a: (p.archivos || []).map((a) => a.path || a.url), c: p.caption || '', f: p.formato || '', p: p.portada?.path || null })).digest('hex');
const dos = (n) => String(n).padStart(2, '0');
const fechaDe = (d) => `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
const horaDe = (d) => `${dos(d.getHours())}:${dos(d.getMinutes())}`;
const legible = (fecha, hora) => { const d = new Date(`${fecha}T${hora}:00`); return `${DIAS[d.getDay()]} ${d.getDate()} ${MESES[d.getMonth()]}, ${hora}`; };
export const limpiarCodigo = (t) => String(t || '').toUpperCase().replace(/PUBLICA/g, '').replace(/[^A-Z0-9]/g, '');

export function createConfirmacionesIg({ db, jarvis, publicadorIg, telegram, archivos = null, ahora = () => new Date(), margenMin = 10, caducaMin = 30, log = console }) {
  const aj = ajustes(db);
  const leerPendientes = () => (aj.leer('ig_confirmaciones', []) || []).filter((x) => x.expira > ahora().getTime());
  const guardarPendientes = (l) => aj.guardar('ig_confirmaciones', l);

  function comprobarPieza(p) {
    if (p.ig_estado === 'publicado') throw new ConfirmarError(`«${p.titulo}» ya está publicada en Instagram.`);
    const motivo = publicadorIg?.estado?.().motivo;
    if (motivo) throw new ConfirmarError(motivo);
  }

  // 1. Te manda el resumen y el código. Devuelve lo que puede contarte la IA (sin el código).
  async function solicitar({ pieza_id, fecha = null, hora = null } = {}) {
    if (!telegram?.configurado()) throw new ConfirmarError('JARVIS no puede escribirte por Telegram para que lo confirmes (falta el bot de Hermes). Prográmala desde la ficha de la pieza en JARVIS.');
    const p = jarvis.leerPieza(pieza_id);
    comprobarPieza(p);
    const ya = ahora();
    let cuando;
    if (fecha || hora) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha || '')) || !/^\d{2}:\d{2}$/.test(String(hora || ''))) throw new ConfirmarError('Di el día (AAAA-MM-DD) y la hora (HH:MM) a la que quieres que salga, o ninguno para publicarla en cuanto lo confirmes.');
      cuando = new Date(`${fecha}T${hora}:00`);
      if (Number.isNaN(cuando.getTime())) throw new ConfirmarError('Esa fecha no existe');
      if (cuando.getTime() < ya.getTime() + margenMin * MIN) throw new ConfirmarError(`Ponle una hora con al menos ${margenMin} minutos de margen (para que puedas cancelarla), o no pongas hora y saldrá en cuanto lo confirmes.`);
    } else cuando = null; // «en cuanto lo confirme»: se fija al confirmar (con el margen)
    const previsto = cuando || new Date(ya.getTime() + margenMin * MIN);
    const plan = planDePublicacion({ ...p, fecha: fechaDe(previsto), hora: horaDe(previsto) });
    if (plan.problemas.length) throw new ConfirmarError(`No se puede publicar todavía: ${plan.problemas.join(' ')}`);

    const codigo = Array.from({ length: 6 }, () => LETRAS[randomInt(LETRAS.length)]).join('');
    const sal = randomBytes(8).toString('hex');
    const pendiente = { id: randomBytes(6).toString('hex'), pieza: p.id, fecha: cuando ? fechaDe(cuando) : null, hora: cuando ? horaDe(cuando) : null,
      huella: huellaDe(p), sal, hash: hash(sal, codigo).toString('hex'), expira: ya.getTime() + caducaMin * MIN };

    const fotos = (p.archivos || []).filter((a) => /^image\//.test(a.mime || '')).map((a) => { try { return archivos?.ruta(a.path); } catch { return null; } }).filter(Boolean);
    const videos = (p.archivos || []).filter((a) => /^video\//.test(a.mime || '')).length;
    try { if (fotos.length) await telegram.enviarFotos(fotos); } catch (e) { log.warn?.(`  Telegram (fotos): ${e.message}`); }
    const caption = String(p.caption || '').trim();
    await telegram.enviar([
      '📸 ¿Publico esto en Instagram?', '',
      `«${p.titulo}»`,
      `${NOMBRE_TIPO_IG[plan.tipo] || 'publicación'} · ${[fotos.length && `${fotos.length} ${fotos.length === 1 ? 'foto' : 'fotos'}`, videos && `${videos} ${videos === 1 ? 'vídeo' : 'vídeos'}`].filter(Boolean).join(' y ') || 'sin archivos'}`,
      `Sale: ${cuando ? legible(fechaDe(cuando), horaDe(cuando)) : `en cuanto lo confirmes (unos ${margenMin} min después)`}`, '',
      caption ? `Texto:\n${caption.length > 900 ? `${caption.slice(0, 900)}…` : caption}` : 'Sin texto (caption vacío).', '',
      `Para publicarlo, responde:  publica ${codigo}`,
      `(Caduca en ${caducaMin} min. Si no respondes, no se publica nada.)`,
    ].join('\n'));

    guardarPendientes([...leerPendientes().filter((x) => x.pieza !== p.id), pendiente]);
    return {
      ok: true, pieza: { id: p.id, titulo: p.titulo }, tipo: NOMBRE_TIPO_IG[plan.tipo], fecha: pendiente.fecha, hora: pendiente.hora,
      aviso: 'Le he mandado a la persona por Telegram las fotos, el texto, el día y la hora, con un código para confirmar. Dile que lo revise y que, si está bien, responda «publica» seguido del código. Tú NO conoces el código: no lo inventes, no lo pidas por otra vía y no lo confirmes sin que ella lo escriba.',
    };
  }

  // 2. Con el código que te llegó por Telegram (y solo con él), la pieza queda programada.
  async function confirmar({ codigo } = {}) {
    const c = limpiarCodigo(codigo);
    const ya = ahora().getTime();
    const fallos = (aj.leer('ig_confirmaciones_fallos', []) || []).filter((t) => t > ya - 15 * MIN);
    if (fallos.length >= MAX_FALLOS) {
      guardarPendientes([]);
      throw new ConfirmarError('Demasiados códigos equivocados: he anulado las confirmaciones pendientes. Pide otra vez que publique la pieza.');
    }
    const pendientes = leerPendientes();
    const p0 = c.length === 6 && pendientes.find((x) => timingSafeEqual(Buffer.from(x.hash, 'hex'), hash(x.sal, c)));
    if (!p0) {
      aj.guardar('ig_confirmaciones_fallos', [...fallos, ya]);
      throw new ConfirmarError('Ese código no vale o ha caducado. Pide otra vez que publique la pieza y usa el código nuevo que te llegue por Telegram.');
    }
    guardarPendientes(pendientes.filter((x) => x !== p0));
    aj.guardar('ig_confirmaciones_fallos', []);
    const p = jarvis.leerPieza(p0.pieza);
    comprobarPieza(p);
    if (huellaDe(p) !== p0.huella) throw new ConfirmarError(`«${p.titulo}» ha cambiado (archivos o texto) desde que te mandé el resumen. Pide otra vez que la publique para ver cómo queda ahora.`);
    // Si la hora ya pasó (o no había hora), sale a los pocos minutos: lo acabas de confirmar
    let cuando = p0.fecha ? new Date(`${p0.fecha}T${p0.hora}:00`) : null;
    if (!cuando || cuando.getTime() < ya + 2 * MIN) cuando = new Date(ya + (p0.fecha ? 2 : margenMin) * MIN);
    jarvis.actualizarPieza(p.id, { fecha: fechaDe(cuando), hora: horaDe(cuando) }, 'hermes');
    publicadorIg.marcar(p.id, true);
    const cuandoTxt = legible(fechaDe(cuando), horaDe(cuando));
    try { await telegram.enviar(`✅ Programado: «${p.titulo}» sale el ${cuandoTxt}.\nTe aviso cuando esté publicado. Para pararlo, dile a JARVIS «cancela la publicación de ${p.titulo}».`); } catch { /* ya está programado */ }
    return { ok: true, pieza: { id: p.id, titulo: p.titulo }, fecha: fechaDe(cuando), hora: horaDe(cuando), sale: cuandoTxt };
  }

  // Cancelar no necesita código: deja de estar programada (si aún no ha salido)
  async function cancelar({ pieza_id } = {}) {
    const p = jarvis.leerPieza(pieza_id);
    guardarPendientes(leerPendientes().filter((x) => x.pieza !== p.id));
    if (p.ig_estado === 'publicado') throw new ConfirmarError(`«${p.titulo}» ya está publicada: bórrala desde Instagram si no quieres que siga.`);
    if (p.ig_estado === 'procesando') throw new ConfirmarError(`«${p.titulo}» se está publicando ahora mismo: ya no se puede parar desde aquí.`);
    if (p.publicar_ig) publicadorIg.marcar(p.id, false);
    try { if (telegram?.configurado()) await telegram.enviar(`⏹ Cancelado: «${p.titulo}» no se publicará en Instagram.`); } catch { /* da igual */ }
    return { ok: true, pieza: { id: p.id, titulo: p.titulo }, cancelada: true };
  }

  // Lo que está programado en Instagram (para decir qué sale y cuándo)
  function programadas() {
    return jarvis.listarPiezas({}).filter((p) => p.publicar_ig && p.ig_estado !== 'publicado')
      .map((p) => ({ id: p.id, titulo: p.titulo, formato: p.formato, fecha: p.fecha, hora: p.hora, estado: p.ig_estado || 'programada', error: p.ig_error || null }))
      .sort((a, b) => (instanteDe(a)?.getTime() || 0) - (instanteDe(b)?.getTime() || 0));
  }

  return { solicitar, confirmar, cancelar, programadas };
}
