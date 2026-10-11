import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { ROOT, getConfig } from './config.js';
import { leerEnv, ENV_PATH } from './env-archivo.js';
import { leerEstado as estadoHermes, hermesHome } from './integrations/hermes.js';
import { createKit } from './diseno/kit.js';

// Revisión de la instalación: qué está listo y qué falta, con el arreglo de cada cosa.
// Lo usan `npm run doctor` y el instalador al terminar.

export const NODE_MINIMO = [22, 5];

// instalar.ps1 deja JARVIS.vbs (o JARVIS.lnk si Windows ya no tiene VBScript) en la carpeta Inicio
export const arranqueWindows = (env = process.env) => (env.APPDATA ? ['JARVIS.vbs', 'JARVIS.lnk'].map((f) => path.join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', f)) : []);

const version = (cmd, args = ['--version']) => new Promise((resolve) => {
  execFile(cmd, args, { timeout: 15000, windowsHide: true, shell: process.platform === 'win32' }, (err, out) => resolve(err ? null : String(out).trim().split('\n')[0]));
});

async function servidorOk(port, fetchImpl) {
  try {
    const r = await fetchImpl(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
    return r.ok && (await r.json()).name === 'JARVIS';
  } catch { return false; }
}

export async function revisar({
  root = ROOT, envPath = ENV_PATH, plataforma = process.platform, nodeVersion = process.versions.node,
  claude = () => version('claude'), fetchImpl = fetch, conexiones = () => ({ instagram: false, ads: false }),
  procesoEnv = process.env,
} = {}) {
  const r = [];
  const add = (estado, titulo, detalle = '', arreglo = '') => r.push({ estado, titulo, detalle, arreglo });

  const [ma, mi] = nodeVersion.split('.').map(Number);
  const nodeOk = ma > NODE_MINIMO[0] || (ma === NODE_MINIMO[0] && mi >= NODE_MINIMO[1]);
  add(nodeOk ? 'ok' : 'error', `Node.js ${nodeVersion}`, nodeOk ? '' : `JARVIS necesita Node ${NODE_MINIMO.join('.')} o superior (por la base de datos integrada).`, 'Instala Node LTS desde https://nodejs.org o con: winget install -e --id OpenJS.NodeJS.LTS');

  const deps = existsSync(path.join(root, 'node_modules', 'express'));
  add(deps ? 'ok' : 'error', 'Dependencias instaladas', '', 'npm install');
  const web = existsSync(path.join(root, 'web', 'dist', 'index.html'));
  add(web ? 'ok' : 'error', 'Interfaz preparada', '', 'npm run build');

  const hayEnv = existsSync(envPath);
  const e = { ...(hayEnv ? leerEnv(readFileSync(envPath, 'utf8')) : {}) };
  add(hayEnv ? 'ok' : 'error', 'Archivo de configuración (.env)', '', 'Ejecuta instalar.ps1 (lo crea a partir de .env.example)');
  const cfg = getConfig({ ...procesoEnv, ...e });

  const vaultMal = !e.VAULT_PATH || /TU_USUARIO/.test(e.VAULT_PATH);
  const vaultOk = !vaultMal && existsSync(path.join(cfg.vaultPath, 'CLAUDE.md'));
  add(vaultOk ? 'ok' : 'error', 'Vault de Obsidian', vaultOk ? cfg.vaultPath : vaultMal ? 'VAULT_PATH no está configurado en .env' : `No existe ${cfg.vaultPath}`, 'Ejecuta instalar.ps1 de nuevo: crea el vault en Documentos\\JARVIS-Vault');

  const cv = await claude();
  add(cv ? 'ok' : 'error', 'Claude Code (el motor de JARVIS)', cv || 'No encuentro el comando claude.', 'Instálalo: irm https://claude.ai/install.ps1 | iex  · y luego ejecuta claude una vez para iniciar sesión');

  const online = await servidorOk(cfg.port, fetchImpl);
  add(online ? 'ok' : 'aviso', `Dashboard en http://localhost:${cfg.port}`, online ? '' : 'No está arrancado ahora mismo.', 'Doble clic en iniciar-jarvis.bat, o: powershell -ExecutionPolicy Bypass -File instalar.ps1 -Reiniciar');

  if (plataforma === 'win32') {
    const ok = arranqueWindows(procesoEnv).some((f) => existsSync(f));
    add(ok ? 'ok' : 'aviso', 'Arranca solo al iniciar Windows', '', 'powershell -ExecutionPolicy Bypass -File instalar.ps1');
  }

  const voz = Boolean(e.ELEVENLABS_API_KEY && e.ELEVENLABS_VOICE_ID);
  add(voz ? 'ok' : 'aviso', 'Voz de ElevenLabs', voz ? '' : 'Sin clave, JARVIS habla con la voz del navegador y no transcribe reels.', 'npm run claves');

  const meta = Boolean(e.META_APP_ID && e.META_APP_SECRET);
  const c = await conexiones(cfg);
  if (c.instagram) add('ok', 'Instagram conectado');
  else add('aviso', 'Instagram', meta ? 'App de Meta configurada: falta conectar la cuenta desde la pestaña Instagram.' : 'Sin conectar (verás datos de ejemplo).', meta ? 'Pestaña Instagram → Conectar con Facebook' : 'npm run claves  ·  guía: docs/INSTAGRAM.md');
  add(c.ads ? 'ok' : 'aviso', 'Meta Ads', c.ads ? '' : 'Falta la cuenta publicitaria (act_…).', 'Pestaña Meta Ads, o npm run claves  ·  guía: docs/META-ADS.md');

  const kit = createKit({ vaultPath: cfg.vaultPath }).estado();
  if (kit.error) add('aviso', 'Sistema de diseño', kit.error, 'Contenido → Diseño → Importar mi sistema (.zip)');
  else add(kit.propio ? 'ok' : 'aviso', 'Sistema de diseño', kit.propio ? kit.nombre : 'De ejemplo: importa el tuyo para diseñar con tu marca.', 'Contenido → Diseño → Importar mi sistema (.zip)  ·  guía: docs/DISENO.md');

  const h = estadoHermes({ home: hermesHome({ ...procesoEnv, ...e }, plataforma), vaultPath: cfg.vaultPath });
  if (!h.instalado) add('aviso', 'Hermes (Telegram)', 'Sin instalar (opcional).', 'Guía: docs/HERMES.md');
  else if (!(h.mcp && h.soul)) add('aviso', 'Hermes (Telegram)', 'Instalado, pero sin conectar con JARVIS.', 'npm run hermes');
  else if (!(h.telegram.token && h.telegram.permitidos)) add('aviso', 'Hermes (Telegram)', 'Falta conectar el bot de Telegram.', 'hermes gateway setup');
  else add(h.gateway.online ? 'ok' : 'aviso', 'Hermes (Telegram)', h.gateway.online ? '' : 'El bot está parado.', 'hermes gateway install');

  return { listo: r.every((x) => x.estado !== 'error'), revisiones: r };
}
