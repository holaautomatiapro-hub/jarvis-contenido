import { PROMPT_ANALISIS } from './competencia.js';

// Trabajos automáticos: sincronizar Instagram cada pocas horas y, después, pedirle a JARVIS
// que clasifique los temas nuevos y que actualice el perfil de voz cuando haya transcripciones.

const HORA = 3600000;

export function createJobs({ instagram, competencia, ads, asistente, skills, vault, ajustesDb, env = process.env, log = console }) {
  let timer = null;

  // Tareas de JARVIS en segundo plano (conversación "sistema", no molesta a la principal)
  function tareasJarvis() {
    if (!asistente || env.JARVIS_AUTO === '0' || asistente.estado().ocupado) return null;
    const sinTema = instagram.sinTema(1).length;
    if (sinTema) {
      return asistente.preguntar({
        conversacion: 'sistema', modelo: 'haiku',
        texto: 'Clasifica por tema las publicaciones de Instagram que no tienen tema: usa publicaciones_sin_tema, mira temas_instagram para reutilizar los temas que ya existen (máximo 8 temas cortos en total, de 1 a 4 palabras) y guarda el resultado con etiquetar_publicaciones. Repite hasta que no queden. Responde solo con un resumen de una línea.',
      });
    }
    // Competencia: análisis semanal si hay datos reales
    if (competencia) {
      const c = competencia.resumen();
      const ultimo = c.analisis?.fecha ? new Date(c.analisis.fecha.replace(' ', 'T')).getTime() : 0;
      const intento = ajustesDb.leer('comp_auto', 0);
      if (!c.demo && Date.now() - Math.max(ultimo, intento) > 7 * 24 * HORA) {
        ajustesDb.guardar('comp_auto', Date.now());
        return asistente.preguntar({ conversacion: 'sistema', modelo: env.JARVIS_MODELO_ANALISIS || 'sonnet', texto: PROMPT_ANALISIS });
      }
    }
    const r = skills.resumen(vault);
    const ultimo = ajustesDb.leer('voz_auto', { transcripciones: 0 });
    if (r.transcripciones >= 5 && (!r.vozLista || r.transcripciones >= ultimo.transcripciones + 10)) {
      ajustesDb.guardar('voz_auto', { transcripciones: r.transcripciones, fecha: new Date().toISOString() });
      return asistente.preguntar({
        conversacion: 'sistema', modelo: 'sonnet',
        texto: 'Usa la skill perfil-de-voz para crear o actualizar _voz.md a partir de las transcripciones de 03-Transcripciones. Responde solo con un resumen de tres líneas de lo aprendido.',
      });
    }
    return null;
  }

  async function sincronizarAhora() {
    try {
      const r = await instagram.sincronizar();
      log.log?.(`  Instagram${r.fuente === 'windsor' ? ' (Windsor)' : ''}: ${r.publicaciones ?? 0} publicaciones sincronizadas, ${r.transcritas ?? 0} reels transcritos`);
    } catch (e) {
      log.warn?.(`  Instagram: ${e.message}`);
    }
    // Competidores: una vez al día
    if (competencia && instagram.estado().conectadoMeta) {
      const ultima = ajustesDb.leer('comp_sync', {}).fin;
      if (!ultima || Date.now() - new Date(ultima).getTime() > 20 * HORA) {
        try { const r = await competencia.sincronizar(); log.log?.(`  Competencia: ${r.perfiles ?? 0} perfiles, ${r.publicaciones ?? 0} publicaciones`); } catch (e) { log.warn?.(`  Competencia: ${e.message}`); }
      }
    }
    // Ad Library de la competencia: una vez al día
    if (ads?.estado().conectado) {
      const ultima = ajustesDb.leer('ads_lib_sync', {}).fin;
      if (!ultima || Date.now() - new Date(ultima).getTime() > 20 * HORA) {
        try { const r = await ads.sincronizarBiblioteca(); log.log?.(`  Ad Library: ${r.anuncios} anuncios`); } catch (e) { log.warn?.(`  Ad Library: ${e.message}`); }
      }
    }
    try { tareasJarvis(); } catch (e) { log.warn?.(`  JARVIS automático: ${e.message}`); }
  }

  function iniciar() {
    const horas = Number(env.IG_SYNC_HORAS) || 6;
    const tick = () => { if (instagram.estado().conectado) sincronizarAhora(); };
    setTimeout(tick, 15000).unref?.();
    timer = setInterval(tick, horas * HORA);
    timer.unref?.();
  }

  return { iniciar, sincronizarAhora, tareasJarvis, parar: () => clearInterval(timer) };
}
