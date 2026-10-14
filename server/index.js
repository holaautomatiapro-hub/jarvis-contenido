import path from 'node:path';
import dotenv from 'dotenv';
import express from 'express';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { ROOT, getConfig, hostsPermitidos } from './config.js';
import { openDb } from './db.js';
import { createVault, ensureVault, VaultError } from './vault.js';
import { createJarvis, JarvisError, TareaError } from './jarvis.js';
import { createArchivos, ArchivoError } from './archivos.js';
import { createAlmacen } from './integrations/almacen.js';
import { createPublicadorIg, PublicarError } from './integrations/publicar-ig.js';
import { createResultados } from './resultados.js';
import { systemStatus } from './status.js';
import { createAsistente, OcupadoError } from './asistente.js';
import { sintetizar, vozConfigurada } from './tts.js';
import { createSkills } from './skills.js';
import { randomBytes } from 'node:crypto';
import { ajustes } from './db.js';
import { createInstagram } from './integrations/instagram.js';
import { MetaError } from './integrations/meta.js';
import { createJobs } from './integrations/jobs.js';
import { createCompetencia, PROMPT_ANALISIS } from './integrations/competencia.js';
import { createAds } from './integrations/ads.js';
import { createPublicar, REDES, REDES_POR_DEFECTO } from './publicar.js';
import { createHermes, TAREAS_PROGRAMADAS } from './integrations/hermes.js';
import { createKit } from './diseno/kit.js';
import { createMotor } from './diseno/motor.js';
import { createDisenos } from './diseno/disenos.js';
import { createRecordatorios } from './recordatorios.js';
import { promptReplicarCompetencia, promptReplicarPropia, normalizarFormatos, seDisena } from './replicar.js';
import { createLaboratorio, carpetaPorDefecto } from './laboratorio.js';
import { promptCaption, limpiarCaption, createContextoCaption } from './caption.js';
import { createRecortador } from './recortar.js';
import { createAdjuntos, textoAdjuntos } from './adjuntos.js';
import { createPreferencias, AMBITOS } from './preferencias.js';
import { createActualizar } from './actualizar.js';
import { createConversiones } from './convertir.js';
import { ENV_PATH, vigilarEnv } from './env-archivo.js';

dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

const DIST = path.join(ROOT, 'web', 'dist');

// Replicar con diseño de carruseles o stories: lo hace Opus, como en Diseño
const modeloReplicar = (formatos, disenar) => { try { return seDisena(normalizarFormatos(formatos), disenar) ? 'opus' : undefined; } catch { return undefined; } };

export function createApp({ jarvis, archivos, publicadorIg, asistente, instagram, competencia, ads, publicar, hermes, jobs, kit, disenos, recordatorios, laboratorio, resultados, adjuntos, preferencias, actualizar, conversiones, port, onChange = () => {}, status, tts = sintetizar }) {
  const estadoSistema = status || (() => systemStatus({ vaultPath: jarvis.vault.base, instagram: Boolean(instagram?.estado().conectado), ads: Boolean(ads?.estado().conectado && ads?.estado().cuenta), hermes: Boolean(hermes?.estado().gateway.online) }));
  const app = express();

  // Solo se acepta tráfico de este mismo PC (protege contra webs maliciosas que apunten a localhost)
  const hostsOk = hostsPermitidos(port);
  app.use((req, res, next) => (hostsOk.has(String(req.headers.host || '').toLowerCase()) ? next() : res.status(403).send('Host no permitido')));
  // Y ninguna otra web abierta en el navegador puede pedirle cambios (CSRF): el navegador siempre manda
  // Origin en un POST/PATCH/DELETE entre sitios. El MCP y los scripts locales no lo mandan.
  app.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const origen = req.headers.origin;
    if (origen && !hostsOk.has(origen.replace(/^https?:\/\//, ''))) return res.status(403).json({ error: 'Origen no permitido' });
    if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Origen no permitido' });
    next();
  });
  app.use(express.json({ limit: '2mb' }));

  // Envuelve cada endpoint: errores de validación → 400 con mensaje claro
  const h = (fn, cambia = false) => async (req, res) => {
    try {
      const out = await fn(req);
      if (cambia) onChange();
      res.json(out);
    } catch (e) {
      if (e instanceof OcupadoError) return res.status(409).json({ error: e.message });
      if (e instanceof JarvisError || e instanceof TareaError || e instanceof ArchivoError || e instanceof PublicarError || e instanceof VaultError || /^Falta /.test(e.message)) return res.status(400).json({ error: e.message });
      if (e instanceof MetaError) return res.status(502).json({ error: e.message });
      if (e.publico) return res.status(400).json({ error: e.message, ...(e.campo ? { campo: e.campo } : {}) });
      console.error(e);
      res.status(500).json({ error: 'Error interno' });
    }
  };

  app.get('/api/health', (_req, res) => res.json({ ok: true, name: 'JARVIS', version: '0.2.0' }));

  app.get('/api/inicio', h(async () => {
    const sistema = await estadoSistema();
    return { ...jarvis.inicio(), ...jarvis.agenda(), semana: jarvis.miSemana(), recordatorios: recordatorios ? recordatorios.deHoy() : [], conRecordatorios: Boolean(recordatorios), conAds: Boolean(ads), sistema };
  }));

  // Métricas de Meta Ads de los últimos 7 días para Inicio (aparte: tardan lo que tarde Meta)
  // Si Meta da error, Inicio no vuelve a preguntar en 5 min (se refresca cada 30 s); «Actualizar» sí pregunta
  let fallo = null;
  if (ads) {
    app.get('/api/inicio/ads', h(async () => {
      const est = ads.estado();
      if (!est.conectado || !est.cuenta) return { conectado: est.conectado, cuenta: est.cuenta, datos: null };
      if (fallo?.cuenta === est.cuenta && Date.now() - fallo.ts < 5 * 60000) return { conectado: true, cuenta: est.cuenta, datos: null, error: fallo.error };
      try {
        const datos = await ads.rendimiento({ dias: 7 });
        fallo = null;
        return { conectado: true, cuenta: est.cuenta, datos };
      } catch (e) {
        fallo = { cuenta: est.cuenta, ts: Date.now(), error: e.message };
        return { conectado: true, cuenta: est.cuenta, datos: null, error: e.message };
      }
    }));
  }

  // Recordatorios diarios (Inicio)
  if (recordatorios) {
    app.get('/api/recordatorios', h(() => ({ todos: recordatorios.listar(), hoy: recordatorios.deHoy() })));
    app.post('/api/recordatorios', h((req) => recordatorios.crear({ ...(req.body || {}), origen: 'dashboard' }), true));
    app.patch('/api/recordatorios/:id', h((req) => recordatorios.actualizar(req.params.id, req.body || {}), true));
    app.delete('/api/recordatorios/:id', h((req) => recordatorios.borrar(req.params.id), true));
    app.post('/api/recordatorios/:id/hecho', h((req) => recordatorios.marcar(req.params.id, { hecho: req.body?.hecho !== false, fecha: req.body?.fecha || undefined }), true));
  }

  // Instagram: conexión, sincronización y dashboards
  if (instagram) {
    const estados = new Map(); // state del OAuth → caducidad
    // En el PC, localhost; en un VPS (Tailscale), su dirección https: hay que añadirla también en la app de Meta
    const redirectUri = (req) => {
      const host = String(req.headers.host || '');
      if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) return `http://${host.startsWith('127.') ? `127.0.0.1:${port}` : `localhost:${port}`}/api/instagram/callback`;
      return `https://${host}/api/instagram/callback`;
    };
    const conMensaje = (fn) => async (req) => { try { return await fn(req); } catch (e) { if (!(e instanceof MetaError)) e.publico = true; throw e; } };

    app.get('/api/instagram/estado', h(() => instagram.estado()));
    // Replicar una publicación tuya que funcionó en otros formatos (Claude escribe las versiones y crea las piezas)
    app.post('/api/instagram/publicaciones/:id/replicar', h((req) => {
      if (!asistente) throw Object.assign(new Error('JARVIS (Claude Code) no está disponible'), { publico: true });
      const m = instagram.publicacion(req.params.id);
      const { formatos, indicaciones, disenar } = req.body || {};
      const texto = promptReplicarPropia(m, { formatos, indicaciones, disenar, medias: instagram.resumen({ dias: 90 }).medias });
      const r = asistente.preguntar({ conversacion: 'replicar', texto, modelo: modeloReplicar(formatos, disenar) });
      return { ok: true, peticion: r.id };
    }));
    app.get('/api/instagram/resumen', h((req) => instagram.resumen({ dias: Math.min(90, Math.max(7, Number(req.query.dias) || 30)) })));
    app.post('/api/instagram/token', h(conMensaje(async (req) => {
      const r = await instagram.conectarConToken(req.body?.token, { paginaId: req.body?.paginaId });
      jobs?.sincronizarAhora(); // como al volver del botón de Facebook: empieza a sincronizar ya
      return r;
    }), true));
    app.post('/api/instagram/desconectar', h(() => instagram.desconectar(), true));
    app.post('/api/instagram/sincronizar', h(conMensaje(() => {
      if (!instagram.estado().conectado) throw new Error('Instagram no está conectado');
      jobs?.sincronizarAhora(); // en segundo plano; el progreso llega por WebSocket
      return { ok: true };
    })));
    app.get('/api/instagram/conectar', (req, res) => {
      try {
        const state = randomBytes(16).toString('hex');
        estados.set(state, Date.now() + 10 * 60000);
        res.redirect(instagram.urlConexion(redirectUri(req), state));
      } catch (e) { res.redirect(`/#instagram?error=${encodeURIComponent(e.message)}`); }
    });
    app.get('/api/instagram/callback', async (req, res) => {
      const { code, state, error_description: errorMeta } = req.query;
      const valido = state && estados.get(state) > Date.now();
      estados.delete(state);
      if (errorMeta || !code || !valido) return res.redirect(`/#instagram?error=${encodeURIComponent(errorMeta || 'La conexión no se completó. Inténtalo de nuevo.')}`);
      try {
        await instagram.canjearCodigo(String(code), redirectUri(req));
        jobs?.sincronizarAhora();
        res.redirect('/#instagram?conectado=1');
      } catch (e) { res.redirect(`/#instagram?error=${encodeURIComponent(e.message)}`); }
    });
  }

  // Competencia
  if (competencia) {
    const enFondo = (p) => p.catch((e) => console.warn(`  Competencia: ${e.message}`));
    app.get('/api/competencia', h(() => ({ ...competencia.resumen(), analizando: Boolean(asistente?.estado({ conversacion: 'sistema' }).ocupadoAqui) })));
    app.post('/api/competencia/perfiles', h((req) => {
      const p = competencia.anadir(req.body?.usuario);
      if (instagram?.estado().conectadoMeta) enFondo(competencia.sincronizar({ soloUsuario: p.username }));
      return p;
    }));
    app.delete('/api/competencia/perfiles/:usuario', h((req) => competencia.quitar(req.params.usuario)));
    app.patch('/api/competencia/perfiles/:usuario', h((req) => competencia.activar(req.params.usuario, Boolean(req.body?.activo))));
    app.post('/api/competencia/sincronizar', h(() => {
      if (!instagram?.estado().conectadoMeta) { const e = new Error('Para espiar a la competencia hace falta conectar Instagram con Facebook (pestaña Instagram): Windsor no da datos de otros perfiles'); e.publico = true; throw e; }
      enFondo(competencia.sincronizar());
      return { ok: true };
    }));
    app.post('/api/competencia/analizar', h(() => {
      if (competencia.resumen().demo) { const e = new Error('Primero sincroniza a tus competidores: con datos de ejemplo no hay nada real que analizar'); e.publico = true; throw e; }
      return asistente.preguntar({ conversacion: 'sistema', modelo: process.env.JARVIS_MODELO_ANALISIS || 'sonnet', texto: PROMPT_ANALISIS });
    }));
    // Una publicación: detalle, slides (imágenes del carrusel), transcripción del reel y replicarla con tu estilo
    app.get('/api/competencia/publicaciones/:id', h((req) => competencia.detalle(req.params.id)));
    app.post('/api/competencia/publicaciones/:id/slides', h(async (req) => ({ slides: (await competencia.descargarSlides(req.params.id)).map((f) => path.basename(f)) })));
    app.get('/api/competencia/publicaciones/:id/slides/:fichero', (req, res) => {
      const f = competencia.rutaSlide(req.params.id, req.params.fichero);
      if (!f) return res.status(404).end();
      res.set('Cache-Control', 'private, max-age=86400').sendFile(f);
    });
    app.post('/api/competencia/publicaciones/:id/transcribir', h((req) => competencia.transcribir(req.params.id), true));
    // Cuando Instagram no da el vídeo del reel: la persona lo descarga y lo sube para transcribirlo
    app.post('/api/competencia/publicaciones/:id/video', express.raw({ type: () => true, limit: '500mb' }), h((req) => competencia.transcribir(req.params.id, { video: req.body }), true));
    // Laboratorio → Replicar: una publicación de cualquier cuenta profesional, desde su enlace
    app.post('/api/competencia/enlace', h((req) => competencia.porEnlace({ url: req.body?.url, usuario: req.body?.usuario }), true));
    app.get('/api/competencia/enlaces', h(() => competencia.traidas()));
    app.post('/api/competencia/publicaciones/:id/replicar', h(async (req) => {
      if (!asistente) throw Object.assign(new Error('JARVIS (Claude Code) no está disponible'), { publico: true });
      if (asistente.estado().ocupado) throw new OcupadoError('JARVIS está terminando otra petición. Espera un momento.');
      const { formatos, indicaciones, disenar } = req.body || {};
      normalizarFormatos(formatos); // antes de transcribir: si no hay formato, se avisa ya
      const { m, slides } = await competencia.paraReplicar(req.params.id);
      const texto = promptReplicarCompetencia(m, { formatos, indicaciones, disenar, slides, seguidores: m.seguidores });
      const r = asistente.preguntar({ conversacion: 'replicar', texto, modelo: modeloReplicar(formatos, disenar) });
      return { ok: true, peticion: r.id, transcrita: Boolean(m.transcripcion), slides: slides.length };
    }));
  }

  // Meta Ads
  if (ads) {
    const enFondo = (p) => p.catch((e) => console.warn(`  Meta Ads: ${e.message}`));
    app.get('/api/ads', h((req) => ads.resumen({ dias: Math.min(90, Math.max(7, Number(req.query.dias) || 30)) })));
    app.get('/api/ads/cuentas', h(() => ads.cuentas()));
    app.post('/api/ads/cuenta', h((req) => ads.elegirCuenta(req.body?.id), true));
    app.post('/api/ads/actualizar', h((req) => { fallo = null; return ads.rendimiento({ dias: Number(req.body?.dias) || 30, forzar: true }); }, true));
    app.post('/api/ads/biblioteca/sincronizar', h(() => { if (!ads.estado().conectado) { const e = new Error('Conecta primero Instagram con Facebook (pestaña Instagram)'); e.publico = true; throw e; } enFondo(ads.sincronizarBiblioteca()); return { ok: true }; }));
    app.post('/api/ads/competidores/:usuario/pagina', h((req) => ads.paginaCompetidor(req.params.usuario, req.body?.pagina), true));
    app.post('/api/ads/borradores', h((req) => ads.proponer(req.body || {}, 'dashboard'), true));
    // Única puerta para crear en Meta: un clic de la persona en el dashboard. Siempre en pausa.
    app.post('/api/ads/borradores/:id/confirmar', h((req) => ads.confirmar(req.params.id), true));
    app.post('/api/ads/borradores/:id/descartar', h((req) => ads.descartar(req.params.id), true));
  }

  // Publicar: versiones por red y calendario (JARVIS prepara, la persona publica)
  if (publicar) {
    app.get('/api/publicar/piezas/:id', h((req) => ({ ...publicar.listarPieza(req.params.id), redes: REDES, porDefecto: REDES_POR_DEFECTO, trabajando: Boolean(asistente?.estado({ conversacion: 'publicar' }).ocupadoAqui) })));
    app.post('/api/publicar/adaptar', h((req) => {
      const { pieza, redes, prompt } = publicar.prepararAdaptacion(req.body || {});
      const r = asistente.preguntar({ conversacion: 'publicar', modelo: req.body?.modelo || 'sonnet', texto: prompt });
      return { pieza, redes, peticion: r.id };
    }, true));
    app.post('/api/publicar/versiones', h((req) => publicar.guardarVersiones({ ...(req.body || {}), origen: 'dashboard' }), true));
    app.patch('/api/publicar/versiones/:id', h((req) => {
      if ('publicado' in (req.body || {})) return publicar.marcar(req.params.id, Boolean(req.body.publicado));
      return publicar.programar(req.params.id, req.body || {});
    }, true));
    app.delete('/api/publicar/versiones/:id', h((req) => publicar.borrar(req.params.id), true));
  }

  if (hermes) {
    // Estado de Hermes leído de sus archivos (sin secretos), plantillas de tareas y lo último que llegó por Telegram
    app.get('/api/hermes', h(() => ({
      ...hermes.estado(),
      plantillas: TAREAS_PROGRAMADAS.map(({ nombre, titulo, cuando, prompt }) => ({ nombre, titulo, cuando, prompt })),
      mensajes: jarvis.actividadDe('hermes', 8),
      vault: path.basename(jarvis.vault.base),
    })));
    app.post('/api/hermes/configurar', h(async (req) => {
      try { return await hermes.configurar({ simular: Boolean(req.body?.simular) }); }
      catch (e) { e.publico = true; throw e; }
    }, true));
  }

  // Vault de skills
  const skills = createSkills(jarvis.vault.base);
  app.get('/api/skills', h(() => skills.resumen(jarvis.vault)));
  app.get('/api/skills/:nombre', h((req) => skills.leer(req.params.nombre)));

  app.get('/api/config', (_req, res) => res.json({ vault: jarvis.vault.nombre, vaultPath: jarvis.vault.base }));

  // Tareas
  // Laboratorio: clips de testimonios y edición de reels con el plugin «testimonios»
  if (laboratorio) {
    app.get('/api/laboratorio', h(() => ({ ...laboratorio.estado(), ...laboratorio.resultados(), trabajando: Boolean(asistente?.estado({ conversacion: 'laboratorio' }).ocupadoAqui) })));
    app.get('/api/laboratorio/requisitos', h(() => laboratorio.requisitos()));
    app.post('/api/laboratorio/plugin', express.raw({ type: () => true, limit: '200mb' }), h((req) => laboratorio.importarPlugin(req.body), true));
    app.post('/api/laboratorio/subir', h((req) => laboratorio.subir(req, { tipo: String(req.query.tipo || ''), nombre: String(req.query.nombre || ''), cliente: String(req.query.cliente || '') }), true));
    app.get('/api/laboratorio/archivo', (req, res) => {
      let a;
      try { a = laboratorio.archivo(String(req.query.ruta || '')); } catch (e) { return res.status(404).json({ error: e.message }); }
      // Las páginas (lead magnets) se ven aisladas: sin acceso a JARVIS desde su JavaScript
      const aislada = /^text\/html/.test(a.mime) ? { 'Content-Security-Policy': 'sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals' } : {};
      res.type(a.mime).sendFile(a.abs, { dotfiles: 'allow', headers: { 'Cache-Control': 'private, no-cache', ...aislada } });
    });
    app.get('/api/laboratorio/texto', h((req) => laboratorio.texto(String(req.query.ruta || ''))));
    app.delete('/api/laboratorio/archivo', h((req) => laboratorio.borrar(String(req.query.ruta || '')), true));
    app.post('/api/laboratorio/biblioteca', h((req) => laboratorio.aBiblioteca(req.body || {}), true));
    app.post('/api/laboratorio/empezar', h((req) => {
      if (!asistente) throw Object.assign(new Error('JARVIS (Claude Code) no está disponible'), { publico: true });
      if (['imagen', 'cara', 'buscar-cara'].includes(req.body?.tipo)) {
        if (asistente.estado({ conversacion: 'laboratorio' }).ocupadoAqui) throw new OcupadoError('El Laboratorio está terminando otro trabajo. Espera a que acabe o cancélalo.');
        const { nombre = null, prompt } = req.body.tipo === 'cara' ? laboratorio.imagenes.entrenarCara(req.body?.datos || {}) : req.body.tipo === 'buscar-cara' ? laboratorio.imagenes.buscarCara() : laboratorio.imagenes.nuevo(req.body?.datos || {});
        return Promise.resolve(asistente.preguntar({ conversacion: 'laboratorio', texto: prompt })).then((r) => ({ ...(r && typeof r === 'object' ? r : {}), nombre }));
      }
      if (req.body?.tipo === 'leadmagnet') {
        if (asistente.estado({ conversacion: 'laboratorio' }).ocupadoAqui) throw new OcupadoError('El Laboratorio está terminando otro trabajo. Espera a que acabe o cancélalo.');
        const { slug, prompt } = laboratorio.leadmagnets.nuevo(req.body?.datos || {});
        return Promise.resolve(asistente.preguntar({ conversacion: 'laboratorio', texto: prompt })).then((r) => ({ ...(r && typeof r === 'object' ? r : {}), slug }));
      }
      return asistente.preguntar({ conversacion: 'laboratorio', texto: laboratorio.prompt(req.body?.tipo, req.body?.datos || {}) });
    }));
    // Imágenes y vídeo con Higgsfield (conector de la cuenta)
    app.get('/api/laboratorio/imagenes', h((req) => laboratorio.imagenes.estado({ fresco: req.query.fresco === '1' })));
    app.post('/api/laboratorio/imagenes/conector', h(() => laboratorio.imagenes.anadirConector(), true));
    app.delete('/api/laboratorio/imagenes/:nombre', h((req) => laboratorio.imagenes.borrar(req.params.nombre), true));
    // Lead magnets (páginas web) y su publicación en Vercel
    const lm = laboratorio.leadmagnets;
    app.get('/api/laboratorio/leadmagnets', h(() => lm.estado()));
    app.post('/api/laboratorio/leadmagnets/banner', h((req) => lm.subirBanner(req, { cual: String(req.query.cual || ''), nombre: String(req.query.nombre || '') }), true));
    app.put('/api/laboratorio/leadmagnets/vercel', h((req) => lm.conectarVercel(req.body || {}), true));
    app.put('/api/laboratorio/leadmagnets/github', h((req) => lm.conectarGithub(req.body || {}), true));
    app.post('/api/laboratorio/leadmagnets/:slug/publicar', h((req) => lm.publicar(req.params.slug), true));
    app.post('/api/laboratorio/leadmagnets/:slug/despublicar', h((req) => lm.despublicar(req.params.slug), true));
    app.put('/api/laboratorio/leadmagnets/:slug/pieza', h((req) => lm.asignar(req.params.slug, req.body?.pieza || null), true));
    app.delete('/api/laboratorio/leadmagnets/:slug', h((req) => lm.borrar(req.params.slug), true));
  }

  // Fases del pipeline de contenido (configurables)
  // Resultados: cada pieza con su publicación de Instagram, qué te funciona y el informe semanal
  if (resultados) {
    app.get('/api/piezas/:id/resultados', h((req) => resultados.deLaPieza(req.params.id)));
    app.get('/api/piezas/:id/instagram/candidatas', h((req) => resultados.candidatas(req.params.id)));
    app.put('/api/piezas/:id/instagram', h((req) => resultados.vincular(req.params.id, req.body?.media || null), true));
    app.get('/api/resultados', h((req) => {
      resultados.vincularTodo();
      return { ...resultados.queFunciona({ dias: Math.min(365, Math.max(30, Number(req.query.dias) || 90)) }), informe: resultados.ultimoInforme() };
    }));
    app.post('/api/resultados/informe', h((req) => { const r = resultados.informeSemanal(req.body?.fecha ? { fecha: String(req.body.fecha) } : {}); return { nota: r.nota, lunes: r.lunes }; }, true));
  }
  app.get('/api/ritmo', h(() => jarvis.ritmo()));
  app.put('/api/ritmo', h((req) => jarvis.guardarRitmo(req.body || {}), true));
  app.get('/api/pipeline', h(() => jarvis.pipeline.fases()));
  app.put('/api/pipeline', h((req) => jarvis.pipeline.guardar(req.body?.fases, { mover: req.body?.mover || {} }), true));
  app.get('/api/tareas', h((req) => jarvis.tareas({ fecha: req.query.fecha || undefined })));
  app.get('/api/tareas/lista', h((req) => {
    const { estado, prioridad, categoria, desde, hasta, sinFecha, atrasadas, texto } = req.query;
    return jarvis.listarTareas({ estado, prioridad, categoria, desde, hasta, sinFecha: sinFecha === '1', atrasadas: atrasadas === '1', texto });
  }));
  app.post('/api/tareas', h((req) => jarvis.crearTarea({ ...(req.body || {}), origen: 'dashboard' }), true));
  app.patch('/api/tareas/:id', h((req) => jarvis.actualizarTarea(req.params.id, req.body || {}), true));
  app.delete('/api/tareas/:id', h((req) => jarvis.borrarTarea(req.params.id), true));

  // Contenido: piezas (pipeline, calendario y biblioteca), carpetas y archivos
  // Un archivo solo se borra del disco cuando ya no lo usa ninguna pieza (p. ej. tras juntar un carrusel)
  const usados = () => new Set(jarvis.listarPiezas().flatMap((p) => [...p.archivos, ...(p.portada ? [p.portada] : [])].map((a) => a.path)));
  const borrarArchivosDe = (lista) => {
    if (!archivos) return;
    const enUso = usados();
    for (const a of lista.flatMap((p) => p.archivos)) if (a.path && !enUso.has(a.path)) archivos.borrar(a.path);
  };
  app.get('/api/piezas', h((req) => jarvis.listarPiezas({ estado: req.query.estado || undefined })));
  // «Publicar sola en Instagram» solo se puede marcar desde aquí (un clic de la persona), nunca desde el MCP
  const conInstagram = (p, body) => {
    if (!('publicar_ig' in (body || {}))) return p;
    if (!publicadorIg) { if (body.publicar_ig) throw new PublicarError('La publicación en Instagram no está disponible'); return p; }
    return publicadorIg.marcar(p.id, Boolean(body.publicar_ig));
  };
  app.post('/api/piezas', h((req) => conInstagram(jarvis.crearPieza({ ...(req.body || {}), origen: 'dashboard' }), req.body), true));
  app.patch('/api/piezas/:id', h((req) => conInstagram(jarvis.actualizarPieza(req.params.id, req.body || {}), req.body), true));
  app.post('/api/piezas/:id/duplicar', h((req) => jarvis.duplicarPieza(req.params.id), true));
  app.post('/api/piezas/:id/instagram/ahora', h((req) => {
    if (!publicadorIg) throw new PublicarError('La publicación en Instagram no está disponible');
    return publicadorIg.publicarAhora(req.params.id);
  }, true));
  app.delete('/api/piezas/:id', h((req) => { const r = jarvis.borrarPieza(req.params.id); borrarArchivosDe([r.pieza]); return { ok: true }; }, true));
  app.get('/api/contenido', h(() => ({ piezas: jarvis.listarPiezas(), carpetas: jarvis.carpetas(), pilares: jarvis.pilares(), versiones: publicar?.resumen() || [], metricas: resultados?.porPieza() || {}, archivos: Boolean(archivos), instagram: publicadorIg?.estado() || { disponible: false, motivo: 'La publicación en Instagram no está disponible' } })));
  // Caption con IA (al crear o programar un post): devuelve el texto, no guarda nada
  const contextoCaption = archivos ? createContextoCaption({ archivos, vaultPath: jarvis.vault.base, python: () => laboratorio?.python?.() || null }) : null;
  app.post('/api/caption', h(async (req) => {
    if (!asistente?.redactar) throw Object.assign(new Error('JARVIS (Claude Code) no está disponible'), { publico: true });
    const b = req.body || {};
    // Lo que hay dentro de la pieza (transcripción del reel, slides del carrusel) para que no sea genérico
    const contexto = contextoCaption ? await contextoCaption.preparar(b.archivos) : {};
    const caption = limpiarCaption(await asistente.redactar({ prompt: promptCaption(b, contexto) }));
    return { caption, leido: { transcripciones: contexto.transcripciones?.length || 0, imagenes: contexto.imagenes?.length || 0 }, avisos: contexto.avisos || [] };
  }));
  app.post('/api/contenido/carpetas', h((req) => jarvis.crearCarpeta(req.body?.nombre, req.body?.padre || null), true));
  app.patch('/api/contenido/carpetas', h((req) => jarvis.renombrarCarpeta(req.body?.de, req.body?.a), true));
  app.delete('/api/contenido/carpetas', h((req) => jarvis.borrarCarpeta(req.query.nombre), true));
  app.post('/api/contenido/mover', h((req) => jarvis.moverACarpeta(req.body?.ids, req.body?.carpeta || null), true));
  app.post('/api/contenido/juntar', h((req) => jarvis.juntarEnCarrusel(req.body?.ids), true));
  app.post('/api/contenido/borrar', h((req) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const borradas = ids.map((id) => jarvis.borrarPieza(id).pieza);
    borrarArchivosDe(borradas);
    return { ok: true, borradas: borradas.length };
  }, true));
  // Diseño: guion → carrusel o stories con el sistema de diseño del vault
  if (disenos) {
    app.get('/api/disenos', h(() => ({ kit: kit.estado(), disenos: disenos.listar() })));
    app.post('/api/disenos', h((req) => disenos.crear(req.body || {}), true));
    app.get('/api/disenos/:id', h((req) => disenos.obtener(req.params.id, { conDatos: req.query.datos === '1' })));
    // Lo usa guardar_diseno (MCP): guarda las diapositivas y devuelve la revisión de calidad
    app.put('/api/disenos/:id/datos', h((req) => disenos.guardarDatos(req.params.id, req.body || {}), true));
    app.post('/api/disenos/:id/generar', h((req) => disenos.generar(req.params.id, { indicaciones: req.body?.indicaciones }), true));
    app.post('/api/disenos/:id/exportar', h((req) => disenos.exportar(req.params.id, { tipo: req.body?.tipo, solo: req.body?.solo, todo: req.body?.todo === true }), true));
    app.delete('/api/disenos/:id', h((req) => disenos.borrar(req.params.id), true));
    app.get('/api/disenos/:id/previas/:fichero', (req, res) => {
      const ruta = disenos.rutaPrevia(req.params.id, req.params.fichero);
      if (!ruta) return res.status(404).json({ error: 'No existe' });
      res.sendFile(ruta, { headers: { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=31536000, immutable' } });
    });
    // Importar el sistema de diseño: el .zip llega tal cual en el cuerpo
    // Portadas desde una pieza: plantillas, generar (Claude) y exportar la imagen para ponerla en la pieza
    app.get('/api/portadas', h(() => ({ tipos: disenos.tiposPortada() })));
    app.get('/api/portadas/muestra/:tipo', (req, res) => {
      let abs = null;
      try { abs = disenos.muestraPortada(req.params.tipo); } catch { /* sin kit */ }
      if (!abs) return res.status(404).end();
      res.sendFile(abs, { dotfiles: 'allow', headers: { 'Cache-Control': 'private, max-age=3600' } });
    });
    app.post('/api/portadas/plantillas', express.raw({ type: () => true, limit: '25mb' }), h((req) => disenos.guardarPlantillaPortada({ id: String(req.query.id || ''), nombre: req.query.nombre, formato: req.query.formato, ext: String(req.query.nombre_archivo || '').split('.').pop(), datos: req.body }), true));
    app.delete('/api/portadas/plantillas/:id', h((req) => disenos.borrarPlantillaPortada(req.params.id), true));
    app.post('/api/portadas', h((req) => {
      const pid = Number(req.body?.pieza_id);
      const pieza = pid ? jarvis.listarPiezas().find((p) => p.id === pid) : req.body?.pieza || null;
      return disenos.crearPortada({ ...(req.body || {}), pieza });
    }, true));
    app.post('/api/portadas/:id/exportar', h((req) => disenos.exportarPortada(req.params.id), true));
    app.post('/api/disenos/kit', express.raw({ type: () => true, limit: '300mb' }), h((req) => kit.importar(req.body), true));
  }

  if (archivos) {
    // El navegador manda el archivo tal cual (sin JSON ni formularios) y se escribe al disco por trozos
    app.post('/api/contenido/archivos', h((req) => archivos.guardar(req, { nombre: String(req.query.nombre || ''), mime: String(req.query.mime || '') })));
    app.get('/api/contenido/archivos/:mes/:fichero', (req, res) => {
      let ruta;
      try { ruta = archivos.ruta(`${req.params.mes}/${req.params.fichero}`); } catch { return res.status(404).json({ error: 'No existe' }); }
      res.sendFile(ruta, { dotfiles: 'deny', headers: { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=31536000, immutable' } }, (e) => {
        if (e && !res.headersSent) res.status(404).json({ error: 'No existe' });
      });
    });
    // Para limpiar lo que se subió en el editor y al final no se guardó
    app.delete('/api/contenido/archivos/:mes/:fichero', h((req) => {
      const rel = `${req.params.mes}/${req.params.fichero}`;
      archivos.ruta(rel);
      if (usados().has(rel)) return { ok: true, enUso: true };
      archivos.borrar(rel);
      return { ok: true };
    }));
  }

  // «Generar vídeo» / «Generar imagen» de una pieza: se saca la otra versión y se ve antes de cambiarla
  if (conversiones) {
    app.get('/api/piezas/:id/convertir', h((req) => conversiones.estado(req.params.id)));
    app.post('/api/piezas/:id/convertir', h((req) => conversiones.empezar(req.params.id, { a: ['video', 'imagen'].includes(req.body?.a) ? req.body.a : undefined })));
    app.post('/api/piezas/:id/convertir/aceptar', h((req) => conversiones.aceptar(req.params.id, { elegidos: Array.isArray(req.body?.elegidos) ? req.body.elegidos.map(String) : undefined }), true));
    app.delete('/api/piezas/:id/convertir', h((req) => conversiones.descartar(req.params.id), true));
  }

  // «Trabajando en…»: todo lo que JARVIS está haciendo ahora, para verlo desde cualquier pestaña
  if (asistente) {
    const NOMBRE = { principal: 'Chat', replicar: 'Replicando una publicación', diseno: 'Diseño', laboratorio: 'Laboratorio', guiones: 'Guiones', ads: 'Meta Ads', publicar: 'Adaptando a otras redes', sistema: 'Tarea de fondo' };
    const IR = { principal: { tab: 'chat' }, replicar: { tab: 'contenido' }, diseno: { tab: 'laboratorio', seccion: 'diseno' }, laboratorio: { tab: 'laboratorio' }, guiones: { tab: 'skills' }, ads: { tab: 'ads' }, publicar: { tab: 'contenido' } };
    const resumir = (t) => String(t || '').replace(/^\[[^\]]*\]\s*/, '').split('\n').find((l) => l.trim())?.trim().slice(0, 240) || '';
    // Cada trabajo puede llevar «parar»: lo que hay que hacer para cortarlo (no sale en la respuesta)
    const trabajosAhora = () => {
      const lista = [];
      const disenosEnCurso = disenos?.trabajos() || [];
      for (const d of disenosEnCurso) {
        const portada = d.uso === 'portada';
        lista.push({
          id: `diseno-${d.id}`, tipo: portada ? 'portada' : 'diseno', titulo: portada ? `Portada: ${d.titulo}` : `Diseño: ${d.titulo}`,
          detalle: d.estado === 'exportando' ? 'Exportando a la biblioteca' : d.trabajo?.texto || (d.estado === 'renderizando' ? 'Dibujando la vista previa' : 'Diseñando'),
          trabajo: d.estado === 'exportando' ? null : d.trabajo, progreso: d.estado === 'exportando' ? d.progreso ?? 0 : null, desde: d.trabajo?.inicio || null,
          ir: portada ? (d.pieza_origen ? { tab: 'contenido', pieza: d.pieza_origen } : { tab: 'laboratorio', seccion: 'diseno' }) : { tab: 'laboratorio', seccion: 'diseno', diseno: d.id },
          parar: d.estado === 'exportando' ? () => disenos.pararExportacion(d.id) : d.trabajo?.conversacion ? () => asistente.cancelar({ conversacion: d.trabajo.conversacion }) : null,
        });
      }
      const conDiseno = new Set(disenosEnCurso.map((d) => d.trabajo?.conversacion).filter(Boolean));
      for (const c of asistente.enMarcha()) {
        if (c.conversacion === 'diseno' && conDiseno.has('diseno')) continue; // ya sale como su diseño
        lista.push({ id: `claude-${c.conversacion}-${c.id}`, tipo: 'claude', titulo: NOMBRE[c.conversacion] || 'JARVIS', detalle: resumir(c.texto), desde: c.desde, ir: IR[c.conversacion] || null, parar: () => asistente.cancelar({ conversacion: c.conversacion }) });
      }
      for (const c of conversiones?.trabajos() || []) {
        lista.push({ id: `convertir-${c.pieza}`, tipo: 'convertir', titulo: `${c.a === 'video' ? 'Vídeo' : 'Imagen'} de «${c.titulo}»`, detalle: c.deDiseno ? 'Exportando desde su diseño' : c.a === 'video' ? 'Pasando las fotos a vídeo' : 'Sacando un fotograma', progreso: c.progreso, desde: c.inicio, ir: { tab: 'contenido', pieza: c.pieza }, parar: () => conversiones.parar(c.pieza) });
      }
      const u = actualizar?.enCurso();
      if (u) lista.push({ id: 'actualizar', tipo: 'actualizar', titulo: 'Actualizando JARVIS', detalle: 'Se reiniciará en medio: es normal que la página se corte un momento', desde: Date.parse(u.inicio) || null, ir: { tab: 'apps' } });
      return lista;
    };
    app.get('/api/trabajos', h(() => ({ trabajos: trabajosAhora().map(({ parar, ...t }) => ({ ...t, parable: Boolean(parar) })) })));
    app.post('/api/trabajos/parar', h(async (req) => {
      const t = trabajosAhora().find((x) => x.id === String(req.body?.id || ''));
      if (!t) throw Object.assign(new Error('Ya ha terminado'), { publico: true });
      if (!t.parar) throw Object.assign(new Error('Esto no se puede parar a medias'), { publico: true });
      await t.parar();
      return { ok: true };
    }, true));
  }

  // Actualizar JARVIS desde el dashboard (Apps)
  if (actualizar) {
    app.get('/api/actualizar', h(() => actualizar.estado()));
    app.post('/api/actualizar/comprobar', h(() => actualizar.comprobar()));
    app.post('/api/actualizar', h((req) => actualizar.actualizar({ aunqueOcupado: req.body?.aunqueOcupado === true })));
  }

  // Lo que JARVIS ha aprendido de tus correcciones (se ve, se cambia y se quita en Diseño)
  if (preferencias) {
    app.get('/api/preferencias', h(() => ({ ambitos: AMBITOS, preferencias: preferencias.listar() })));
    app.post('/api/preferencias', h((req) => preferencias.guardar({ ...(req.body || {}), origen: 'dashboard' }), true));
    app.put('/api/preferencias/:id', h((req) => preferencias.cambiar(req.params.id, req.body || {}), true));
    app.delete('/api/preferencias/:id', h((req) => preferencias.quitar(req.params.id), true));
  }

  // Notas del vault
  app.get('/api/notas', h(() => jarvis.vault.list()));
  app.get('/api/notas/leer', h((req) => jarvis.vault.read(String(req.query.ruta || ''))));
  app.get('/api/notas/buscar', h((req) => jarvis.vault.search(String(req.query.q || ''))));
  app.post('/api/notas', h((req) => jarvis.crearNota(req.body || {}), true));
  app.put('/api/notas', h((req) => jarvis.editarNota(String(req.body?.ruta || ''), req.body || {}), true));
  app.delete('/api/notas', h((req) => jarvis.borrarNota(String(req.query.ruta || '')), true));
  app.post('/api/notas/restaurar', h((req) => jarvis.restaurarNota(req.body?.papelera, req.body?.ruta), true));
  app.post('/api/ideas', h((req) => jarvis.capturarIdea(req.body || {}), true));

  // JARVIS (Claude Code + JEV). La respuesta llega en directo por el WebSocket.
  if (asistente) {
    // Fotos y vídeos adjuntos al chat: se preparan al subirlos (fotogramas y transcripción) y el mensaje los lleva por su id
    const preparados = new Map();
    if (adjuntos && archivos) {
      // Para que JARVIS «vea» una pieza de la biblioteca (fotos y fotogramas de sus vídeos)
      app.post('/api/piezas/:id/ver', h(async (req) => {
        const pieza = jarvis.leerPieza(Number(req.params.id));
        if (!pieza) throw Object.assign(new Error('Esa pieza no existe'), { publico: true });
        const b = req.body || {};
        const entero = (v, max) => (v == null || v === '' ? null : Math.max(0, Math.min(max, Math.round(Number(v)) || 0)));
        return adjuntos.verPieza(pieza, { diapositiva: entero(b.diapositiva, 99) || null, fotogramas: entero(b.fotogramas, 12), transcribir: b.transcribir === true });
      }));
      // Transcribir los vídeos de una pieza; la transcripción queda además como nota en 03-Transcripciones
      app.post('/api/piezas/:id/transcribir', h(async (req) => {
        const pieza = jarvis.leerPieza(Number(req.params.id));
        if (!pieza) throw Object.assign(new Error('Esa pieza no existe'), { publico: true });
        const d = Number(req.body?.diapositiva) || null;
        const r = await adjuntos.transcribirPieza(pieza, { diapositiva: d });
        const conTexto = r.transcripciones.filter((t) => t.texto);
        if (conTexto.some((t) => t.nueva)) {
          const contenido = [`Pieza #${pieza.id} · ${pieza.titulo}${pieza.carpeta ? ` · carpeta ${pieza.carpeta}` : ''}`, ...conTexto.map((t) => `${conTexto.length > 1 ? `## ${t.n}. ${t.nombre}\n\n` : ''}${t.texto}`)].join('\n\n');
          r.nota = jarvis.crearNota({ carpeta: '03-Transcripciones', titulo: `Transcripción · ${String(pieza.titulo).slice(0, 100)}`, contenido, origen: 'dashboard', tipo: 'transcripcion' })?.nota || null;
        }
        for (const t of r.transcripciones) delete t.nueva;
        if (!conTexto.length) throw Object.assign(new Error(r.transcripciones.map((t) => t.aviso).filter(Boolean)[0] || 'No se ha podido transcribir'), { publico: true });
        return r;
      }, true));
      app.post('/api/archivos/transcribir', h(async (req) => {
        const r = await adjuntos.transcribirVideo(String(req.body?.url || ''));
        if (r.nueva) r.nota = jarvis.crearNota({ carpeta: '03-Transcripciones', titulo: `Transcripción · ${path.basename(decodeURIComponent(r.url)).replace(/^\d+-[0-9a-f]+_/, '').slice(0, 100)}`, contenido: r.texto, origen: 'dashboard', tipo: 'transcripcion' })?.nota || null;
        delete r.nueva;
        return r;
      }, true));
      app.post('/api/jarvis/adjuntos', h(async (req) => {
        const a = await archivos.guardar(req, { nombre: String(req.query.nombre || ''), mime: String(req.query.mime || '') });
        const p = await adjuntos.preparar(a);
        const id = randomBytes(6).toString('hex');
        preparados.set(id, p);
        if (preparados.size > 100) preparados.delete(preparados.keys().next().value);
        return { id, nombre: p.nombre, tipo: p.tipo, url: p.url, duracion: p.duracion, fotogramas: p.fotogramas.length, transcrito: Boolean(p.transcripcion), avisos: p.avisos };
      }));
    }
    app.post('/api/jarvis/preguntar', h((req) => {
      const { adjuntos: ids, ...resto } = req.body || {};
      const lista = (Array.isArray(ids) ? ids : []).map((id) => preparados.get(String(id))).filter(Boolean);
      if (Array.isArray(ids) && ids.length && !lista.length) throw Object.assign(new Error('Los adjuntos han caducado (¿se reinició JARVIS?): vuelve a adjuntarlos'), { publico: true });
      return asistente.preguntar({ ...resto, texto: `${resto.texto || ''}${textoAdjuntos(lista)}` });
    }));
    app.post('/api/jarvis/cancelar', h((req) => asistente.cancelar(req.body || {})));
    app.post('/api/jarvis/nueva-sesion', h((req) => asistente.nuevaSesion(req.body || {})));
    app.get('/api/jarvis/estado', h((req) => asistente.estado({ conversacion: req.query.conversacion || 'principal' })));
  }

  // Voz: ElevenLabs desde el servidor (la clave nunca llega al navegador)
  app.get('/api/voz/estado', (_req, res) => res.json({ elevenlabs: vozConfigurada() }));
  app.post('/api/voz/hablar', async (req, res) => {
    try {
      const audio = await tts(String(req.body?.texto || ''));
      res.type('audio/mpeg').send(audio);
    } catch (e) {
      res.status(e.codigo === 'sin_voz' ? 501 : 502).json({ error: e.message });
    }
  });

  // El MCP (Hermes / Claude Code) avisa aquí cuando guarda algo
  app.post('/api/avisar', (_req, res) => { onChange(); res.json({ ok: true }); });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'No existe' }));

  if (existsSync(DIST)) {
    app.use(express.static(DIST));
    app.get(/^\/(?!api|ws).*/, (_req, res) => res.sendFile(path.join(DIST, 'index.html')));
  } else {
    app.get('/', (_req, res) => res.type('text').send('Falta compilar la interfaz: ejecuta "npm run build".'));
  }
  return app;
}

function main() {
  const cfg = getConfig();
  vigilarEnv(ENV_PATH, { alCambiar: (claves) => console.log(`[JARVIS] Claves actualizadas desde .env: ${claves.join(', ')}`) });
  const { nuevo } = ensureVault(cfg.vaultPath, cfg.templateDir, cfg.mcpScript);
  const db = openDb(cfg.dbPath);
  const jarvis = createJarvis({ db, vault: createVault(cfg.vaultPath) });
  const archivos = createArchivos({ dir: path.join(path.dirname(cfg.dbPath), 'contenido') });

  let wss;
  const emitir = (obj) => {
    const msg = JSON.stringify(obj);
    wss?.clients.forEach((c) => c.readyState === 1 && c.send(msg));
  };
  const onChange = () => emitir({ type: 'cambio', at: Date.now() });
  // Cuando JARVIS termina, el resto del dashboard se refresca (puede haber guardado ideas, tareas…)
  let disenos = null;
  const laboratorio = createLaboratorio({ dir: carpetaPorDefecto(), archivos, jarvis, vaultPath: cfg.vaultPath, log: (m) => console.log(`  [Laboratorio] ${m}`) });
  try { laboratorio.iniciar(); } catch (e) { console.warn(`  [Laboratorio] ${e.message}`); }
  // Lo aprendido de la persona va en las instrucciones de cada mensaje de las conversaciones que crean contenido
  const preferencias = createPreferencias({ db });
  const conPreferencias = (ambitos) => () => ({ sistema: preferencias.instrucciones(ambitos) });
  const asistente = createAsistente({ db, jarvis, vaultPath: cfg.vaultPath, entornos: {
    laboratorio: () => laboratorio.entorno(),
    principal: conPreferencias(['diseno', 'escritura']),
    replicar: conPreferencias(['diseno', 'escritura']),
    diseno: conPreferencias(['diseno']),
    guiones: conPreferencias(['escritura']),
  }, emitir: (e) => { emitir(e); if (e.tipo === 'fin') onChange(); disenos?.alEventoClaude(e); } });
  const instagram = createInstagram({ db, vault: jarvis.vault, alCambiar: onChange });
  const competencia = createCompetencia({ db, instagram, vault: jarvis.vault, alCambiar: onChange });
  const ads = createAds({ db, instagram, alCambiar: onChange });
  const publicar = createPublicar({ db, jarvis, vault: jarvis.vault, alCambiar: onChange });
  const resultados = createResultados({ db, jarvis, vault: jarvis.vault, alCambiar: onChange });
  const jobs = createJobs({ instagram, competencia, ads, asistente, resultados, skills: createSkills(cfg.vaultPath), vault: jarvis.vault, ajustesDb: ajustes(db) });
  jobs.iniciar();
  const hermes = createHermes({ vaultPath: cfg.vaultPath, mcpScript: cfg.mcpScript });
  const publicadorIg = createPublicadorIg({ db, jarvis, instagram, almacen: createAlmacen({}), archivos, alCambiar: onChange });
  publicadorIg.iniciar();
  const kit = createKit({ vaultPath: cfg.vaultPath, copiasDir: path.join(path.dirname(cfg.dbPath), 'kits-anteriores') });
  const motor = createMotor({ kit, archivos, log: (m) => console.log(`  [Diseño] ${m}`) });
  if (process.platform !== 'win32') setTimeout(() => motor.preparar(), 5000).unref();
  disenos = createDisenos({ db, jarvis, kit, motor, archivos, previasDir: path.join(cfg.vaultPath, '.jarvis', 'disenos'), recortarFoto: createRecortador({ archivos, python: () => laboratorio.python() }), asistente, emitir, alCambiar: onChange });
  const recordatorios = createRecordatorios({ db });
  const adjuntos = createAdjuntos({ archivos, vaultPath: cfg.vaultPath, python: () => laboratorio?.python?.() || null });
  const conversiones = createConversiones({ jarvis, archivos, disenos, emitir, alCambiar: onChange });
  const actualizar = createActualizar({ dir: ROOT, dataDir: path.dirname(cfg.dbPath),
    ocupado: () => asistente.estado().ocupado || asistente.estado({ conversacion: 'laboratorio' }).ocupado || disenos?.listar().some((d) => d.estado === 'exportando') });
  const server = createServer(createApp({ jarvis, archivos, publicadorIg, asistente, instagram, competencia, ads, publicar, hermes, jobs, kit, disenos, recordatorios, laboratorio, resultados, adjuntos, preferencias, actualizar, conversiones, port: cfg.port, onChange }));
  // Solo el propio dashboard puede escuchar los eventos (otra web abierta en el navegador, no)
  const local = hostsPermitidos(cfg.port);
  wss = new WebSocketServer({ server, path: '/ws', verifyClient: ({ origin, req }) => local.has(req.headers.host) && (!origin || local.has(origin.replace(/^https?:\/\//, ''))) });
  wss.on('connection', (ws) => ws.send(JSON.stringify({ type: 'hola', at: Date.now() })));

  // PID para que instalar.ps1 pueda parar o reiniciar JARVIS sin tocar otros procesos de Node
  const pidFile = path.join(ROOT, 'data', 'jarvis.pid');
  const borrarPid = () => { try { if (readFileSync(pidFile, 'utf8').trim() === String(process.pid)) rmSync(pidFile); } catch { /* ya no está */ } };
  process.on('exit', borrarPid);
  for (const s of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(s, () => process.exit(0));
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') console.error(`\n  [JARVIS] El puerto ${cfg.port} ya está en uso: probablemente JARVIS ya está abierto (http://localhost:${cfg.port}). Si no, cambia PORT en .env.\n`);
    else console.error(e);
    process.exit(1);
  });

  server.listen(cfg.port, '127.0.0.1', () => {
    mkdirSync(path.dirname(pidFile), { recursive: true });
    writeFileSync(pidFile, String(process.pid));
    console.log(`\n  J A R V I S  ·  online en http://localhost:${cfg.port}`);
    console.log(`  Vault: ${cfg.vaultPath}${nuevo ? '  (creado ahora)' : ''}\n`);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
