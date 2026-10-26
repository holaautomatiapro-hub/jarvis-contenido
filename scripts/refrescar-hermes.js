// Tras actualizar JARVIS en el VPS: que Hermes (el bot de Telegram) use ya la versión nueva. Borra su copia de la
// lista de herramientas de JARVIS y lo reinicia. Si no hay Hermes o no usa JARVIS, no hace nada.
import { existsSync, readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { hermesHome, olvidarHerramientasJarvis } from '../server/integrations/hermes.js';

const home = hermesHome();
let config = '';
try { config = readFileSync(path.join(home, 'config.yaml'), 'utf8'); } catch { /* sin Hermes */ }
if (!/^\s{2,}jarvis:\s*$/m.test(config)) process.exit(0);
olvidarHerramientasJarvis(home);

const local = path.join(os.homedir(), '.local', 'bin', 'hermes');
const bin = process.env.HERMES_BIN || (existsSync(local) ? local : 'hermes');
// hermes gateway es un servicio de usuario (systemctl --user): necesita saber dónde está su sesión
const uid = typeof process.getuid === 'function' ? process.getuid() : null;
const runtime = uid != null && existsSync(`/run/user/${uid}`) ? `/run/user/${uid}` : null;
const env = { ...process.env, HERMES_NONINTERACTIVE: '1', ...(runtime && !process.env.XDG_RUNTIME_DIR ? { XDG_RUNTIME_DIR: runtime, DBUS_SESSION_BUS_ADDRESS: `unix:path=${runtime}/bus` } : {}) };
execFile(bin, ['gateway', 'restart'], { env, timeout: 150_000 }, (err, stdout, stderr) => {
  if (err) {
    console.log(`    ! No he podido reiniciar Hermes (${(stderr || err.message).trim().split('\n').pop()}). Hazlo tú:  hermes gateway restart`);
    process.exit(0);
  }
  console.log('    ✓ Hermes (Telegram) reiniciado con la versión nueva de JARVIS');
});
