#!/usr/bin/env node
// MCP "jarvis": da a Claude Code y a Hermes acceso a la memoria (vault) y al pipeline (SQLite).
// Lo que se guarda aquí aparece al momento en el dashboard.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ROOT, getConfig } from '../server/config.js';
import { openDb, CATEGORIAS, OBJETIVOS } from '../server/db.js';
import { createVault, ensureVault, CARPETAS } from '../server/vault.js';
import { createJarvis } from '../server/jarvis.js';
import { ESTADOS_TAREA, PRIORIDADES, PLAZOS } from '../server/tareas.js';
import { createInstagram } from '../server/integrations/instagram.js';
import { createCompetencia } from '../server/integrations/competencia.js';
import { createAds } from '../server/integrations/ads.js';
import { createPublicar, REDES } from '../server/publicar.js';
import { createResultados } from '../server/resultados.js';
import { PIEZAS_TESTIMONIO, PLANTILLAS_REEL } from '../server/laboratorio.js';
import { TIPOS_LM } from '../server/leadmagnets.js';
import { FORMATOS_IMAGEN, TIPOS_IMAGEN } from '../server/imagenes.js';
import { createKit } from '../server/diseno/kit.js';
import { createRecordatorios } from '../server/recordatorios.js';
import { createPreferencias, AMBITOS } from '../server/preferencias.js';
import { reglasDiseno } from '../server/diseno/reglas.js';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { Readable } from 'node:stream';

dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

export function buildServer(jarvis, { origen = 'claude', avisar = () => {}, instagram = null, competencia = null, ads = null, publicar = null, diseno = null, recordatorios = null, resultados = null, laboratorio = null, preferencias = null } = {}) {
  const server = new McpServer({ name: 'jarvis', version: '0.2.0' });

  const tool = (name, description, inputSchema, fn, escribe = false) =>
    server.registerTool(name, { description, inputSchema }, async (args) => {
      try {
        const res = await fn(args ?? {});
        if (escribe) avisar();
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
      } catch (e) {
        return { isError: true, content: [{ type: 'text', text: `Error: ${e.message}` }] };
      }
    });

  // Estrategia de una pieza: para saber después qué pilar, objetivo, gancho y CTA funcionan mejor
  const estrategia = {
    pilar: z.string().optional().describe('Pilar de contenido (usa ver_pilares para reutilizar los que ya tiene la persona)'),
    objetivo: z.enum(OBJETIVOS).optional().describe('atraer (alcance, gente nueva), nutrir (confianza) o convertir (ventas, leads)'),
    gancho: z.string().optional().describe('El gancho: la primera frase o el texto del primer segundo'),
    cta: z.string().optional().describe('La llamada a la acción (p. ej. «comenta GUÍA»)'),
  };

  tool('capturar_idea', 'Guarda una idea de contenido: crea una nota en 01-Ideas y una tarjeta en la columna Idea del pipeline.',
    { texto: z.string().describe('La idea, tal cual la dijo la persona'), formato: z.string().optional().describe('reel, carrusel, historia, post, short…'), pilar: estrategia.pilar, objetivo: estrategia.objetivo },
    ({ texto, formato, pilar, objetivo }) => jarvis.capturarIdea({ texto, formato, pilar, objetivo, origen }), true);

  tool('mi_semana', 'La semana de contenido: qué sale cada día (y los huecos), cómo va el ritmo semanal (objetivo por tipo de pieza), cuántos días de publicación hay cubiertos desde hoy, cuántas piezas listas sin fecha hay de reserva y qué falta producir (piezas con día que aún no están listas).',
    { fecha: z.string().optional().describe('Un día de la semana que quieres ver, AAAA-MM-DD (por defecto hoy)') },
    ({ fecha }) => jarvis.miSemana(fecha ? { fecha } : {}));

  tool('ver_pilares', 'Pilares de contenido que ya usan las piezas de la persona, con cuántas piezas tiene cada uno.', {}, () => jarvis.pilares());

  // Lo que aprende de la persona: sus gustos al corregir diseños y textos, para tenerlos en cuenta la próxima vez
  if (preferencias) {
    const ambito = z.enum(Object.keys(AMBITOS)).describe('diseno (carruseles, stories, portadas) o escritura (guiones, captions, ganchos)');
    tool('ver_preferencias', 'Lo que la persona te ha ido enseñando al corregirte (sus gustos de diseño y de escritura). Léelo antes de diseñar o escribir y síguelo siempre.',
      { ambito: ambito.optional() }, ({ ambito: a }) => preferencias.listar({ ambito: a }).map(({ id, ambito: am, texto }) => ({ id, ambito: am, texto })));
    tool('guardar_preferencia', 'Apunta un gusto de la persona que vale para las próximas piezas (no lo que solo vale para esta). Una frase corta y concreta. Después díselo: «Apuntado para los próximos: …».',
      { ambito, texto: z.string() }, (a) => preferencias.guardar({ ...a, origen }), true);
    tool('cambiar_preferencia', 'Cambia una preferencia apuntada (cuando la persona ahora quiere otra cosa).',
      { id: z.number().int(), texto: z.string() }, ({ id, texto }) => preferencias.cambiar(id, { texto }), true);
    tool('quitar_preferencia', 'Quita una preferencia apuntada que ya no vale.', { id: z.number().int() }, ({ id }) => preferencias.quitar(id), true);
  }

  tool('crear_nota', 'Crea una nota Markdown en el vault de Obsidian.',
    { titulo: z.string(), contenido: z.string().optional(), carpeta: z.enum(CARPETAS).optional().describe('Por defecto 00-Inbox') },
    ({ titulo, contenido, carpeta }) => jarvis.crearNota({ titulo, contenido, carpeta, origen }), true);

  tool('buscar_notas', 'Busca texto en todas las notas del vault (título y contenido, sin distinguir tildes).',
    { consulta: z.string() },
    ({ consulta }) => jarvis.vault.search(consulta, 20));

  tool('leer_nota', 'Lee una nota del vault por su ruta (por ejemplo "01-Ideas/Mi idea.md").',
    { ruta: z.string() },
    ({ ruta }) => jarvis.vault.read(ruta));

  tool('editar_nota', 'Cambia una nota que ya existe: su contenido completo (léela antes con leer_nota y devuelve el texto entero ya cambiado) y/o su título (renombra el archivo).',
    { ruta: z.string(), contenido: z.string().optional(), titulo: z.string().optional() },
    ({ ruta, contenido, titulo }) => jarvis.editarNota(ruta, { contenido, titulo }), true);

  tool('borrar_nota', 'Manda una nota a la papelera del vault (.trash; se puede recuperar desde Obsidian). Pide confirmación a la persona antes de usarla.',
    { ruta: z.string() },
    ({ ruta }) => jarvis.borrarNota(ruta), true);

  tool('listar_notas', 'Lista las notas más recientes, opcionalmente de una carpeta.',
    { carpeta: z.enum(CARPETAS).optional(), limite: z.number().int().min(1).max(200).optional() },
    ({ carpeta, limite = 50 }) => jarvis.vault.list().filter((n) => !carpeta || n.carpeta === carpeta).slice(0, limite));

  tool('crear_pieza', 'Crea una pieza de contenido en el pipeline.',
    {
      titulo: z.string(),
      estado: z.string().optional().describe('Fase del pipeline (id). Usa ver_pipeline para ver las fases'),
      formato: z.string().optional(),
      plataformas: z.array(z.string()).optional(),
      fecha: z.string().optional().describe('Fecha prevista de publicación, AAAA-MM-DD (sin fecha va a la biblioteca)'),
      hora: z.string().optional().describe('HH:MM'),
      caption: z.string().optional().describe('Texto que acompaña a la publicación'),
      nota: z.string().optional().describe('Ruta de la nota asociada en el vault'),
      leadmagnet: z.boolean().optional().describe('Si la pieza lleva lead magnet (p. ej. «comenta GUÍA y te la mando»)'),
      leadmagnet_url: z.string().optional().describe('Enlace del lead magnet (https://…)'),
      ...estrategia,
      padre_id: z.number().int().optional().describe('Si sale de otra pieza (p. ej. un clip de un vídeo largo o el carrusel de un reel), el id de esa pieza'),
      origen_ref: z.string().optional().describe('De dónde sale si no es de una pieza (p. ej. «Testimonio · Ana»)'),
    },
    (a) => jarvis.crearPieza({ ...a, origen }), true);

  tool('mover_pieza', 'Mueve una pieza a otra columna del pipeline o cambia sus datos.',
    {
      id: z.number().int(),
      estado: z.string().optional().describe('Fase del pipeline (id). Usa ver_pipeline para ver las fases'),
      titulo: z.string().optional(),
      formato: z.string().optional(),
      plataformas: z.array(z.string()).optional(),
      fecha: z.string().optional().describe('AAAA-MM-DD; cadena vacía la devuelve a la biblioteca'),
      hora: z.string().optional(),
      caption: z.string().optional(),
      nota: z.string().optional(),
      leadmagnet: z.boolean().optional(),
      leadmagnet_url: z.string().optional().describe('Enlace del lead magnet (https://…)'),
      ...estrategia,
      padre_id: z.number().int().nullable().optional().describe('Id de la pieza de la que sale (null para quitarlo)'),
    },
    ({ id, ...cambios }) => jarvis.actualizarPieza(id, cambios, origen), true);

  tool('ver_pipeline', 'Fases del pipeline de contenido en orden (id y nombre). La persona las puede cambiar en el dashboard: usa siempre estos ids.', {},
    () => jarvis.pipeline.fases().map(({ id, label, ayuda, sistema }) => ({ id, nombre: label, ayuda, sistema })));

  tool('listar_pipeline', 'Lista las piezas del pipeline de contenido, opcionalmente filtradas por estado.',
    { estado: z.string().optional().describe('Fase del pipeline (id). Usa ver_pipeline para ver las fases') },
    ({ estado }) => jarvis.listarPiezas({ estado }));

  const plazo = {
    plazo_tipo: z.enum(PLAZOS).nullable().optional().describe('Fecha límite: dia (un día concreto), semana o mes; null = sin fecha. Por defecto, un día'),
    plazo: z.string().optional().describe('dia: AAAA-MM-DD · semana: AAAA-Www o un día de esa semana · mes: AAAA-MM. Por defecto, hoy / esta semana / este mes'),
  };
  tool('anadir_tarea', 'Añade una tarea. Por defecto es para hoy, prioridad media y sin empezar.',
    {
      titulo: z.string(),
      descripcion: z.string().optional(),
      fecha: z.string().optional().describe('AAAA-MM-DD (atajo de un día concreto), por defecto hoy'),
      ...plazo,
      prioridad: z.enum(PRIORIDADES).optional(),
      estado: z.enum(ESTADOS_TAREA).optional(),
      categoria: z.enum(CATEGORIAS).optional(),
    },
    (a) => jarvis.crearTarea({ ...a, origen }), true);

  tool('actualizar_tarea', 'Cambia una tarea: título, descripción, estado (sin_empezar, en_proceso, terminada), prioridad, categoría o fecha límite.',
    {
      id: z.number().int(),
      titulo: z.string().optional(),
      descripcion: z.string().optional(),
      estado: z.enum(ESTADOS_TAREA).optional(),
      prioridad: z.enum(PRIORIDADES).optional(),
      categoria: z.enum(CATEGORIAS).optional(),
      ...plazo,
    },
    ({ id, ...cambios }) => jarvis.actualizarTarea(id, cambios, origen), true);

  tool('completar_tarea', 'Marca una tarea como terminada (o pendiente con hecha=false).',
    { id: z.number().int(), hecha: z.boolean().optional() },
    ({ id, hecha = true }) => jarvis.marcarTarea(id, hecha, origen), true);

  tool('listar_tareas', 'Lista tareas con filtros (todos opcionales). atrasada = no terminada y su fecha límite ya pasó.',
    {
      estado: z.array(z.enum(ESTADOS_TAREA)).optional(),
      prioridad: z.array(z.enum(PRIORIDADES)).optional(),
      categoria: z.array(z.enum(CATEGORIAS)).optional(),
      desde: z.string().optional().describe('AAAA-MM-DD: tareas cuya fecha límite cae en o después'),
      hasta: z.string().optional().describe('AAAA-MM-DD'),
      sinFecha: z.boolean().optional(),
      atrasadas: z.boolean().optional(),
      texto: z.string().optional(),
    },
    (f) => jarvis.listarTareas(f));

  tool('borrar_tarea', 'Elimina una tarea. Pide confirmación a la persona antes de usarla.',
    { id: z.number().int() },
    ({ id }) => jarvis.borrarTarea(id), true);

  tool('tareas_de_hoy', 'Devuelve las tareas que vencen hoy o caen en esta semana/mes, y las atrasadas.', {}, () => jarvis.tareas());

  tool('resumen_del_dia', 'Resumen del día: tareas, estado del pipeline, piezas previstas para hoy e ideas recientes.', {}, () => jarvis.resumenDelDia());

  if (recordatorios) {
    const DIAS = 'dias: 0 = domingo, 1 = lunes … 6 = sábado; sin dias = todos los días';
    tool('recordatorios_de_hoy', 'Recordatorios que se repiten y tocan hoy (salen en Inicio), con si ya están hechos.', {}, () => recordatorios.deHoy());
    tool('listar_recordatorios', 'Todos los recordatorios que se repiten, con sus días y hora.', {}, () => recordatorios.listar());
    tool('crear_recordatorio', `Crea un recordatorio que se repite (p. ej. «subir una story») y sale cada día en Inicio para marcarlo. ${DIAS}.`,
      { texto: z.string(), dias: z.array(z.number().int().min(0).max(6)).optional(), hora: z.string().optional().describe('HH:MM') },
      ({ texto, dias, hora }) => recordatorios.crear({ texto, dias: dias?.length ? dias : 'diario', hora, origen }), true);
    tool('marcar_recordatorio', 'Marca como hecho hoy un recordatorio (o lo desmarca con hecho=false).',
      { id: z.number().int(), hecho: z.boolean().optional() },
      ({ id, hecho = true }) => recordatorios.marcar(id, { hecho }), true);
    tool('borrar_recordatorio', 'Elimina un recordatorio. Pide confirmación a la persona antes de usarla.',
      { id: z.number().int() }, ({ id }) => recordatorios.borrar(id), true);
  }

  if (instagram) {
    // Resumen compacto para que el modelo no reciba cientos de filas
    const compacto = (r) => ({
      cuenta: r.estado?.username ? `@${r.estado.username}` : null,
      datosDeEjemplo: r.demo,
      periodo: `${r.dias} días`,
      kpis: Object.fromEntries(r.kpis.map((k) => [k.id, { valor: k.value, variacion: k.delta, ...(k.extra != null ? { nuevos: k.extra } : {}) }])),
      formatos: r.formatos,
      temas: r.temas,
      mejoresGanchos: r.ganchos,
      medias: r.medias,
      piezas: r.piezas.slice(0, 40).map((p) => ({ id: p.id, fecha: p.fecha.slice(0, 10), formato: p.formato, tema: p.tema, gancho: p.gancho, alcance: p.alcance, views: p.views, interacciones: p.interacciones, guardados: p.guardados, compartidos: p.compartidos, tasa: p.tasa, vsMedia: p.vsMedia, enlace: p.permalink, nota: p.nota })),
    });
    tool('metricas_instagram', 'Métricas reales de Instagram: KPIs del periodo, formatos, temas, mejores ganchos y rendimiento de cada pieza (vsMedia = % de alcance frente a la media). Si datosDeEjemplo es true, la cuenta aún no está conectada: dilo.',
      { dias: z.number().int().min(7).max(90).optional().describe('Periodo, por defecto 30') },
      ({ dias = 30 }) => compacto(instagram.resumen({ dias })));
    tool('publicaciones_sin_tema', 'Publicaciones de Instagram que aún no tienen tema asignado (para clasificarlas).',
      { limite: z.number().int().min(1).max(60).optional() },
      ({ limite = 30 }) => instagram.sinTema(limite));
    tool('temas_instagram', 'Temas ya usados para clasificar publicaciones, con su número de piezas.', {}, () => instagram.temas());
    tool('etiquetar_publicaciones', 'Asigna un tema corto (1-4 palabras) a publicaciones de Instagram.',
      { etiquetas: z.array(z.object({ id: z.string(), tema: z.string() })).min(1).max(60) },
      ({ etiquetas }) => instagram.etiquetar(etiquetas), true);
  }

  if (competencia) {
    tool('competencia_datos', 'Datos públicos de los competidores (Instagram): perfiles, frecuencia, formatos y publicaciones ordenadas por engagement (interacciones / seguidores, en %).',
      { usuario: z.string().optional().describe('Solo un competidor (sin @)') },
      ({ usuario }) => competencia.datosParaAnalisis({ usuario }));
    tool('competencia_mejores', 'Las mejores publicaciones de la competencia ordenadas por la métrica que elijas (engagement, interacciones, vistas, likes, comentarios o fecha), con filtro por formato y perfil.',
      {
        orden: z.enum(['engagement', 'interacciones', 'vistas', 'likes', 'comentarios', 'fecha']).optional(),
        formato: z.enum(['Reels', 'Carruseles', 'Imágenes']).optional(),
        usuario: z.string().optional().describe('Solo un competidor (sin @)'),
        limite: z.number().int().min(1).max(50).optional(),
      },
      (f) => competencia.mejores(f));
    tool('ver_publicacion_competencia', 'Una publicación de la competencia completa: caption, métricas, transcripción (si es un reel, la hace si se puede) y rutas de las imágenes de los slides (si es un carrusel; léelas con Read para sacar títulos y textos).',
      { id: z.string() },
      async ({ id }) => {
        const { m, slides } = await competencia.paraReplicar(id);
        return { id: m.id, username: m.username, formato: m.formato, fecha: m.fecha, permalink: m.permalink, caption: m.caption, likes: m.likes, comentarios: m.comentarios, vistas: m.vistas, engagement: m.engagement, transcripcion: m.transcripcion || null, slides };
      });
    tool('traer_publicacion', 'Trae una publicación de Instagram de cualquier cuenta profesional desde su enlace (post, carrusel o reel), para replicarla: caption, métricas, transcripción si es un reel y rutas de las imágenes de los slides (léelas con Read, en orden). Si no sabe de qué cuenta es, pide el @usuario.',
      { url: z.string().describe('Enlace de Instagram: instagram.com/p/… o instagram.com/reel/…'), usuario: z.string().optional().describe('La cuenta de la publicación (sin @), si te la pide') },
      async ({ url, usuario }) => {
        const d = await competencia.porEnlace({ url, usuario });
        const { m, slides } = await competencia.paraReplicar(d.id);
        return { id: m.id, username: m.username, formato: m.formato, fecha: m.fecha, permalink: m.permalink, caption: m.caption, likes: m.likes, comentarios: m.comentarios, vistas: m.vistas, engagement: m.engagement, transcripcion: m.transcripcion || null, slides,
          ...(m.formato === 'Reels' && !m.transcripcion ? { aviso: 'Sin transcripción: Instagram no da el vídeo (o falta la clave de ElevenLabs). Pídele que lo descargue y lo suba en Laboratorio → Replicar, o trabaja con el caption.' } : {}) };
      }, true);
    tool('anadir_competidor', 'Añade un perfil de Instagram a la lista de competidores a analizar.',
      { usuario: z.string() },
      ({ usuario }) => competencia.anadir(usuario), true);
    tool('guardar_analisis_competencia', 'Guarda el análisis de competencia: aparece en el dashboard y como nota en 04-Competencia.',
      {
        perfiles: z.array(z.string()).describe('Usuarios analizados'),
        resumen: z.string(),
        temas: z.array(z.object({ tema: z.string(), pct: z.number().describe('% del engagement total'), detalle: z.string() })).max(10),
        patrones: z.array(z.object({ titulo: z.string(), detalle: z.string() })).max(10),
        ideas: z.array(z.object({ titulo: z.string(), formato: z.string(), gancho: z.string(), porque: z.string(), inspiradoEn: z.string().optional().describe('id de la publicación que la inspira') })).max(10),
      },
      (a) => competencia.guardarAnalisis(a), true);
  }

  if (ads) {
    tool('ads_rendimiento', 'Rendimiento de tus campañas de Meta Ads en el periodo: gasto, impresiones, clics, CTR, CPC, CPM y resultados por campaña. Si la cuenta no está conectada devuelve error: dilo.',
      { dias: z.number().int().min(7).max(90).optional() },
      async ({ dias = 30 }) => ads.rendimiento({ dias }));
    tool('ads_biblioteca', 'Anuncios de la competencia en la Ad Library de Meta. diasActivo alto = anuncio que probablemente funciona (lo mantienen).',
      { competidor: z.string().optional().describe('Usuario de Instagram del competidor, sin @') },
      ({ competidor }) => ads.biblioteca().filter((a) => !competidor || a.competidor === competidor.replace(/^@/, '').toLowerCase()).slice(0, 40));
    tool('contenido_para_impulsar', 'Tus publicaciones orgánicas que más conviene impulsar con anuncios (más guardados, compartidos e interacción que tu media).', {},
      () => ads.recomendarImpulso());
    tool('proponer_campana', 'Propone una campaña para impulsar una publicación de Instagram. NO crea nada en Meta: deja un borrador que la persona confirma en la pestaña Meta Ads, y entonces se crea EN PAUSA.',
      {
        publicacionId: z.string().describe('id de la publicación (de contenido_para_impulsar o metricas_instagram)'),
        objetivo: z.enum(['interaccion', 'alcance']).describe('interaccion = más interacción en la publicación; alcance = llegar a más gente'),
        presupuestoDia: z.number().positive().describe('Euros al día'),
        dias: z.number().int().min(1).max(30),
        edadMin: z.number().int().min(18).max(65).optional(),
        edadMax: z.number().int().min(18).max(65).optional(),
        paises: z.array(z.string().length(2)).optional().describe('Códigos de país, por defecto ES'),
        nombre: z.string().optional(),
        motivo: z.string().optional().describe('Por qué esta campaña, en una frase'),
      },
      (a) => ads.proponer(a, origen), true);
  }

  if (resultados) {
    tool('que_me_funciona', 'Qué te funciona en Instagram (datos reales, sin IA): alcance, interacción y guardados+compartidos por cada 1.000 personas, agrupado por pilar, objetivo, formato y CTA de tus piezas, más los mejores y peores ganchos y unas conclusiones (solo con grupos de 3 piezas o más). cobertura dice cuántas publicaciones están unidas a su pieza.',
      { dias: z.number().int().min(30).max(365).optional().describe('Periodo, por defecto 90 días') },
      ({ dias }) => { resultados.vincularTodo(); return resultados.queFunciona({ dias }); });
    tool('resultados_pieza', 'Métricas de Instagram de una pieza (su publicación) frente a la media de su formato.', { id: z.number().int() }, ({ id }) => resultados.deLaPieza(id));
    tool('informe_semanal', 'Escribe el informe de una semana en 07-Diario (números, ritmo, lo mejor y lo peor, qué funciona y la semana que viene) y devuelve sus datos. Por defecto, la semana pasada.',
      { fecha: z.string().optional().describe('Un día de esa semana, AAAA-MM-DD') },
      ({ fecha }) => resultados.informeSemanal(fecha ? { fecha } : {}), true);
  }

  if (publicar) {
    const redes = REDES.map((r) => r.id);
    tool('guardar_versiones', 'Guarda las versiones de una pieza para otras redes (aparecen en la ficha de la pieza, en Contenido, y en 06-Publicaciones). Salen el mismo día que la pieza salvo que les pongas fecha propia. Si ya había una versión sin publicar de esa red, la reemplaza. No publica nada.',
      {
        piezaId: z.number().int(),
        versiones: z.array(z.object({
          red: z.enum(redes),
          formato: z.string().optional(),
          titulo: z.string().optional(),
          texto: z.string().describe('Lo que se publica: guion, slides, post o hilo'),
          extra: z.string().optional().describe('Hashtags, CTA o enlace'),
          notas: z.string().optional().describe('Indicaciones de grabación, diseño o edición'),
          fecha: z.string().optional().describe('AAAA-MM-DD solo si sale otro día que la pieza'),
          hora: z.string().optional().describe('HH:MM'),
        })).min(1),
      },
      ({ piezaId, versiones }) => publicar.guardarVersiones({ piezaId, versiones, origen }), true);
    tool('versiones_de_pieza', 'Lista las versiones por red de una pieza.', { piezaId: z.number().int() }, ({ piezaId }) => publicar.listarPieza(piezaId));
    tool('calendario_publicaciones', 'Todo lo que se publica entre dos fechas: las piezas del calendario de Contenido (piezas) y sus versiones para otras redes (versiones; dia = el día en que salen). sinFecha = versiones de piezas sin día.',
      { desde: z.string().describe('AAAA-MM-DD'), hasta: z.string().describe('AAAA-MM-DD') },
      ({ desde, hasta }) => publicar.calendario({ desde, hasta }));
    tool('programar_version', 'Pone a una versión un día (y hora) distinto del de su pieza. Para cambiar el día de todo, cambia la fecha de la pieza con mover_pieza. Solo la agenda: la persona publica.',
      { id: z.number().int(), fecha: z.string().describe('AAAA-MM-DD'), hora: z.string().optional().describe('HH:MM') },
      ({ id, fecha, hora }) => publicar.programar(id, { fecha, hora }), true);
  }

  // Diseño: el motor que dibuja vive en el dashboard; estas herramientas le pasan el trabajo
  if (diseno) {
    const { kit, servidor } = diseno;
    tool('ver_kit_diseno', 'Sistema de diseño de la persona: plantillas (carrusel/story), guía de marca, ejemplos y las reglas técnicas para escribir un diseño. Léelo siempre antes de diseñar.', {},
      () => {
        const k = kit.leer();
        return {
          nombre: k.nombre, propio: k.propio, cuenta: k.handle, duracion_diapositiva: `${k.duracion} s`,
          guia: k.guia, css: k.css,
          plantillas: k.plantillas.map(({ id, nombre, descripcion, formatos, ejemplo }) => ({ id, nombre, descripcion, formatos, ejemplo })),
          como_leer: 'Lee la guía y el ejemplo de la plantilla con leer_archivo_kit (el ejemplo es un diseño completo hecho a mano: imítalo).',
          reglas: reglasDiseno(k),
        };
      });
    tool('leer_archivo_kit', 'Lee un archivo de texto del sistema de diseño (guía .md, ejemplos .json, .css, .html…).',
      { archivo: z.string().describe('Ruta dentro del kit, p. ej. "CLAUDE.md" o "ejemplos/plantilla-1.json"') },
      ({ archivo }) => {
        const k = kit.leer();
        const abs = kit.archivo(k, archivo);
        if (!abs) throw new Error(`No existe ${archivo} en el kit`);
        if (!/\.(md|json|css|html?|txt|py|js)$/i.test(abs)) throw new Error('Solo se pueden leer archivos de texto; las imágenes, con Read');
        if (statSync(abs).size > 600_000) throw new Error('Archivo demasiado grande');
        return { archivo, contenido: readFileSync(abs, 'utf8') };
      });
    tool('listar_medios', 'Fotos y vídeos de la biblioteca de Contenido, para usarlos en un diseño (pon su url tal cual en <img src> o <video src>).',
      { tipo: z.enum(['foto', 'video']).optional(), buscar: z.string().optional().describe('Texto en el nombre del archivo o el título de la pieza') },
      ({ tipo, buscar }) => {
        const vistos = new Set();
        const b = (buscar || '').toLowerCase();
        return jarvis.listarPiezas().flatMap((p) => p.archivos.map((a) => ({ ...a, pieza: p.titulo, pieza_id: p.id })))
          .filter((a) => a.url && !vistos.has(a.url) && vistos.add(a.url))
          .filter((a) => !tipo || (tipo === 'video' ? a.mime.startsWith('video/') : a.mime.startsWith('image/')))
          .filter((a) => !b || `${a.nombre} ${a.pieza}`.toLowerCase().includes(b))
          .slice(0, 80).map(({ url, nombre, mime, pieza, pieza_id }) => ({ url, nombre, tipo: mime.startsWith('video/') ? 'video' : 'foto', pieza, pieza_id }));
      });
    tool('ver_pieza', 'VER una pieza de la biblioteca (Contenido): sus fotos y, de cada vídeo, cómo queda la diapositiva al final de la animación (y, si los pides, fotogramas para ver cómo se anima). Úsalo para mirar un carrusel o reel ya hecho (también los hechos de vídeos), p. ej. para replicar su diseño. Devuelve rutas de imágenes: léelas con Read.',
      {
        pieza_id: z.number().int().describe('El id de la pieza (búscalo con listar_pipeline o listar_medios)'),
        diapositiva: z.number().int().min(1).optional().describe('Solo esa diapositiva (desde 1). Sin ella, todas'),
        fotogramas: z.number().int().min(0).max(12).optional().describe('Fotogramas repartidos por cada vídeo, además del final (por defecto 0 si ves todas, 6 si ves una)'),
        transcribir: z.boolean().optional().describe('Transcribir lo que se dice en los vídeos (para reels con voz)'),
      },
      ({ pieza_id, ...resto }) => servidor('POST', `/api/piezas/${pieza_id}/ver`, resto));
    tool('listar_disenos', 'Diseños hechos o en curso (id, título, formato, plantilla, estado, avisos).', {},
      async () => (await servidor('GET', '/api/disenos')).disenos.map(({ id, titulo, formato, plantilla, estado, diapositivas, avisos, exportado }) => ({ id, titulo, formato, plantilla, estado, diapositivas, avisos: avisos.length, exportado: Boolean(exportado) })));
    tool('ver_diseno', 'Un diseño completo, con sus diapositivas (para cambiarlo y volver a guardarlo).', { id: z.number().int() },
      ({ id }) => servidor('GET', `/api/disenos/${id}?datos=1`));
    tool('crear_diseno', 'Crea un diseño vacío a partir de un guion (pegado, de una nota o de una pieza del pipeline). Después escríbelo y guárdalo con guardar_diseno.',
      {
        formato: z.enum(['carrusel', 'story']),
        plantilla: z.string().describe('id de la plantilla (ver_kit_diseno)'),
        titulo: z.string().optional(),
        guion: z.string().optional(), nota: z.string().optional().describe('Ruta de la nota del guion en el vault'),
        pieza_id: z.number().int().optional().describe('Pieza del pipeline de la que sale el guion'),
      },
      (a) => servidor('POST', '/api/disenos', { ...a, generar: false }), true);
    tool('guardar_diseno', 'Guarda las diapositivas de un diseño: JARVIS dibuja la vista previa y devuelve avisos de calidad (textos que se salen, que no caben o que se pisan) y las rutas de las vistas previas. Corrige los avisos y vuelve a guardar.',
      {
        id: z.number().int(),
        titulo: z.string().optional(),
        caption: z.string().optional().describe('Texto de la publicación'),
        slides: z.array(z.object({
          bg: z.string().optional(), glow: z.string().nullable().optional(), clase: z.string().optional(),
          html: z.string().optional(), js: z.string().optional(),
          blocks: z.array(z.object({ html: z.string(), js: z.string().optional() }).passthrough()).optional(),
        }).passthrough()).min(1).max(20),
      },
      ({ id, ...datos }) => servidor('PUT', `/api/disenos/${id}/datos`, datos), true);
  }

  // Laboratorio: testimonios, reels, clips, imágenes y lead magnets. Lo hace el Laboratorio del dashboard (Claude con el
  // plugin, Python y ffmpeg, en su propio carril); estas herramientas le pasan el trabajo para llevarlo todo desde un chat.
  if (laboratorio) {
    const { servidor, subir } = laboratorio;
    const corto = (t, n) => (t && t.length > n ? `${t.slice(0, n)}…` : t);
    tool('laboratorio_estado', 'Qué hay en el Laboratorio: si está listo (plugin, Python, marca), si está trabajando, las entrevistas y vídeos subidos (crudo/), lo que ha salido de cada testimonio y reel (con enBiblioteca si ya está en Contenido), los lead magnets y los encargos de imágenes.', {},
      async () => {
        const l = await servidor('GET', '/api/laboratorio');
        const lm = await servidor('GET', '/api/laboratorio/leadmagnets').catch(() => null);
        const img = await servidor('GET', '/api/laboratorio/imagenes').catch(() => null);
        const archivos = (lista) => lista.map((a) => ({ ruta: a.ruta, ...(a.enBiblioteca ? { enBiblioteca: true } : {}) }));
        return {
          listo: { plugin: Boolean(l.plugin?.instalado), python: Boolean(l.python), marca: Boolean(l.marca?.verificado) },
          trabajando: Boolean(l.trabajando),
          subidos: (l.entrevistas || []).map((a) => a.ruta),
          testimonios: (l.testimonios || []).map((t) => ({ cliente: t.cliente, captions: t.caption, portadas: archivos(t.portadas || []), grupos: t.grupos.map((g) => ({ id: g.id, nombre: g.nombre, archivos: archivos(g.archivos) })) })),
          reels: (l.reels || []).map((r) => ({ nombre: r.nombre, captions: r.caption, grupos: r.grupos.map((g) => ({ id: g.id, nombre: g.nombre, archivos: archivos(g.archivos) })) })),
          leadmagnets: (lm?.leadmagnets || []).map(({ slug, titulo, tipo, url, listo, pieza }) => ({ slug, titulo, tipo, url: url || null, listo: Boolean(listo), pieza: pieza || null })),
          imagenes: (img?.trabajos || []).slice(0, 10).map((t) => ({ nombre: t.nombre, titulo: t.titulo, archivos: (t.archivos || []).map((a) => a.ruta) })),
        };
      });
    tool('laboratorio_subir', 'Copia al Laboratorio un archivo de este ordenador: la entrevista o el vídeo a editar (tipo entrevista o video, va a crudo/), la foto del cliente (tipo foto, con su nombre en cliente) o una imagen de referencia (tipo referencia). Devuelve su ruta para laboratorio_encargar.',
      { ruta_local: z.string().describe('Ruta completa del archivo en este ordenador'), tipo: z.enum(['entrevista', 'video', 'foto', 'referencia']), cliente: z.string().optional().describe('Nombre del cliente (para su foto)') },
      ({ ruta_local, tipo, cliente }) => subir(ruta_local, { tipo, cliente }), true);
    tool('laboratorio_encargar', `Encarga un trabajo al Laboratorio (Opus con el plugin; tarda minutos). datos según el tipo:
- testimonio: { cliente, entrevista (ruta de laboratorio_subir), foto?, frase? (de la portada), queHicimos?, indicaciones?, piezas? (de ${Object.keys(PIEZAS_TESTIMONIO).join(', ')}; por defecto todo) }
- reel: { video (ruta), nombre?, modo? ("entero" o clips), clips? (1-10), duracion? (s por clip), plantillas? (${Object.keys(PLANTILLAS_REEL).join(', ')}), titulo?, indicaciones? }. Para sacar clips de un vídeo largo, modo clips con varios clips.
- leadmagnet: { titulo, tipo (${Object.keys(TIPOS_LM).join(', ')}), palabra? (la palabra clave del CTA), pieza? (id de la pieza que lo anuncia), contenido? (de qué va), indicaciones? }
- imagen: { descripcion, tipo? (${Object.keys(TIPOS_IMAGEN).join(', ')}), formato? (${Object.keys(FORMATOS_IMAGEN).join(', ')}), cantidad? }
Testimonios y reels se paran a enseñar el guion y los clips: léelo con laboratorio_chat, enséñaselo a la persona y pásale su respuesta con laboratorio_responder. Nunca des tú el visto bueno.`,
      { tipo: z.enum(['testimonio', 'reel', 'leadmagnet', 'imagen']), datos: z.object({}).passthrough() },
      ({ tipo, datos }) => servidor('POST', '/api/laboratorio/empezar', { tipo, datos }), true);
    tool('laboratorio_chat', 'Lo último de la conversación del Laboratorio (lo que pregunta o enseña mientras trabaja) y si sigue trabajando.',
      { turnos: z.number().int().min(1).max(10).optional() },
      async ({ turnos = 2 }) => {
        const e = await servidor('GET', '/api/jarvis/estado?conversacion=laboratorio');
        const t = new Map();
        for (const ev of e.eventos || []) {
          if (!ev.id) continue;
          if (!t.has(ev.id)) t.set(ev.id, { pedido: '', respuesta: '', estado: 'trabajando' });
          const x = t.get(ev.id);
          if (ev.tipo === 'pregunta') x.pedido = corto(ev.texto, 400);
          else if (ev.tipo === 'texto') x.respuesta += ev.texto;
          else if (ev.tipo === 'fin') { x.estado = 'terminado'; if (ev.texto) x.respuesta = ev.texto; }
          else if (ev.tipo === 'error') { x.estado = 'error'; x.respuesta += `\n[Error] ${ev.mensaje}`; }
        }
        return { trabajando: Boolean(e.ocupadoAqui), turnos: [...t.values()].slice(-turnos).map((x) => ({ ...x, respuesta: corto(x.respuesta.trim(), 6000) })) };
      });
    tool('laboratorio_responder', 'Manda al Laboratorio la respuesta de la persona (su visto bueno, cambios o lo que le pregunte). Solo lo que la persona diga.',
      { texto: z.string() },
      ({ texto }) => servidor('POST', '/api/jarvis/preguntar', { conversacion: 'laboratorio', texto }), true);
    tool('laboratorio_a_biblioteca', 'Pasa a la biblioteca de Contenido lo que ha salido del Laboratorio: una pieza en Listo con su caption (de _caption.md si no das otro), en la carpeta del trabajo y sin duplicar (si ya estaba, la devuelve). Un carrusel en vídeo va junto (varias rutas); stories y clips, de uno en uno.',
      {
        rutas: z.array(z.string()).min(1).max(20), titulo: z.string().optional(),
        formato: z.string().optional().describe('Reel, Carrusel, Story, Post, B-roll…'), caption: z.string().optional(),
        padre_id: z.number().int().optional().describe('La pieza madre (p. ej. el vídeo largo del que salen los clips)'),
        pilar: z.string().optional(), objetivo: z.enum(OBJETIVOS).optional(),
      },
      (a) => servidor('POST', '/api/laboratorio/biblioteca', a), true);
    tool('asignar_leadmagnet', 'Une un lead magnet a la pieza que lo anuncia (si ya está publicado, pone su enlace en la pieza). Publicarlo en Vercel lo hace la persona en Laboratorio → Lead magnets.',
      { slug: z.string(), pieza: z.number().int().nullable() },
      ({ slug, pieza }) => servidor('PUT', `/api/laboratorio/leadmagnets/${encodeURIComponent(slug)}/pieza`, { pieza }), true);
    tool('exportar_diseno', 'Exporta un diseño terminado a la biblioteca de Contenido (JPG, o vídeo MP4 con su animación): un carrusel queda en su pieza (la del guion si sale de una) y las stories, una pieza por story enlazadas a ella. Si ya se exportó en ese formato, solo se vuelven a sacar las diapositivas que han cambiado (o las de «solo») y se sustituyen en la biblioteca.',
      { id: z.number().int(), tipo: z.enum(['jpg', 'mp4']).optional(), solo: z.array(z.number().int().min(1)).optional().describe('Volver a exportar solo estas diapositivas (desde 1)') },
      ({ id, tipo = 'jpg', solo }) => servidor('POST', `/api/disenos/${id}/exportar`, solo ? { tipo, solo } : { tipo }), true);
  }

  return server;
}

async function main() {
  const cfg = getConfig();
  ensureVault(cfg.vaultPath, cfg.templateDir, cfg.mcpScript);
  const db = openDb(cfg.dbPath);
  const vault = createVault(cfg.vaultPath);
  const jarvis = createJarvis({ db, vault });
  const instagram = createInstagram({ db, vault });
  const competencia = createCompetencia({ db, instagram, vault });
  const ads = createAds({ db, instagram });
  const publicar = createPublicar({ db, jarvis, vault });
  const origen = process.env.JARVIS_ORIGEN || 'claude';
  // Avisa al dashboard (si está abierto) para que se refresque al instante
  const avisar = () => fetch(`http://127.0.0.1:${cfg.port}/api/avisar`, { method: 'POST', signal: AbortSignal.timeout(800) }).catch(() => {});
  // El motor de diseño corre en el dashboard: estas llamadas le pasan el trabajo
  const servidor = async (metodo, ruta, body) => {
    let res;
    try {
      res = await fetch(`http://127.0.0.1:${cfg.port}${ruta}`, { method: metodo, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10 * 60_000) });
    } catch {
      throw new Error('JARVIS no está abierto: el motor de diseño vive en el dashboard');
    }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || `Error ${res.status}`);
    return j;
  };
  const diseno = { kit: createKit({ vaultPath: cfg.vaultPath }), servidor };
  const recordatorios = createRecordatorios({ db });
  const resultados = createResultados({ db, jarvis, vault });
  // Sube un archivo de este ordenador al Laboratorio del dashboard (en trozos, sin cargarlo en memoria)
  const subir = async (ruta, { tipo, cliente }) => {
    if (!existsSync(ruta) || !statSync(ruta).isFile()) throw new Error(`No encuentro el archivo ${ruta}`);
    const q = new URLSearchParams({ tipo, nombre: path.basename(ruta), cliente: cliente || '' });
    let res;
    try {
      res = await fetch(`http://127.0.0.1:${cfg.port}/api/laboratorio/subir?${q}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: Readable.toWeb(createReadStream(ruta)), duplex: 'half', signal: AbortSignal.timeout(60 * 60_000) });
    } catch { throw new Error('JARVIS no está abierto: el Laboratorio vive en el dashboard'); }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || `Error ${res.status}`);
    return j;
  };
  await buildServer(jarvis, { origen, avisar, instagram, competencia, ads, publicar, diseno, recordatorios, resultados, laboratorio: { servidor, subir }, preferencias: createPreferencias({ db }) }).connect(new StdioServerTransport());
}

const esPrincipal = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (esPrincipal) main().catch((e) => { console.error(e); process.exit(1); });
