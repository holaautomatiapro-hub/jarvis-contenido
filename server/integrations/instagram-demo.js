// Datos de ejemplo para ver los dashboards de Instagram antes de conectar la cuenta.
// Siempre salen iguales (generador pseudoaleatorio con semilla fija).

const DIA = 86400000;
const fecha = (t) => new Date(t).toLocaleDateString('sv-SE');

function azar(semilla = 7) {
  let s = semilla;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}

const PIEZAS = [
  ['Productividad con IA', 'Reels', 'Deja de contestar WhatsApps a mano: esto lo hace la IA por ti'],
  ['Automatización de ventas', 'Reels', '3 automatizaciones que me ahorran 10 horas a la semana'],
  ['Herramientas', 'Carruseles', '7 prompts para vender por WhatsApp sin sonar a robot'],
  ['Casos reales', 'Reels', 'Así recuperé 14 clientes que no me contestaban'],
  ['Productividad con IA', 'Carruseles', 'Mi sistema para organizar el día con IA'],
  ['Mentalidad', 'Imágenes', 'Automatizar no es de vagos'],
  ['Automatización de ventas', 'Reels', '¿Cuántos clientes pierdes por contestar tarde?'],
  ['Herramientas', 'Reels', 'La herramienta que uso para responder comentarios con IA'],
  ['Casos reales', 'Carruseles', 'De 0 a 50 leads al mes con un setter de IA'],
  ['Productividad con IA', 'Reels', 'Le pregunto a JARVIS qué toca hoy y me organiza el día'],
  ['Mentalidad', 'Reels', 'Nadie te cuenta esto de automatizar tu negocio'],
  ['Herramientas', 'Imágenes', 'Las 5 apps que más uso cada semana'],
];

export function demoInstagram({ hoy = Date.now(), dias = 60 } = {}) {
  const r = azar();
  const media = [];
  let i = 0;
  for (let d = dias - 1; d >= 0; d -= 1 + Math.floor(r() * 2)) {
    const [tema, formato, gancho] = PIEZAS[i % PIEZAS.length];
    const base = formato === 'Reels' ? 9000 : formato === 'Carruseles' ? 5200 : 2600;
    const empuje = tema === 'Automatización de ventas' ? 1.9 : tema === 'Casos reales' ? 1.5 : tema === 'Mentalidad' ? 0.7 : 1;
    const alcance = Math.round(base * empuje * (0.5 + r() * 1.3));
    const views = Math.round(alcance * (formato === 'Reels' ? 1.6 + r() : 1.2 + r() * 0.4));
    const tasa = (formato === 'Carruseles' ? 0.07 : 0.05) * (0.6 + r() * 0.9) * (tema === 'Casos reales' ? 1.4 : 1);
    const interacciones = Math.round(alcance * tasa);
    media.push({
      id: `demo-${i}`, formato, tema, gancho, caption: `${gancho}\n\nComenta JARVIS y te lo mando por DM.`,
      permalink: null, miniatura: null, fecha: new Date(hoy - d * DIA - 3 * 3600000).toISOString(),
      alcance, views, interacciones,
      guardados: Math.round(interacciones * (formato === 'Carruseles' ? 0.35 : 0.18)),
      compartidos: Math.round(interacciones * 0.12),
      likes: Math.round(interacciones * 0.6), comentarios: Math.round(interacciones * 0.08),
      ver_medio_ms: formato === 'Reels' ? Math.round(6000 + r() * 9000) : null,
      transcrita: formato === 'Reels' ? 1 : 0,
    });
    i++;
  }
  const serie = [];
  let seguidores = 18200;
  for (let d = dias - 1; d >= 0; d--) {
    const nuevos = Math.round(40 + r() * 90);
    seguidores += nuevos;
    serie.push({ fecha: fecha(hoy - d * DIA), metrica: 'alcance', valor: Math.round(30000 + r() * 22000 + (dias - d) * 380) });
    serie.push({ fecha: fecha(hoy - d * DIA), metrica: 'nuevos', valor: nuevos });
  }
  serie.push({ fecha: fecha(hoy), metrica: 'seguidores', valor: seguidores });
  return { media, serie };
}
