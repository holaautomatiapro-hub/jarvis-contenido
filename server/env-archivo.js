import { existsSync, readFileSync, writeFileSync, copyFileSync, watchFile, unwatchFile } from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

// Lectura y escritura del .env de JARVIS conservando comentarios y orden (lo usan `npm run claves` y el doctor)

export const ENV_PATH = path.join(ROOT, '.env');
export const ENV_EJEMPLO = path.join(ROOT, '.env.example');

export function leerEnv(texto) {
  const out = {};
  for (const linea of String(texto || '').split(/\r?\n/)) {
    const m = linea.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const q = m[2].match(/^(["'`])(.*)\1/);
    // Igual que dotenv: sin comillas, lo que va tras # es comentario
    out[m[1]] = q ? q[2] : m[2].split('#')[0].trim();
  }
  return out;
}

// Sin comillas salvo que haga falta. Las comillas simples son literales en dotenv (las rutas de Windows con \ quedan tal cual)
const valorEnv = (v) => {
  const s = String(v).replace(/[\r\n]/g, '');
  if (!/[#"'`]/.test(s) && s === s.trim()) return s;
  if (!s.includes("'")) return `'${s}'`;
  return `"${s.replace(/"/g, '')}"`;
};

// Cambia las claves indicadas en su sitio y añade al final las que no existan. Respeta el salto de línea del archivo.
export function actualizarEnv(texto, cambios) {
  const eol = /\r\n/.test(texto) ? '\r\n' : '\n';
  const lineas = String(texto || '').split(/\r?\n/);
  const pendientes = new Map(Object.entries(cambios));
  const out = lineas.map((l) => {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=/);
    if (!m || !pendientes.has(m[1])) return l;
    const v = pendientes.get(m[1]);
    pendientes.delete(m[1]);
    return `${m[1]}=${valorEnv(v)}`;
  });
  while (out.length && out.at(-1) === '') out.pop();
  for (const [k, v] of pendientes) out.push(`${k}=${valorEnv(v)}`);
  return out.join(eol) + eol;
}

export function asegurarEnv(ruta = ENV_PATH, ejemplo = ENV_EJEMPLO) {
  if (!existsSync(ruta)) copyFileSync(ejemplo, ruta);
  return ruta;
}

export function guardarEnv(cambios, ruta = ENV_PATH) {
  const actual = existsSync(ruta) ? readFileSync(ruta, 'utf8') : '';
  writeFileSync(ruta, actualizarEnv(actual, cambios), 'utf8');
}

// Si cambia el .env (p. ej. con  npm run claves ), las claves nuevas se usan sin reiniciar JARVIS: se copian a
// process.env, que es el objeto que leen todas las integraciones. Devuelve una función para dejar de vigilar.
export function vigilarEnv(ruta = ENV_PATH, { env = process.env, cada = 3000, alCambiar = () => {} } = {}) {
  const aplicar = () => {
    let texto;
    try { texto = readFileSync(ruta, 'utf8'); } catch { return []; }
    const cambiadas = Object.entries(leerEnv(texto)).filter(([k, v]) => env[k] !== v).map(([k, v]) => { env[k] = v; return k; });
    if (cambiadas.length) alCambiar(cambiadas);
    return cambiadas;
  };
  const f = (actual, antes) => { if (actual.mtimeMs !== antes.mtimeMs) aplicar(); };
  watchFile(ruta, { interval: cada, persistent: false }, f);
  return Object.assign(() => unwatchFile(ruta, f), { aplicar });
}
