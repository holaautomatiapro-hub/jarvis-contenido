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
import { openDb, ESTADOS, CATEGORIAS } from '../server/db.js';
import { createVault, ensureVault, CARPETAS } from '../server/vault.js';
import { createJarvis } from '../server/jarvis.js';
import { createInstagram } from '../server/integrations/instagram.js';
import { createCompetencia } from '../server/integrations/competencia.js';
import { createAds } from '../server/integrations/ads.js';
import { createPublicar, REDES } from '../server/publicar.js';

dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

export function buildServer(jarvis, { origen = 'claude', avisar = () => {}, instagram = null, competencia = null, ads = null, publicar = null } = {}) {
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

  tool('capturar_idea', 'Guarda una idea de contenido: crea una nota en 01-Ideas y una tarjeta en la columna Idea del pipeline.',
    { texto: z.string().describe('La idea, tal cual la dijo la persona'), formato: z.string().optional().describe('reel, carrusel, historia, post, short…') },
    ({ texto, formato }) => jarvis.capturarIdea({ texto, formato, origen }), true);

  tool('crear_nota', 'Crea una nota Markdown en el vault de Obsidian.',
    { titulo: z.string(), contenido: z.string().optional(), carpeta: z.enum(CARPETAS).optional().describe('Por defecto 00-Inbox') },
    ({ titulo, contenido, carpeta }) => jarvis.crearNota({ titulo, contenido, carpeta, origen }), true);

  tool('buscar_notas', 'Busca texto en todas las notas del vault (título y contenido, sin distinguir tildes).',
    { consulta: z.string() },
    ({ consulta }) => jarvis.vault.search(consulta, 20));

  tool('leer_nota', 'Lee una nota del vault por su ruta (por ejemplo "01-Ideas/Mi idea.md").',
    { ruta: z.string() },
    ({ ruta }) => jarvis.vault.read(ruta));

  tool('listar_notas', 'Lista las notas más recientes, opcionalmente de una carpeta.',
    { carpeta: z.enum(CARPETAS).optional(), limite: z.number().int().min(1).max(200).optional() },
    ({ carpeta, limite = 50 }) => jarvis.vault.list().filter((n) => !carpeta || n.carpeta === carpeta).slice(0, limite));

  tool('crear_pieza', 'Crea una pieza de contenido en el pipeline.',
    {
      titulo: z.string(),
      estado: z.enum(ESTADOS).optional(),
      formato: z.string().optional(),
      plataformas: z.array(z.string()).optional(),
      fecha: z.string().optional().describe('Fecha prevista de publicación, AAAA-MM-DD'),
      nota: z.string().optional().describe('Ruta de la nota asociada en el vault'),
    },
    (a) => jarvis.crearPieza({ ...a, origen }), true);

  tool('mover_pieza', 'Mueve una pieza a otra columna del pipeline o cambia sus datos.',
    {
      id: z.number().int(),
      estado: z.enum(ESTADOS).optional(),
      titulo: z.string().optional(),
      formato: z.string().optional(),
      plataformas: z.array(z.string()).optional(),
      fecha: z.string().optional(),
      nota: z.string().optional(),
    },
    ({ id, ...cambios }) => jarvis.actualizarPieza(id, cambios, origen), true);

  tool('listar_pipeline', 'Lista las piezas del pipeline de contenido, opcionalmente filtradas por estado.',
    { estado: z.enum(ESTADOS).optional() },
    ({ estado }) => jarvis.listarPiezas({ estado }));

  tool('anadir_tarea', 'Añade una tarea al plan del día (o de otra fecha).',
    { titulo: z.string(), fecha: z.string().optional().describe('AAAA-MM-DD, por defecto hoy'), categoria: z.enum(CATEGORIAS).optional() },
    (a) => jarvis.crearTarea({ ...a, origen }), true);

  tool('completar_tarea', 'Marca una tarea como hecha (o pendiente con hecha=false).',
    { id: z.number().int(), hecha: z.boolean().optional() },
    ({ id, hecha = true }) => jarvis.marcarTarea(id, hecha, origen), true);

  tool('tareas_de_hoy', 'Devuelve las tareas de hoy y las atrasadas.', {}, () => jarvis.tareas());

  tool('resumen_del_dia', 'Resumen del día: tareas, estado del pipeline, piezas previstas para hoy e ideas recientes.', {}, () => jarvis.resumenDelDia());

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

  if (publicar) {
    const redes = REDES.map((r) => r.id);
    tool('guardar_versiones', 'Guarda las versiones de una pieza para cada red (aparecen en la pestaña Publicar y en 06-Publicaciones). Si ya había una versión sin publicar de esa red, la reemplaza. No publica nada.',
      {
        piezaId: z.number().int(),
        versiones: z.array(z.object({
          red: z.enum(redes),
          formato: z.string().optional(),
          titulo: z.string().optional(),
          texto: z.string().describe('Lo que se publica: guion, slides, post o hilo'),
          extra: z.string().optional().describe('Hashtags, CTA o enlace'),
          notas: z.string().optional().describe('Indicaciones de grabación, diseño o edición'),
          fecha: z.string().optional().describe('AAAA-MM-DD si hay fecha prevista'),
          hora: z.string().optional().describe('HH:MM'),
        })).min(1),
      },
      ({ piezaId, versiones }) => publicar.guardarVersiones({ piezaId, versiones, origen }), true);
    tool('versiones_de_pieza', 'Lista las versiones por red de una pieza.', { piezaId: z.number().int() }, ({ piezaId }) => publicar.listarPieza(piezaId));
    tool('calendario_publicaciones', 'Versiones programadas entre dos fechas y las que están sin fecha.',
      { desde: z.string().describe('AAAA-MM-DD'), hasta: z.string().describe('AAAA-MM-DD') },
      ({ desde, hasta }) => publicar.calendario({ desde, hasta }));
    tool('programar_version', 'Pone fecha (y hora) de publicación a una versión. Solo la agenda: la persona publica.',
      { id: z.number().int(), fecha: z.string().describe('AAAA-MM-DD'), hora: z.string().optional().describe('HH:MM') },
      ({ id, fecha, hora }) => publicar.programar(id, { fecha, hora }), true);
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
  await buildServer(jarvis, { origen, avisar, instagram, competencia, ads, publicar }).connect(new StdioServerTransport());
}

const esPrincipal = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (esPrincipal) main().catch((e) => { console.error(e); process.exit(1); });
