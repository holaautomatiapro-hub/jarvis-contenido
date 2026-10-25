import { spawn, execFile } from 'node:child_process';
import path from 'node:path';
import { createInterface } from 'node:readline';

// Ejecuta Claude Code en modo headless dentro del vault y traduce su salida (stream-json)
// a eventos sencillos para el terminal "JARVIS OUTPUT".

// Herramientas que JARVIS puede usar sin pedir permiso. Bash queda fuera a propósito.
export const HERRAMIENTAS = ['mcp__jarvis', 'Read', 'Glob', 'Grep', 'Write', 'Edit', 'WebSearch', 'WebFetch', 'TodoWrite'];

const esWindows = process.platform === 'win32';
// En Windows hay que lanzar con shell (claude puede ser .cmd); comillas para rutas con espacios.
const citar = (a) => (esWindows && /[\s&()^|<>"]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);

// herramientasExtra: permisos de más para una conversación concreta (p. ej. el Laboratorio puede ejecutar
// python y ffmpeg con reglas "Bash(python:*)"); sin ellos, Bash sigue prohibido. pluginDirs: plugins de Claude Code.
export function argumentos({ modelo, sesion, mcpConfig, sistema, herramientasExtra = [], pluginDirs = [], esfuerzo = null }) {
  const conBash = herramientasExtra.some((h) => /^Bash\(/.test(h));
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--permission-mode', 'acceptEdits', '--allowedTools', ...HERRAMIENTAS, ...herramientasExtra, ...(conBash ? [] : ['--disallowedTools', 'Bash'])];
  for (const d of pluginDirs) args.push('--plugin-dir', d);
  if (modelo) args.push('--model', modelo);
  if (esfuerzo) args.push('--effort', esfuerzo);
  if (sesion) args.push('--resume', sesion);
  if (mcpConfig) args.push('--mcp-config', mcpConfig);
  if (sistema) args.push('--append-system-prompt', sistema);
  return args;
}

// Si JARVIS se arrancó desde dentro de otra sesión de Claude Code (por ejemplo, durante la instalación),
// no hay que heredar las variables que identifican esa sesión: el Claude de JARVIS debe ser independiente.
const VARIABLES_DE_SESION = ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_PID', 'CLAUDE_CODE_REMOTE_SESSION_ID', 'CLAUDE_AFTER_LAST_COMPACT'];
export function entornoLimpio(base = process.env) {
  const env = { ...base };
  for (const k of VARIABLES_DE_SESION) delete env[k];
  return env;
}

// Pasos internos de Claude Code (cargar herramientas, listas de tareas) que no aportan nada en el terminal
const INTERNAS = new Set(['ToolSearch', 'TodoWrite']);

// Nombre legible de una herramienta: mcp__jarvis__capturar_idea → capturar_idea
const nombreHerramienta = (n = '') => n.replace(/^mcp__[^_]+__/, '');
const resumenEntrada = (input = {}) => {
  const v = input.texto || input.titulo || input.consulta || input.ruta || input.query || input.url || input.file_path || input.pattern || '';
  return String(v).replace(/\s+/g, ' ').slice(0, 90);
};

/**
 * Lanza una petición. Devuelve { cancelar, terminado } y va llamando a onEvento con:
 *  {tipo:'inicio', sesion, modelo} · {tipo:'texto', texto} (trozos en directo)
 *  {tipo:'herramienta', nombre, detalle} · {tipo:'resultado_herramienta', ok}
 *  {tipo:'fin', texto, coste, duracion, sesion} · {tipo:'error', mensaje}
 */
// --effort (cuánto piensa Claude) solo existe en las versiones recientes de Claude Code: se mira una vez en su ayuda
// y, mientras no se sabe o si no lo tiene, no se pasa (una opción desconocida haría fallar la petición).
const conEsfuerzo = new Map();
function admiteEsfuerzo(bin) {
  if (!conEsfuerzo.has(bin)) {
    conEsfuerzo.set(bin, false);
    const [cmd, ...pre] = bin.split('|');
    execFile(citar(cmd), [...pre, '--help'].map(citar), { shell: esWindows, windowsHide: true, timeout: 20_000 }, (e, out) => {
      if (!e) conEsfuerzo.set(bin, /--effort\b/.test(String(out)));
    });
  }
  return conEsfuerzo.get(bin);
}

export function ejecutar({ prompt, cwd, modelo, sesion, mcpConfig, sistema, herramientasExtra, pluginDirs, esfuerzo, bin = process.env.JARVIS_CLAUDE_BIN || 'claude', env = {}, onEvento }) {
  const args = argumentos({ modelo, sesion, mcpConfig, sistema, herramientasExtra, pluginDirs, esfuerzo: esfuerzo && admiteEsfuerzo(bin) ? esfuerzo : null });
  const [cmd, ...pre] = bin.split('|'); // permite "node|ruta/al/simulador.js" en tests
  const child = spawn(citar(cmd), [...pre, ...args].map(citar), {
    cwd,
    env: { ...entornoLimpio(), JARVIS_ORIGEN: 'dashboard', ...env },
    shell: esWindows,
    windowsHide: true,
  });

  let huboDeltas = false, terminado = false, stderr = '', textoFinal = '';
  const internas = new Set(); // ids de herramientas internas de Claude Code que no interesa mostrar
  const emitir = (e) => { if (!terminado || e.tipo === 'fin' || e.tipo === 'error') onEvento?.(e); };

  child.stdin.on('error', () => {});
  child.stdin.end(prompt);

  const rl = createInterface({ input: child.stdout });
  rl.on('line', (linea) => {
    let m;
    try { m = JSON.parse(linea); } catch { return; }
    if (m.type === 'system' && m.subtype === 'init') {
      emitir({ tipo: 'inicio', sesion: m.session_id, modelo: m.model });
    } else if (m.type === 'stream_event' && m.event?.type === 'content_block_delta' && m.event.delta?.type === 'text_delta') {
      huboDeltas = true;
      emitir({ tipo: 'texto', texto: m.event.delta.text });
    } else if (m.type === 'assistant') {
      for (const b of m.message?.content || []) {
        if (b.type === 'tool_use' && INTERNAS.has(b.name)) internas.add(b.id);
        else if (b.type === 'tool_use') emitir({ tipo: 'herramienta', nombre: nombreHerramienta(b.name), detalle: resumenEntrada(b.input) });
        else if (b.type === 'text' && !huboDeltas && b.text) emitir({ tipo: 'texto', texto: b.text });
      }
      // Separa los bloques de texto de cada turno
      if (huboDeltas) emitir({ tipo: 'texto', texto: '\n' });
    } else if (m.type === 'user') {
      for (const b of m.message?.content || []) if (b.type === 'tool_result' && !internas.has(b.tool_use_id)) emitir({ tipo: 'resultado_herramienta', ok: !b.is_error });
    } else if (m.type === 'result') {
      textoFinal = m.result || '';
      if (m.is_error || m.subtype !== 'success') emitir({ tipo: 'error', mensaje: textoFinal || `Claude Code terminó con "${m.subtype}"` });
      else emitir({ tipo: 'fin', texto: textoFinal, coste: m.total_cost_usd ?? null, duracion: m.duration_ms ?? null, sesion: m.session_id });
      terminado = true;
    }
  });

  child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });

  const terminadoP = new Promise((resolve) => {
    child.on('error', (e) => {
      const noInstalado = e.code === 'ENOENT';
      emitir({ tipo: 'error', mensaje: noInstalado ? 'No encuentro Claude Code. Instálalo y comprueba que el comando "claude" funciona en una terminal.' : e.message });
      terminado = true;
      resolve();
    });
    child.on('close', (code) => {
      if (!terminado) {
        const msg = /log ?in|auth|credential/i.test(stderr) ? 'Claude Code no tiene la sesión iniciada. Abre una terminal, ejecuta "claude" y entra con tu cuenta.' : (stderr.trim().split('\n').pop() || `Claude Code se cerró (código ${code})`);
        emitir({ tipo: 'error', mensaje: msg });
        terminado = true;
      }
      resolve();
    });
  });

  const cancelar = () => {
    if (child.exitCode !== null) return;
    if (esWindows) execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {});
    else child.kill('SIGTERM');
  };

  return { cancelar, terminado: terminadoP };
}

export const mcpConfigDe = (vaultPath) => path.join(vaultPath, '.mcp.json');
