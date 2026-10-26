import os from 'node:os';
import path from 'node:path';
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { ROOT } from '../config.js';

// Hermes Agent (Nous Research) como "JARVIS en el móvil" por Telegram.
// Hermes guarda todo en HERMES_HOME: %LOCALAPPDATA%\hermes en Windows nativo, ~/.hermes en Linux/macOS/WSL.
// Aquí solo LEEMOS sus archivos para el dashboard (sin tocar secretos) y preparamos los comandos `hermes ...`
// que dejan configurado el MCP jarvis, la personalidad (SOUL.md), las skills del vault y las tareas programadas.

export const SOUL_ORIGEN = path.join(ROOT, 'hermes', 'SOUL.md');
export const ZONA_HORARIA = 'Europe/Madrid';

// Tareas programadas (cron). Cada una se ejecuta en una sesión nueva de Hermes dentro del vault y
// el resultado llega a tu chat de Telegram. Ninguna publica ni gasta: solo lee, resume y guarda ideas o tareas.
export const TAREAS_PROGRAMADAS = [
  {
    nombre: 'jarvis-plan-diario',
    titulo: 'Plan del día',
    cuando: 'Todos los días · 8:45',
    cron: '45 8 * * *',
    prompt: 'Buenos días. Usa tareas_de_hoy, recordatorios_de_hoy y resumen_del_dia del MCP jarvis y escribe mi plan de hoy en 5 líneas como mucho: primero lo atrasado y la prioridad alta. Después, con mi_semana: qué tengo que producir con urgencia, si hay huecos en los próximos días y cómo voy con mi ritmo semanal. Si hay un hueco, propón con qué pieza lista sin fecha (o idea) taparlo. No guardes nada. No inventes datos.',
  },
  {
    nombre: 'jarvis-informe-lunes',
    titulo: 'Informe de rendimiento',
    cuando: 'Lunes · 9:10',
    cron: '10 9 * * 1',
    prompt: 'Informe semanal. Usa metricas_instagram (últimos 7 días frente a la media) y dime: la pieza que mejor funcionó y por qué (gancho, tema, formato), la que peor, y qué repetiría esta semana. Añade qué reel merece impulsarse según contenido_para_impulsar, sin crear campañas. Si los datos son de ejemplo (demo), dilo en la primera línea. Máximo 10 líneas.',
  },
  {
    nombre: 'jarvis-competencia-jueves',
    titulo: 'Novedades de la competencia',
    cuando: 'Jueves · 9:40',
    cron: '40 9 * * 4',
    prompt: 'Revisa la competencia con competencia_datos: qué han publicado esta semana, qué ganchos y formatos les funcionan y qué patrón se repite. Termina con 3 ideas adaptadas a mi negocio y guárdalas con capturar_idea. Si los datos son de ejemplo (demo), dilo y no guardes nada. Máximo 10 líneas.',
  },
  {
    nombre: 'jarvis-semana-domingo',
    titulo: 'Planificación de la semana',
    cuando: 'Domingo · 18:50',
    cron: '50 18 * * 0',
    prompt: 'Planifica mi semana de contenido. Mira mi_semana (con la fecha del lunes que viene), listar_pipeline y calendario_publicaciones de los próximos 7 días y propón qué grabar, editar y publicar cada día de publicación (una línea por día), tapando los huecos y cumpliendo mi ritmo semanal. Mira también listar_tareas (atrasadas y de esta semana). Añade como tareas con anadir_tarea solo las 3 más importantes del lunes, con su prioridad. No publiques ni programes nada más.',
  },
];

export function hermesHome(env = process.env, plataforma = process.platform) {
  if (env.HERMES_HOME) return env.HERMES_HOME;
  if (plataforma === 'win32') return path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'hermes');
  return path.join(os.homedir(), '.hermes');
}

const leer = (f) => { try { return readFileSync(f, 'utf8'); } catch { return null; } };
const leerJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };

// Solo comprueba si una variable existe y tiene valor; nunca devuelve el valor (son secretos)
function clavesEnv(texto) {
  const claves = new Set();
  for (const linea of String(texto || '').split(/\r?\n/)) {
    const m = linea.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && m[2].trim() && !/^["']{2}$/.test(m[2].trim())) claves.add(m[1]);
  }
  return claves;
}

function pidVivo(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// Lee una lista YAML sencilla (`clave:` seguida de `- valor`, o `clave: [a, b]`) sin dependencias
function listaYaml(texto, clave) {
  const lineas = String(texto).split(/\r?\n/);
  const i = lineas.findIndex((l) => new RegExp(`^\\s*${clave}:`).test(l));
  if (i < 0) return null;
  const limpia = (v) => v.trim().replace(/^["']|["']$/g, '');
  const enLinea = lineas[i].split(':').slice(1).join(':').trim();
  if (enLinea.startsWith('[')) return enLinea.replace(/^\[|\]$/g, '').split(',').map(limpia).filter(Boolean);
  const sangria = lineas[i].match(/^\s*/)[0].length;
  const out = [];
  for (const l of lineas.slice(i + 1)) {
    if (!l.trim()) continue;
    const m = l.match(/^(\s*)-\s*(.+)$/);
    if (!m || m[1].length < sangria) break;
    out.push(limpia(m[2]));
  }
  return out;
}

function modeloDe(texto) {
  const m = String(texto).match(/^model:[ \t]*(\S[^\n]*)?$/m);
  if (!m) return null;
  if (m[1]) return m[1].trim().replace(/^["']|["']$/g, '');
  const bloque = String(texto).slice(m.index + m[0].length).split(/\n(?=\S)/)[0];
  return (bloque.match(/^\s+default:\s*["']?([^"'\n]+)["']?\s*$/m) || [])[1] || null;
}

const normalizaRuta = (p) => path.resolve(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

// Lee el estado de Hermes desde sus archivos (no necesita que el panel de Hermes esté abierto)
export function leerEstado({ home = hermesHome(), vaultPath } = {}) {
  const instalado = existsSync(home);
  const config = leer(path.join(home, 'config.yaml')) || '';
  const env = clavesEnv(leer(path.join(home, '.env')));
  const soul = leer(path.join(home, 'SOUL.md')) || '';
  const gw = leerJson(path.join(home, 'gateway_state.json'));
  const jobs = leerJson(path.join(home, 'cron', 'jobs.json'));

  const vivo = Boolean(gw && pidVivo(Number(gw.pid)) && !['stopped', 'startup_failed'].includes(gw.gateway_state));
  const tg = gw?.platforms?.telegram || null;
  const skillsVault = vaultPath ? path.join(vaultPath, '.claude', 'skills') : null;
  const dirs = listaYaml(config, 'external_dirs') || [];

  const tareas = (Array.isArray(jobs?.jobs) ? jobs.jobs : []).map((j) => ({
    id: j.id,
    nombre: j.name || j.id,
    horario: j.schedule_display || j.schedule?.display || j.schedule?.expr || '',
    activa: j.enabled !== false && !j.paused_at && j.state !== 'paused',
    proxima: j.next_run_at || null,
    ultima: j.last_run_at || null,
    resultado: j.last_status || null,
    jarvis: TAREAS_PROGRAMADAS.some((t) => t.nombre === j.name),
  }));

  return {
    instalado,
    home,
    gateway: {
      online: vivo,
      estado: gw?.gateway_state || (instalado ? 'stopped' : null),
      actualizado: gw?.updated_at || null,
      telegram: tg ? (tg.state || tg.status || 'conectado') : null,
    },
    telegram: {
      token: env.has('TELEGRAM_BOT_TOKEN'),
      permitidos: env.has('TELEGRAM_ALLOWED_USERS'),
      canal: env.has('TELEGRAM_HOME_CHANNEL'),
    },
    mcp: /^\s{2,}jarvis:\s*$/m.test(config) && /mcp_servers:/.test(config) && /JARVIS_ORIGEN['"]?:\s*['"]?hermes/.test(config),
    soul: /\bJARVIS\b/.test(soul),
    skills: Boolean(skillsVault && dirs.some((d) => normalizaRuta(d) === normalizaRuta(skillsVault))),
    otrasSkills: dirs.length > 0,
    zona: env.has('HERMES_TIMEZONE'),
    modelo: modeloDe(config),
    tareas,
  };
}

// Pasos para dejar Hermes listo. Cada paso: { id, titulo, hecho, args? (comando hermes), archivo?, aviso? }
export function planConfiguracion({ home, vaultPath, mcpScript, nodePath = process.execPath, estado = leerEstado({ home, vaultPath }) }) {
  const pasos = [];
  const soulActual = leer(path.join(home, 'SOUL.md'));
  const soulNuevo = leer(SOUL_ORIGEN);
  pasos.push({ id: 'soul', titulo: 'Personalidad de JARVIS (SOUL.md)', hecho: soulActual === soulNuevo, archivo: { desde: SOUL_ORIGEN, hasta: path.join(home, 'SOUL.md') } });

  const servidor = { command: nodePath, args: ['--disable-warning=ExperimentalWarning', mcpScript], env: { JARVIS_ORIGEN: 'hermes' }, timeout: 300 };
  pasos.push({ id: 'mcp', titulo: 'MCP jarvis (memoria, pipeline, métricas, ads y publicar)', hecho: false, args: ['config', 'set', 'mcp_servers.jarvis', JSON.stringify(servidor)] });

  const skillsVault = path.join(vaultPath, '.claude', 'skills');
  if (estado.skills) pasos.push({ id: 'skills', titulo: 'Skills de contenido del vault', hecho: true });
  else if (estado.otrasSkills) pasos.push({ id: 'skills', titulo: 'Skills de contenido del vault', hecho: false, aviso: `Ya tienes skills.external_dirs en config.yaml. Añade a mano esta ruta a la lista: ${skillsVault}` });
  else pasos.push({ id: 'skills', titulo: 'Skills de contenido del vault', hecho: false, args: ['config', 'set', 'skills.external_dirs', JSON.stringify([skillsVault])] });

  pasos.push({ id: 'zona', titulo: `Zona horaria (${ZONA_HORARIA})`, hecho: estado.zona, args: ['config', 'set', 'HERMES_TIMEZONE', ZONA_HORARIA] });

  for (const t of TAREAS_PROGRAMADAS) {
    const existe = estado.tareas.some((j) => j.nombre === t.nombre);
    pasos.push({ id: `cron:${t.nombre}`, titulo: `Tarea programada: ${t.titulo} (${t.cuando})`, hecho: existe,
      args: ['cron', 'create', t.cron, t.prompt, '--name', t.nombre, '--deliver', 'telegram', '--workdir', vaultPath] });
  }
  pasos.push({ id: 'test', titulo: 'Probar la conexión con el MCP jarvis', hecho: false, verificacion: true, args: ['mcp', 'test', 'jarvis'] });
  return pasos;
}

function ejecutar(bin, args, timeout = 120000) {
  return new Promise((resolve) => {
    // Sin shell: los argumentos llegan tal cual (rutas con espacios, JSON, prompts con comillas)
    execFile(bin, args, { timeout, windowsHide: true, env: { ...process.env, HERMES_NONINTERACTIVE: '1', PYTHONUTF8: '1' }, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => resolve({ ok: !err, salida: `${stdout || ''}${stderr || ''}`.trim().slice(-2000), error: err && (err.code === 'ENOENT' ? 'No encuentro el comando hermes. Instálalo (docs/HERMES.md) y abre una terminal nueva.' : err.message) }));
  });
}

export function createHermes({ env = process.env, vaultPath, mcpScript, home = hermesHome(env), bin = env.HERMES_BIN || 'hermes', run = ejecutar } = {}) {
  let ocupado = false;

  const estado = () => leerEstado({ home, vaultPath });

  async function hayCli() {
    const r = await run(bin, ['--version'], 15000);
    return r.ok ? (r.salida.split('\n')[0] || 'ok') : null;
  }

  // Ejecuta los pasos pendientes. simular=true solo devuelve qué haría.
  async function configurar({ simular = false } = {}) {
    if (ocupado) throw new Error('Ya estoy configurando Hermes');
    ocupado = true;
    try {
      const version = simular ? null : await hayCli();
      if (!simular && !version) return { ok: false, error: 'No encuentro Hermes en este PC. Instálalo con el comando de docs/HERMES.md y abre una terminal nueva.', pasos: [] };
      const pasos = planConfiguracion({ home, vaultPath, mcpScript, estado: estado() });
      const resultado = [];
      for (const p of pasos) {
        if (p.hecho) { resultado.push({ ...p, estado: 'hecho' }); continue; }
        if (p.aviso) { resultado.push({ ...p, estado: 'manual' }); continue; }
        if (simular) { resultado.push({ ...p, estado: 'pendiente' }); continue; }
        if (p.archivo) {
          const previo = leer(p.archivo.hasta);
          if (previo != null && !/\bJARVIS\b/.test(previo)) writeFileSync(`${p.archivo.hasta}.antes-de-jarvis`, previo, 'utf8');
          copyFileSync(p.archivo.desde, p.archivo.hasta);
          resultado.push({ ...p, estado: 'ok' });
          continue;
        }
        const r = await run(bin, p.args);
        resultado.push({ ...p, estado: r.ok ? 'ok' : (p.verificacion ? 'aviso' : 'error'), salida: r.salida, error: r.error });
      }
      const fallos = resultado.filter((p) => p.estado === 'error');
      return { ok: fallos.length === 0, version, pasos: resultado.map(({ archivo, ...p }) => p), estado: estado() };
    } finally {
      ocupado = false;
    }
  }

  return { estado, configurar, hayCli, home };
}
