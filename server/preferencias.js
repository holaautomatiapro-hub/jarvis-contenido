import { rows } from './db.js';

// Lo que JARVIS aprende de ti: cuando corriges un carrusel o un texto y es un gusto tuyo (no solo de esa pieza),
// Claude lo apunta aquí y lo tiene en cuenta en todo lo que haga después. Lo ves, lo cambias y lo quitas en Diseño.

export const AMBITOS = {
  diseno: 'Diseño (carruseles, stories y portadas)',
  escritura: 'Textos (guiones, captions y ganchos)',
};
const MAX_POR_AMBITO = 60;

export class PreferenciaError extends Error {
  constructor(m) { super(m); this.publico = true; }
}

const igual = (a, b) => String(a).trim().toLowerCase().replace(/[.\s]+$/, '') === String(b).trim().toLowerCase().replace(/[.\s]+$/, '');

export function createPreferencias({ db }) {
  const q = {
    todas: db.prepare('SELECT * FROM preferencias ORDER BY ambito, id'),
    una: db.prepare('SELECT * FROM preferencias WHERE id = ?'),
    ins: db.prepare('INSERT INTO preferencias (ambito, texto, origen) VALUES (?, ?, ?)'),
    upd: db.prepare('UPDATE preferencias SET texto = ?, ambito = ? WHERE id = ?'),
    del: db.prepare('DELETE FROM preferencias WHERE id = ?'),
  };
  const limpiar = (t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const validarAmbito = (a) => {
    if (!AMBITOS[a]) throw new PreferenciaError(`El ámbito debe ser ${Object.keys(AMBITOS).join(' o ')}`);
    return a;
  };

  const listar = ({ ambito } = {}) => rows(q.todas).filter((p) => !ambito || p.ambito === ambito);

  function guardar({ ambito = 'diseno', texto, origen = 'dashboard' } = {}) {
    validarAmbito(ambito);
    const t = limpiar(texto);
    if (!t) throw new PreferenciaError('Escribe la preferencia');
    const ya = listar({ ambito }).find((p) => igual(p.texto, t));
    if (ya) return { ...ya, repetida: true };
    if (listar({ ambito }).length >= MAX_POR_AMBITO) throw new PreferenciaError(`Ya hay ${MAX_POR_AMBITO} preferencias de ${AMBITOS[ambito].toLowerCase()}: quita alguna antes`);
    const { lastInsertRowid } = q.ins.run(ambito, t, String(origen || '').slice(0, 40) || null);
    return q.una.get(Number(lastInsertRowid));
  }
  function cambiar(id, { texto, ambito } = {}) {
    const p = q.una.get(Number(id));
    if (!p) throw new PreferenciaError('Esa preferencia ya no existe');
    const t = texto == null ? p.texto : limpiar(texto);
    if (!t) throw new PreferenciaError('Escribe la preferencia');
    q.upd.run(t, ambito ? validarAmbito(ambito) : p.ambito, p.id);
    return q.una.get(p.id);
  }
  function quitar(id) {
    q.del.run(Number(id));
    return { ok: true };
  }

  // Lo que se añade a las instrucciones de Claude en cada mensaje (ámbitos: los que tocan a esa conversación)
  function instrucciones(ambitos = Object.keys(AMBITOS)) {
    const lista = rows(q.todas).filter((p) => ambitos.includes(p.ambito));
    const lineas = ambitos.flatMap((a) => {
      const l = lista.filter((p) => p.ambito === a);
      return l.length ? [`${AMBITOS[a]}:`, ...l.map((p) => `- ${p.texto}`)] : [];
    });
    return `${lineas.length ? `LO QUE HAS APRENDIDO DE LA PERSONA (síguelo siempre; manda sobre la guía del kit y los ejemplos, salvo que ahora pida otra cosa):\n${lineas.join('\n')}\n\n` : ''}Cuando te corrija algo, decide: si solo vale para esta pieza (un dato, una frase concreta), cámbialo y ya. Si es un gusto suyo que vale para las próximas (estilo, tamaños, colores, tono, estructura, cosas que no quiere ver), cámbialo y además apúntalo con guardar_preferencia (ámbito ${ambitos.join(' o ')}; una frase corta y concreta, en positivo si se puede) y díselo en una línea: «Apuntado para los próximos: …». Si contradice algo de la lista, cambia esa con cambiar_preferencia en vez de añadir otra.`;
  }

  return { listar, guardar, cambiar, quitar, instrucciones };
}
