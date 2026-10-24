// Contraseña de JARVIS: con ella, para abrir el dashboard hay que iniciar sesión (cada persona, su JARVIS).
//   npm run clave              → pide la contraseña (dos veces, sin que se vea) y la guarda cifrada en .env
//   npm run clave -- --quitar  → la quita (se vuelve a entrar sin contraseña, solo con Tailscale)
// JARVIS la usa al momento, sin reiniciar. Cambiarla cierra las sesiones abiertas y anula el conector de Claude Code
// (hay que volver a instalarlo desde Inicio).
import { createInterface } from 'node:readline';
import { asegurarEnv, guardarEnv, ENV_PATH } from '../server/env-archivo.js';
import { hashClave } from '../server/acceso.js';

const ruta = asegurarEnv(ENV_PATH);
if (process.argv.includes('--quitar')) {
  guardarEnv({ JARVIS_CLAVE: '' }, ruta);
  console.log('  ✓ Contraseña quitada: JARVIS se abre sin contraseña (solo con Tailscale).');
  process.exit(0);
}

// Sin terminal (p. ej. desde el instalador): lee las dos líneas de la entrada
async function leerSinTerminal() {
  const lineas = [];
  for await (const l of createInterface({ input: process.stdin })) { lineas.push(l); if (lineas.length === 2) break; }
  return lineas;
}
function preguntarOculto(texto) {
  return new Promise((ok) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.startsWith(texto)) process.stdout.write(texto); };
    rl.question(texto, (r) => { rl.close(); process.stdout.write('\n'); ok(r); });
  });
}

const [a, b] = process.stdin.isTTY
  ? [await preguntarOculto('  Contraseña nueva para JARVIS: '), await preguntarOculto('  Repítela: ')]
  : await leerSinTerminal();
if (!a || a.length < 8) { console.error('  ✗ Pon al menos 8 caracteres.'); process.exit(1); }
if (a !== b) { console.error('  ✗ No coinciden. Vuelve a probar.'); process.exit(1); }
guardarEnv({ JARVIS_CLAVE: hashClave(a) }, ruta);
console.log('  ✓ Contraseña guardada (cifrada en .env). Al abrir JARVIS te la pedirá.');
console.log('    Si usas el conector de Claude Code, vuelve a instalarlo desde Inicio → «Conectar con Claude Code».');
