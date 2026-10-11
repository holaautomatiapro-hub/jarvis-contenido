// Fechas locales en formato AAAA-MM-DD (sin husos horarios: mediodía para que sumar días no se descuadre)
export const iso = (d = new Date()) => d.toLocaleDateString('sv-SE');
export const hoyIso = () => iso(new Date());
export const fechaDe = (s) => new Date(`${s}T12:00:00`);
export const sumarDias = (s, n) => { const d = fechaDe(s); d.setDate(d.getDate() + n); return iso(d); };
export const lunesDe = (s) => { const d = fechaDe(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); };
export const mesDe = (s) => s.slice(0, 7);
export const finDeMes = (m) => { const [a, mm] = m.split('-').map(Number); return `${m}-${String(new Date(a, mm, 0).getDate()).padStart(2, '0')}`; };
export const sumarMeses = (m, n) => { const [a, mm] = m.split('-').map(Number); const d = new Date(a, mm - 1 + n, 1, 12); return iso(d).slice(0, 7); };

const mayus = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export const nombreMes = (m) => mayus(fechaDe(`${m}-01`).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }));
export const diaCorto = (s) => fechaDe(s).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '');
export const diaLargo = (s) => mayus(fechaDe(s).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }));
const dm = (s) => fechaDe(s).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }).replace(/\./g, '');
export const rangoSemana = (lunes) => {
  const dom = sumarDias(lunes, 6);
  return mesDe(lunes) === mesDe(dom) ? `${fechaDe(lunes).getDate()}–${dm(dom)}` : `${dm(lunes)} – ${dm(dom)}`;
};

// Texto de la fecha límite de una tarea: "Hoy", "Mañana", "Semana 12–18 oct", "Octubre 2026"…
export function textoPlazo(t) {
  if (!t.plazo_tipo) return 'Sin fecha';
  const h = hoyIso();
  if (t.plazo_tipo === 'dia') {
    if (t.plazo_desde === h) return 'Hoy';
    if (t.plazo_desde === sumarDias(h, 1)) return 'Mañana';
    if (t.plazo_desde === sumarDias(h, -1)) return 'Ayer';
    return diaCorto(t.plazo_desde);
  }
  if (t.plazo_tipo === 'semana') return t.plazo_desde === lunesDe(h) ? 'Esta semana' : `Semana ${rangoSemana(t.plazo_desde)}`;
  return mesDe(t.plazo_desde) === mesDe(h) ? 'Este mes' : nombreMes(mesDe(t.plazo_desde));
}

// Las 42 celdas (6 semanas, empezando en lunes) del calendario de un mes
export function celdasMes(m) {
  const primero = lunesDe(`${m}-01`);
  return Array.from({ length: 42 }, (_, i) => sumarDias(primero, i));
}
