import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';

// Actualizar JARVIS desde el dashboard (Apps → JARVIS): mira en GitHub si hay cambios nuevos, los enseña y, en un
// VPS con el servicio jarvis, ejecuta el instalador (que descarga, prepara y reinicia). Se lanza con systemd-run
// para que siga vivo cuando el servicio se reinicia (si no, el reinicio cortaría la propia actualización).

export class ActualizarError extends Error {
  constructor(m) { super(m); this.publico = true; }
}

const git = (dir, args, { timeout = 60_000, ejecutar = execFile } = {}) => new Promise((ok, ko) => {
  ejecutar('git', ['-C', dir, ...args], { timeout, windowsHide: true }, (e, stdout, stderr) => (e ? ko(new Error(String(stderr || e.message).trim())) : ok(String(stdout).trim())));
});

export function createActualizar({ dir, dataDir, env = process.env, plataforma = process.platform, ejecutar = execFile, lanzar = spawn, existe = existsSync, ocupado = () => false }) {
  const logRuta = path.join(dataDir, 'actualizacion.log');
  const estadoRuta = path.join(dataDir, 'actualizacion.json');
  let ultima = null; // última comprobación { pendientes, en }
  const g = (args, o) => git(dir, args, { ejecutar, ...o });

  // En el VPS: Linux con el servicio jarvis (lo crea el instalador) y systemd-run para lanzar la actualización aparte
  const enVps = () => plataforma === 'linux' && existe('/etc/systemd/system/jarvis.service') && existe(path.join(dir, 'scripts', 'instalar-vps.sh'));

  function ultimaActualizacion() {
    let u;
    try { u = JSON.parse(readFileSync(estadoRuta, 'utf8')); } catch { return null; }
    // Si se quedó a medias (p. ej. se reinició el VPS), no se queda «actualizando» para siempre
    if (u?.estado === 'actualizando' && Date.now() - Date.parse(u.inicio) > 30 * 60_000) return { ...u, estado: 'error', cortada: true };
    return u;
  }
  function log() {
    try { return readFileSync(logRuta, 'utf8').split('\n').slice(-40).join('\n'); } catch { return ''; }
  }

  // El título es el del último cambio de verdad (no el «Merge pull request» que lo trajo)
  async function version() {
    const [commit, fecha] = (await g(['log', '-1', '--format=%h%x09%cI'])).split('\t');
    const titulo = await g(['log', '-1', '--no-merges', '--format=%s']).catch(() => '');
    return { commit, fecha, titulo };
  }

  async function estado() {
    if (!existe(path.join(dir, '.git'))) return { disponible: false, motivo: 'Esta copia de JARVIS no se descargó con git: actualízala con el instalador.' };
    let actual = null;
    try { actual = await version(); } catch { /* sin git */ }
    const u = ultimaActualizacion();
    return {
      disponible: true, puedeSola: enVps(), plataforma, actual, comprobado: ultima,
      actualizando: u?.estado === 'actualizando', ultima: u, log: u ? log() : '',
    };
  }

  // Trae lo nuevo de GitHub (sin aplicarlo) y lista los cambios que faltan, del más antiguo al más nuevo
  async function comprobar() {
    try { await g(['fetch', '--quiet'], { timeout: 90_000 }); } catch (e) { throw new ActualizarError(`No he podido mirar si hay cambios en GitHub: ${e.message.slice(0, 200)}`); }
    let lista = '';
    try { lista = await g(['log', '--reverse', '--no-merges', '--format=%h%x09%cI%x09%s', 'HEAD..@{u}']); } catch (e) { throw new ActualizarError(`No sé de qué rama actualizar: ${e.message.slice(0, 200)}`); }
    const pendientes = lista ? lista.split('\n').map((l) => { const [commit, fecha, titulo] = l.split('\t'); return { commit, fecha, titulo }; }) : [];
    ultima = { pendientes, en: new Date().toISOString() };
    return estado();
  }

  async function actualizar({ aunqueOcupado = false } = {}) {
    if (!enVps()) throw new ActualizarError(plataforma === 'win32'
      ? 'En Windows se actualiza con el instalador: en PowerShell, dentro de la carpeta de JARVIS, ejecuta  git pull  y luego  powershell -ExecutionPolicy Bypass -File instalar.ps1'
      : 'Aquí no puedo actualizarme solo: ejecuta  bash ~/instalar-vps.sh  en el servidor.');
    if (ultimaActualizacion()?.estado === 'actualizando') throw new ActualizarError('Ya se está actualizando');
    if (!aunqueOcupado && ocupado()) throw new ActualizarError('JARVIS está trabajando (Claude, el Laboratorio o una exportación): espera a que termine o confirma para actualizar igualmente.');
    mkdirSync(dataDir, { recursive: true });
    const desde = (await version().catch(() => null))?.commit || null;
    const inicio = new Date().toISOString();
    // El estado se escribe al empezar y al terminar; el instalador reinicia el servicio (y este proceso) al final
    const fin = `if [ $c -eq 0 ]; then e=ok; else e=error; fi; h=$(git -C "$JARVIS_DIR" log -1 --format=%h 2>/dev/null); printf '{"estado":"%s","inicio":"%s","fin":"%s","desde":"%s","hasta":"%s","codigo":%s}' "$e" "${inicio}" "$(date -Iseconds)" "${desde || ''}" "$h" "$c" > "${estadoRuta}"`;
    const script = `printf '{"estado":"actualizando","inicio":"${inicio}","desde":"${desde || ''}"}' > "${estadoRuta}"; bash "$JARVIS_DIR/scripts/instalar-vps.sh" > "${logRuta}" 2>&1; c=$?; ${fin}`;
    const home = env.HOME || path.dirname(dir);
    const args = ['--unit', `jarvis-actualizar-${Date.now()}`, '--collect', '--quiet', `--setenv=HOME=${home}`, `--setenv=JARVIS_DIR=${dir}`, `--setenv=PATH=${env.PATH || '/usr/local/bin:/usr/bin:/bin'}`,
      ...(env.PORT ? [`--setenv=JARVIS_PUERTO=${env.PORT}`] : []), `--working-directory=${dir}`, 'bash', '-c', script];
    const sudo = typeof process.getuid === 'function' && process.getuid() !== 0;
    await new Promise((ok, ko) => {
      const p = lanzar(sudo ? 'sudo' : 'systemd-run', sudo ? ['-n', 'systemd-run', ...args] : args, { stdio: 'ignore' });
      p.on('error', (e) => ko(new ActualizarError(`No he podido empezar la actualización (${e.message}). Ejecuta  bash ~/instalar-vps.sh  en el servidor.`)));
      p.on('close', (code) => (code === 0 ? ok() : ko(new ActualizarError('No he podido empezar la actualización (systemd-run). Ejecuta  bash ~/instalar-vps.sh  en el servidor.'))));
    });
    return { ok: true, desde, inicio };
  }

  return { estado, comprobar, actualizar };
}
