// Ejemplo de la pestaña Competencia con perfiles FICTICIOS (no son cuentas reales).
// Solo se muestra mientras no hay datos reales sincronizados.

const DIA = 86400000;

const POSTS = [
  ['ejemplo.chatbots', 'Reels', 'Tu competencia ya responde en 5 segundos. ¿Y tú?', 2400, 180],
  ['ejemplo.chatbots', 'Carruseles', '5 respuestas automáticas que cierran ventas por WhatsApp', 1900, 240],
  ['ejemplo.ventasia', 'Reels', 'Nadie te dice esto de los chatbots: no venden solos', 3100, 310],
  ['ejemplo.ventasia', 'Reels', 'Así automatizamos 300 DMs al día para una clínica', 2700, 150],
  ['ejemplo.chatbots', 'Imágenes', 'Si vendes por DM, guarda esto', 900, 60],
  ['ejemplo.ventasia', 'Carruseles', 'El guion exacto que usa nuestro setter con IA', 2200, 420],
  ['ejemplo.chatbots', 'Reels', 'Le escribí a 10 negocios y solo 2 respondieron en una hora', 3500, 290],
  ['ejemplo.ventasia', 'Reels', '3 errores que hacen que tu chatbot suene a robot', 2000, 130],
];

export function demoCompetencia({ hoy = Date.now() } = {}) {
  const perfiles = [
    { username: 'ejemplo.chatbots', nombre: 'Perfil de ejemplo 1', seguidores: 48000, ultima_sync: new Date(hoy).toISOString(), activo: true, ficticio: true },
    { username: 'ejemplo.ventasia', nombre: 'Perfil de ejemplo 2', seguidores: 61000, ultima_sync: new Date(hoy).toISOString(), activo: true, ficticio: true },
  ];
  const media = POSTS.map(([username, formato, gancho, likes, comentarios], i) => ({
    id: `demo-c${i}`, username, formato, caption: gancho, gancho, likes, comentarios,
    fecha: new Date(hoy - (i * 3 + 1) * DIA).toISOString(), permalink: null, miniatura: null,
  }));
  const analisis = {
    fecha: new Date(hoy).toISOString(),
    perfiles: perfiles.map((p) => p.username),
    resumen: 'Ejemplo: así se verá el análisis de JARVIS cuando sincronices tus competidores reales.',
    temas: [
      { tema: 'Velocidad de respuesta', pct: 34, detalle: 'Los vídeos que comparan tiempos de respuesta son los que más comentarios generan.' },
      { tema: 'Casos con cifras', pct: 27, detalle: 'Resultados concretos (300 DMs al día, una clínica) por encima de la media.' },
      { tema: 'Guiones y plantillas', pct: 22, detalle: 'Los carruseles con el guion exacto se guardan mucho.' },
      { tema: 'Errores comunes', pct: 17, detalle: 'Funciona como contenido de identificación.' },
    ],
    patrones: [
      { titulo: 'Gancho de comparación', detalle: '"Tu competencia ya… ¿y tú?": pone al espectador frente a otro negocio.' },
      { titulo: 'Experimento propio', detalle: 'Probar algo con 10 negocios y contar el resultado genera curiosidad y credibilidad.' },
      { titulo: 'Carrusel guardable', detalle: 'Plantillas y guiones paso a paso: más guardados que likes.' },
    ],
    ideas: [
      { titulo: 'Escribo a 10 negocios de mi ciudad y mido cuánto tardan en responder', formato: 'Reel', gancho: 'Le escribí a 10 negocios. Solo 2 contestaron en una hora.', porque: 'El experimento propio es el patrón con más engagement; tú puedes enseñar la solución con JARVIS.', inspiradoEn: 'demo-c6' },
      { titulo: 'El guion de mi setter con IA, mensaje a mensaje', formato: 'Carrusel', gancho: 'Te doy el guion exacto que usa mi setter con IA.', porque: 'Los guiones guardables tienen la mejor relación guardados/likes.', inspiradoEn: 'demo-c5' },
      { titulo: '3 señales de que tu chatbot suena a robot (y cómo arreglarlo)', formato: 'Reel', gancho: 'Si tu chatbot dice esto, estás perdiendo ventas.', porque: 'Los errores comunes generan identificación y comentarios.', inspiradoEn: 'demo-c7' },
    ],
  };
  return { perfiles, media, analisis };
}
