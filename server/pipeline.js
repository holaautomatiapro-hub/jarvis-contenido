import { ajustes, ESTADOS, row } from './db.js';

// Fases del pipeline de contenido. Se pueden añadir, renombrar, recolorear, ordenar y borrar.
// Tres son del sistema y no se borran (sí se renombran): "idea" (donde caen las ideas nuevas),
// "listo" (lo que se programa para Instagram y lo que exporta Diseño) y "publicado".

export class PipelineError extends Error {
  constructor(m) { super(m); this.publico = true; }
}

export const FASES_SISTEMA = ['idea', 'listo', 'publicado'];
export const COLORES = ['var(--blue)', 'var(--purple)', 'var(--orange)', 'var(--pink)', 'var(--cyan)', 'var(--green)', 'var(--red)', '#eab308'];
const ICONOS = ['bulb', 'pen', 'mic', 'layers', 'calendar', 'checkCircle', 'target', 'eye', 'play', 'sparkle', 'bolt', 'users', 'chart', 'doc', 'clock'];
export const FASES_BASE = [
  { id: 'idea', label: 'Idea', color: 'var(--blue)', icon: 'bulb', ayuda: 'Por desarrollar' },
  { id: 'guion', label: 'Guion', color: 'var(--purple)', icon: 'pen', ayuda: 'Escribiendo el guion' },
  { id: 'grabar', label: 'Grabar', color: 'var(--orange)', icon: 'mic', ayuda: 'Listos para grabar' },
  { id: 'editar', label: 'Editar', color: 'var(--pink)', icon: 'layers', ayuda: 'Grabados, por editar' },
  { id: 'listo', label: 'Listo', color: 'var(--cyan)', icon: 'calendar', ayuda: 'Listos para publicar' },
  { id: 'publicado', label: 'Publicado', color: 'var(--green)', icon: 'checkCircle', ayuda: 'Ya están en redes' },
];
const MAX_FASES = 12;

const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24);

export function createPipeline({ db }) {
  const aj = ajustes(db);
  const contar = db.prepare('SELECT COUNT(*) AS n FROM piezas WHERE estado = ?');
  const mover = db.prepare("UPDATE piezas SET estado = ?, actualizado = datetime('now','localtime') WHERE estado = ?");

  const fases = () => {
    const l = aj.leer('pipeline_fases');
    return Array.isArray(l) && l.length ? l.map((f) => ({ ...f, sistema: FASES_SISTEMA.includes(f.id) })) : FASES_BASE.map((f) => ({ ...f, sistema: FASES_SISTEMA.includes(f.id) }));
  };
  const ids = () => fases().map((f) => f.id);
  const existe = (id) => ids().includes(id);
  const etiqueta = (id) => fases().find((f) => f.id === id)?.label || id;

  // Para crear piezas: las fases que traía JARVIS de serie (guion, grabar, editar) puede que ya no existan
  // (p. ej. la biblioteca crea piezas en "editar"): entonces van a la primera fase de trabajo o a Idea.
  function normalizar(id) {
    if (existe(id)) return id;
    if (ESTADOS.includes(id)) {
      const l = fases();
      return (l.find((f) => !f.sistema) || l[0]).id;
    }
    throw new PipelineError(`Fase no válida. Usa: ${ids().join(', ')}`);
  }

  // Guarda la lista completa. "mover" dice a qué fase pasan las piezas de las fases que se borran: { vieja: nueva }.
  function guardar(lista, { mover: destinos = {} } = {}) {
    if (!Array.isArray(lista) || !lista.length) throw new PipelineError('El pipeline necesita fases');
    if (lista.length > MAX_FASES) throw new PipelineError(`Como mucho ${MAX_FASES} fases`);
    const usados = new Set();
    // Una fase nueva no puede quedarse con el id de otra (tampoco de una que se borra ahora)
    const reservados = new Set([...ids(), ...lista.map((f) => f?.id).filter(Boolean)]);
    const nuevas = lista.map((f, i) => {
      const label = String(f?.label || '').trim().slice(0, 30);
      if (!label) throw new PipelineError(`La fase ${i + 1} necesita un nombre`);
      let id;
      if (f.id && /^[a-z0-9_]{1,24}$/.test(f.id)) {
        if (usados.has(f.id)) throw new PipelineError(`La fase «${label}» está repetida`);
        id = f.id;
      } else {
        const base = slug(label) || 'fase';
        id = base;
        for (let n = 2; usados.has(id) || reservados.has(id); n++) id = `${base}_${n}`;
      }
      usados.add(id);
      return {
        id, label,
        color: COLORES.includes(f.color) || /^#[0-9a-f]{6}$/i.test(f.color || '') ? f.color : COLORES[i % COLORES.length],
        icon: ICONOS.includes(f.icon) ? f.icon : 'layers',
        ayuda: String(f.ayuda || '').trim().slice(0, 60),
      };
    });
    for (const s of FASES_SISTEMA) if (!usados.has(s)) throw new PipelineError(`La fase «${etiqueta(s)}» es del sistema y no se puede borrar (sí renombrar)`);
    // Idea siempre al principio y Publicado al final
    const ordenadas = [nuevas.find((f) => f.id === 'idea'), ...nuevas.filter((f) => f.id !== 'idea' && f.id !== 'publicado'), nuevas.find((f) => f.id === 'publicado')];

    const borradas = ids().filter((id) => !usados.has(id));
    for (const id of borradas) {
      const n = row(contar, id).n;
      if (!n) continue;
      const destino = destinos[id];
      if (!destino || !usados.has(destino)) throw new PipelineError(`«${etiqueta(id)}» tiene ${n} ${n === 1 ? 'pieza' : 'piezas'}: elige a qué fase pasan`);
    }
    db.exec('BEGIN');
    try {
      for (const id of borradas) if (destinos[id]) mover.run(destinos[id], id);
      aj.guardar('pipeline_fases', ordenadas);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    return fases();
  }

  return { fases, ids, existe, etiqueta, normalizar, guardar };
}
