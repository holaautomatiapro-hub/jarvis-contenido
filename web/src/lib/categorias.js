// Colores de los botones de la estrategia (LM, Viral, Educar…). Los que añada la persona, uno a partir del nombre.
const COLORES = {
  LM: '#e8912d', Viral: '#e0457b', Testimonio: '#2f9e5b', Educar: '#3987e5', 'Conexión': '#8e5bd9',
  'Q&A': '#17a2b8', Comunidad: '#c9a227', Personal: '#b05bd9', Valor: '#5b8def', Roadmap: '#7a8794',
};
export function colorCategoria(c) {
  if (!c) return 'var(--muted)';
  if (COLORES[c]) return COLORES[c];
  let h = 0;
  for (const ch of String(c)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 55% 52%)`;
}
