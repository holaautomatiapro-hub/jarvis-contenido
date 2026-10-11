import path from 'node:path';
import dotenv from 'dotenv';
import express from 'express';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { ROOT, getConfig } from './config.js';
import { openDb } from './db.js';
import { createVault, ensureVault, VaultError } from './vault.js';
import { createJarvis, JarvisError, TareaError } from './jarvis.js';
import { createArchivos, ArchivoError } from './archivos.js';
import { createAlmacen } from './integrations/almacen.js';
import { createPublicadorIg, PublicarError } from './integrations/publicar-ig.js';
import { systemStatus } from './status.js';
import { createAsistente, OcupadoError } from './asistente.js';
import { sintetizar, vozConfigurada } from './tts.js';
import { createSkills } from './skills.js';
import { demoInicio } from '../web/src/lib/demo.js';
import { randomBytes } from 'node:crypto';
import { ajustes } from './db.js';
import { createInstagram } from './integrations/instagram.js';
import { MetaError } from './integrations/meta.js';
import { createJobs } from './integrations/jobs.js';
import { createCompetencia, PROMPT_ANALISIS } from './integrations/competencia.js';
import { createAds } from './integrations/ads.js';
import { createPublicar, REDES, REDES_POR_DEFECTO } from './publicar.js';
import { createHermes, TAREAS_PROGRAMADAS } from './integrations/hermes.js';

dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

const DIST = path.join(ROOT, 'web', 'dist');

export function createApp({ jarvis, archivos, publicadorIg, asistente, instagram, competencia, ads, publicar, hermes, jobs, port, onChange = () => {}, status, tts = sintetizar }) {
  const estadoSistema = status || (() => systemStatus({ vaultPath: jarvis.vault.base, instagram: Boolean(instagram?.estado().conectado), ads: Boolean(ads?.estado().conectado && ads?.estado().cuenta), hermes: Boolean(hermes?.estado().gateway.online) }));
  const app = express();

  // Solo se acepta tráfico de este mismo PC (protege contra webs maliciosas que apunten a localhost)
  const hostsOk = new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`, 'localhost:5173', '127.0.0.1:5173']);
  app.use((req, res, next) => (hostsOk.has(req.headers.host) ? next() : res.status(403).send('Host no permitido')));
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
      if (e.publico) return res.status(400).json({ error: e.message });
      console.error(e);
      res.status(500).json({ error: 'Error interno' });
    }
  };

  app.get('/api/health', (_req, res) => res.json({ ok: true, name: 'JARVIS', version: '0.2.0' }));

  app.get('/api/inicio', h(async () => {
    const real = jarvis.inicio();
    const sistema = await estadoSistema();
    // Hasta que haya datos propios se muestran los de ejemplo (el estado del sistema siempre es real)
    return real.vacio ? { ...demoInicio, sistema } : { demo: false, ...real, sistema };
  }));

  // Instagram: conexión, sincronización y dashboards
  if (instagram) {
    const estados = new Map(); // state del OAuth → caducidad
    const redirectUri = (req) => `http://${req.headers.host.startsWith('127.') ? `127.0.0.1:${port}` : `localhost:${port}`}/api/instagram/callback`;
    const conMensaje = (fn) => async (req) => { try { return await fn(req); } catch (e) { if (!(e instanceof MetaError)) e.publico = true; throw e; } };

    app.get('/api/instagram/estado', h(() => instagram.estado()));
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
  }

  // Meta Ads
  if (ads) {
    const enFondo = (p) => p.catch((e) => console.warn(`  Meta Ads: ${e.message}`));
    app.get('/api/ads', h((req) => ads.resumen({ dias: Math.min(90, Math.max(7, Number(req.query.dias) || 30)) })));
    app.get('/api/ads/cuentas', h(() => ads.cuentas()));
    app.post('/api/ads/cuenta', h((req) => ads.elegirCuenta(req.body?.id), true));
    app.post('/api/ads/actualizar', h((req) => ads.rendimiento({ dias: Number(req.body?.dias) || 30, forzar: true }), true));
    app.post('/api/ads/biblioteca/sincronizar', h(() => { if (!ads.estado().conectado) { const e = new Error('Conecta primero Instagram con Facebook (pestaña Instagram)'); e.publico = true; throw e; } enFondo(ads.sincronizarBiblioteca()); return { ok: true }; }));
    app.post('/api/ads/competidores/:usuario/pagina', h((req) => ads.paginaCompetidor(req.params.usuario, req.body?.pagina), true));
    app.post('/api/ads/borradores', h((req) => ads.proponer(req.body || {}, 'dashboard'), true));
    // Única puerta para crear en Meta: un clic de la persona en el dashboard. Siempre en pausa.
    app.post('/api/ads/borradores/:id/confirmar', h((req) => ads.confirmar(req.params.id), true));
    app.post('/api/ads/borradores/:id/descartar', h((req) => ads.descartar(req.params.id), true));
  }

  // Publicar: versiones por red y calendario (JARVIS prepara, la persona publica)
  if (publicar) {
    app.get('/api/publicar', h((req) => {
      const hoyD = new Date();
      const desde = req.query.desde || new Date(hoyD.getTime() - ((hoyD.getDay() + 6) % 7) * 86400000).toLocaleDateString('sv-SE');
      const hasta = req.query.hasta || new Date(new Date(desde).getTime() + 6 * 86400000).toLocaleDateString('sv-SE');
      return { redes: REDES, porDefecto: REDES_POR_DEFECTO, piezas: publicar.piezas(), calendario: publicar.calendario({ desde, hasta }), trabajando: Boolean(asistente?.estado({ conversacion: 'publicar' }).ocupadoAqui) };
    }));
    app.get('/api/publicar/piezas/:id', h((req) => publicar.listarPieza(req.params.id)));
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
  const usados = () => new Set(jarvis.listarPiezas().flatMap((p) => p.archivos.map((a) => a.path)));
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
  app.post('/api/piezas/:id/instagram/ahora', h((req) => {
    if (!publicadorIg) throw new PublicarError('La publicación en Instagram no está disponible');
    return publicadorIg.publicarAhora(req.params.id);
  }, true));
  app.delete('/api/piezas/:id', h((req) => { const r = jarvis.borrarPieza(req.params.id); borrarArchivosDe([r.pieza]); return { ok: true }; }, true));
  app.get('/api/contenido', h(() => ({ piezas: jarvis.listarPiezas(), carpetas: jarvis.carpetas(), archivos: Boolean(archivos), instagram: publicadorIg?.estado() || { disponible: false, motivo: 'La publicación en Instagram no está disponible' } })));
  app.post('/api/contenido/carpetas', h((req) => jarvis.crearCarpeta(req.body?.nombre), true));
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

  // Notas del vault
  app.get('/api/notas', h(() => jarvis.vault.list()));
  app.get('/api/notas/leer', h((req) => jarvis.vault.read(String(req.query.ruta || ''))));
  app.get('/api/notas/buscar', h((req) => jarvis.vault.search(String(req.query.q || ''))));
  app.post('/api/notas', h((req) => jarvis.crearNota(req.body || {}), true));
  app.post('/api/ideas', h((req) => jarvis.capturarIdea(req.body || {}), true));

  // JARVIS (Claude Code + JEV). La respuesta llega en directo por el WebSocket.
  if (asistente) {
    app.post('/api/jarvis/preguntar', h((req) => asistente.preguntar(req.body || {})));
    app.post('/api/jarvis/cancelar', h(() => asistente.cancelar()));
    app.post('/api/jarvis/nueva-sesion', h((req) => asistente.nuevaSesion(req.body || {})));
    app.get('/api/jarvis/estado', h((req) => asistente.estado({ conversacion: req.query.conversacion || 'principal' })));
    app.get('/api/jarvis/enrutamiento', h(() => asistente.enrutamiento()));
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
  const asistente = createAsistente({ db, jarvis, vaultPath: cfg.vaultPath, emitir: (e) => { emitir(e); if (e.tipo === 'fin') onChange(); } });
  const instagram = createInstagram({ db, vault: jarvis.vault, alCambiar: onChange });
  const competencia = createCompetencia({ db, instagram, vault: jarvis.vault, alCambiar: onChange });
  const ads = createAds({ db, instagram, alCambiar: onChange });
  const publicar = createPublicar({ db, jarvis, vault: jarvis.vault, alCambiar: onChange });
  const jobs = createJobs({ instagram, competencia, ads, asistente, skills: createSkills(cfg.vaultPath), vault: jarvis.vault, ajustesDb: ajustes(db) });
  jobs.iniciar();
  const hermes = createHermes({ vaultPath: cfg.vaultPath, mcpScript: cfg.mcpScript });
  const publicadorIg = createPublicadorIg({ db, jarvis, instagram, almacen: createAlmacen({}), archivos, alCambiar: onChange });
  publicadorIg.iniciar();
  const server = createServer(createApp({ jarvis, archivos, publicadorIg, asistente, instagram, competencia, ads, publicar, hermes, jobs, port: cfg.port, onChange }));
  // Solo el propio dashboard puede escuchar los eventos (otra web abierta en el navegador, no)
  const local = new Set([`localhost:${cfg.port}`, `127.0.0.1:${cfg.port}`, `[::1]:${cfg.port}`, 'localhost:5173', '127.0.0.1:5173']);
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
