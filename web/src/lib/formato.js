// Formato de números y fechas en español
const compacto = new Intl.NumberFormat('es-ES', { notation: 'compact', maximumFractionDigits: 1 });
const entero = new Intl.NumberFormat('es-ES');

export const num = (n) => (n == null ? '—' : Math.abs(n) >= 10000 ? compacto.format(n) : entero.format(Math.round(n)));
export const numLargo = (n) => (n == null ? '—' : entero.format(Math.round(n)));
export const fechaCorta = (d) => new Date(d).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }).replace('.', '');
export const segundos = (ms) => (ms == null ? '—' : `${(ms / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} s`);
export const hace = (iso) => {
  if (!iso) return 'nunca';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'ahora mismo';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `hace ${h} h` : `hace ${Math.round(h / 24)} d`;
};
