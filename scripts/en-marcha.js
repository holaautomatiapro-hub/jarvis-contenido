// Lo usa iniciar-jarvis.bat. Sin argumentos: sale con 0 si JARVIS ya responde y con 1 si no.
// Con --url: escribe la dirección del dashboard (respeta PORT de .env).
import { readFileSync, existsSync } from 'node:fs';
import { leerEnv, ENV_PATH } from '../server/env-archivo.js';

const env = existsSync(ENV_PATH) ? leerEnv(readFileSync(ENV_PATH, 'utf8')) : {};
const port = Number(env.PORT) || 3333;
if (process.argv.includes('--url')) {
  console.log(`http://localhost:${port}/`);
  process.exit(0);
}
try {
  const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
  process.exit(r.ok && (await r.json()).name === 'JARVIS' ? 0 : 1);
} catch {
  process.exit(1);
}
