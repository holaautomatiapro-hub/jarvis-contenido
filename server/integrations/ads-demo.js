import { demoInstagram } from './instagram-demo.js';

// Ejemplo de la pestaña Meta Ads (campañas y páginas FICTICIAS) para ver cómo queda antes de conectar.
const DIA = 86400000;

export function demoAds({ hoy = Date.now() } = {}) {
  const campanas = [
    { id: 'demo-1', nombre: 'TOFU · Reels de automatización', estado: 'ACTIVE', objetivo: 'OUTCOME_ENGAGEMENT', gasto: 412.6, impresiones: 98400, alcance: 61200, clics: 2655, ctr: 2.7, cpc: 0.16, cpm: 4.19, resultados: 5180, tipoResultado: 'interacciones', costeResultado: 0.08 },
    { id: 'demo-2', nombre: 'Leads · Lead magnet setter IA', estado: 'ACTIVE', objetivo: 'OUTCOME_LEADS', gasto: 286.3, impresiones: 41200, alcance: 30100, clics: 1530, ctr: 3.71, cpc: 0.19, cpm: 6.95, resultados: 214, tipoResultado: 'leads', costeResultado: 1.34 },
    { id: 'demo-3', nombre: 'Retargeting · Casos de éxito', estado: 'PAUSED', objetivo: 'OUTCOME_ENGAGEMENT', gasto: 96.1, impresiones: 18800, alcance: 9900, clics: 301, ctr: 1.6, cpc: 0.32, cpm: 5.11, resultados: 690, tipoResultado: 'interacciones', costeResultado: 0.14 },
  ];
  const sum = (k) => campanas.reduce((a, c) => a + c[k], 0);
  const gasto = sum('gasto'), impresiones = sum('impresiones'), clics = sum('clics');
  const rendimiento = {
    cuenta: { id: 'act_ejemplo', nombre: 'Cuenta de ejemplo', moneda: 'EUR', activa: true },
    dias: 30,
    totales: { gasto, impresiones, clics, ctr: Math.round((clics / impresiones) * 10000) / 100, cpc: Math.round((gasto / clics) * 100) / 100, cpm: Math.round((gasto / impresiones) * 100000) / 100 },
    diario: Array.from({ length: 30 }, (_, i) => ({ fecha: new Date(hoy - (29 - i) * DIA).toLocaleDateString('sv-SE'), gasto: Math.round((18 + Math.sin(i / 3) * 6 + (i % 7 === 5 ? -8 : 0)) * 100) / 100, clics: 120 + ((i * 37) % 60) })),
    campanas,
  };
  const biblioteca = [
    { id: 'demo-a1', competidor: 'ejemplo.chatbots', pagina: 'Ejemplo Chatbots', cuerpo: '¿Pierdes clientes por contestar tarde? Nuestro asistente responde en 5 segundos, 24/7.', titulo: 'Prueba 14 días gratis', diasActivo: 96, activo: true, plataformas: 'instagram, facebook', alcance_ue: 182000 },
    { id: 'demo-a2', competidor: 'ejemplo.ventasia', pagina: 'Ejemplo Ventas IA', cuerpo: 'Así automatizamos 300 DMs al día para una clínica dental (sin perder el trato humano).', titulo: 'Ver el caso completo', diasActivo: 61, activo: true, plataformas: 'instagram', alcance_ue: 94000 },
    { id: 'demo-a3', competidor: 'ejemplo.chatbots', pagina: 'Ejemplo Chatbots', cuerpo: 'Plantilla gratis: los 7 mensajes que más venden por WhatsApp.', titulo: 'Descárgala aquí', diasActivo: 34, activo: true, plataformas: 'instagram, facebook', alcance_ue: 57000 },
    { id: 'demo-a4', competidor: 'ejemplo.ventasia', pagina: 'Ejemplo Ventas IA', cuerpo: 'Webinar: cómo montar tu setter con IA en una tarde.', titulo: 'Plazas limitadas', diasActivo: 9, activo: false, plataformas: 'facebook', alcance_ue: 12000 },
  ];
  return { rendimiento, biblioteca, media: demoInstagram({ hoy }).media };
}
