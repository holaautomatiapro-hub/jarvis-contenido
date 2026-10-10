// Pide las claves una a una y las guarda en .env (en tu PC: nunca pasan por el chat). Uso: npm run claves
// Enter deja el valor como está. Las claves secretas no se ven al escribirlas.
import path from 'node:path';
import readline from 'node:readline';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { asegurarEnv, guardarEnv, leerEnv, ENV_PATH } from '../server/env-archivo.js';

export const CLAVES = [
  { grupo: 'Voz (ElevenLabs)', id: 'ELEVENLABS_API_KEY', secreto: true, ayuda: 'elevenlabs.io → Developers → API Keys. Sirve para que JARVIS hable con tu voz y transcriba tus reels.' },
  { grupo: 'Voz (ElevenLabs)', id: 'ELEVENLABS_VOICE_ID', ayuda: 'El ID de la voz (elevenlabs.io → Voices → ⋯ → Copy voice ID).', voces: true, validar: (v) => /^[A-Za-z0-9]{20}$/.test(v) || 'Un voice ID de ElevenLabs tiene 20 letras y números (por ejemplo dNjJKg63Fr5AXwIdkATa)' },
  { grupo: 'Instagram y Meta Ads', id: 'META_APP_ID', ayuda: 'developers.facebook.com → tu app → Configuración → Básica → Identificador de la app. Guía: docs/INSTAGRAM.md', validar: (v) => /^\d{6,20}$/.test(v) || 'Debe ser un número' },
  { grupo: 'Instagram y Meta Ads', id: 'META_APP_SECRET', secreto: true, ayuda: 'En la misma página: Clave secreta de la app (botón Mostrar).', validar: (v) => /^[a-f0-9]{32}$/i.test(v) || 'Son 32 caracteres (letras a-f y números)' },
  { grupo: 'Instagram y Meta Ads', id: 'META_CONFIG_ID', ayuda: 'Solo si usas "Inicio de sesión con Facebook para empresas": el ID de la Configuración que creaste con los permisos.', validar: (v) => /^\d{6,20}$/.test(v) || 'Debe ser un número' },
  { grupo: 'Instagram y Meta Ads', id: 'META_AD_ACCOUNT_ID', ayuda: 'Administrador de anuncios → el número de la cuenta publicitaria (también se elige luego en la pestaña Meta Ads).', normalizar: (v) => (/^\d+$/.test(v) ? `act_${v}` : v), validar: (v) => /^act_\d+$/.test(v) || 'Es un número, o act_ seguido del número' },
  { grupo: 'Competencia', id: 'COMPETIDORES', ayuda: 'Usuarios de Instagram separados por comas (sin @).', normalizar: (v) => v.split(',').map((x) => x.trim().replace(/^@/, '')).filter(Boolean).join(',') },
];

export const enmascarar = (v, secreto) => (!v ? '(vacío)' : secreto ? `••••${v.slice(-4)}` : v);

// Voces de tu cuenta de ElevenLabs para elegir por número (si la clave funciona)
export async function vocesElevenLabs(clave, fetchImpl = fetch) {
  try {
    const r = await fetchImpl('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': clave }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return { error: r.status === 401 ? 'ElevenLabs no acepta esa clave (o no tiene permiso para ver voces).' : `ElevenLabs respondió ${r.status}` };
    const d = await r.json();
    return { voces: (d.voices || []).slice(0, 12).map((v) => ({ id: v.voice_id, nombre: v.name, tipo: v.category })) };
  } catch {
    return { error: 'No he podido conectar con ElevenLabs para listar tus voces.' };
  }
}

// Recorre las claves y devuelve solo las que cambian
export async function pedirClaves({ actuales, preguntar, decir = console.log, fetchImpl = fetch }) {
  const cambios = {};
  let grupo = '';
  for (const c of CLAVES) {
    if (c.grupo !== grupo) { grupo = c.grupo; decir(`\n  ── ${grupo} ──`); }
    decir(`  ${c.ayuda}`);
    const valorActual = cambios[c.id] ?? actuales[c.id] ?? '';
    if (c.voces) {
      const clave = cambios.ELEVENLABS_API_KEY ?? actuales.ELEVENLABS_API_KEY;
      if (clave) {
        const r = await vocesElevenLabs(clave, fetchImpl);
        if (r.voces?.length) {
          decir('  Tus voces:');
          r.voces.forEach((v, i) => decir(`    ${String(i + 1).padStart(2)}. ${v.nombre}${v.tipo ? ` (${v.tipo})` : ''}`));
          const elegido = (await preguntar(`  Número de la voz, o pega un voice ID [${enmascarar(valorActual)}]: `, false)).trim();
          const n = Number(elegido);
          if (elegido && Number.isInteger(n) && n >= 1 && n <= r.voces.length) { cambios[c.id] = r.voces[n - 1].id; decir(`  ✓ ${r.voces[n - 1].nombre}`); continue; }
          if (elegido && c.validar(elegido) === true) { cambios[c.id] = elegido; continue; }
          if (elegido) decir(`  ! ${c.validar(elegido)}`);
          else continue;
        }
        if (r.error) decir(`  ! ${r.error}`);
      }
    }
    for (;;) {
      let v = (await preguntar(`  ${c.id} [${enmascarar(valorActual, c.secreto)}]: `, Boolean(c.secreto))).trim();
      if (!v) break;
      if (v === '-') { cambios[c.id] = ''; break; } // "-" la borra
      if (c.normalizar) v = c.normalizar(v);
      const ok = c.validar ? c.validar(v) : true;
      if (ok === true) { cambios[c.id] = v; break; }
      decir(`  ! ${ok}. Prueba otra vez (Enter para saltar).`);
    }
  }
  return cambios;
}

function crearPreguntador() {
  const tty = process.stdin.isTTY;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(tty) });
  let oculto = false;
  let prompt = '';
  if (tty) {
    // Al escribir una clave secreta solo se ven puntos, también cuando readline redibuja la línea (p. ej. al borrar)
    const escribir = rl._writeToOutput.bind(rl);
    rl._writeToOutput = (s) => {
      if (!oculto || /[\r\n]/.test(s)) return escribir(s);
      if (prompt && s.startsWith(prompt)) return escribir(prompt + '•'.repeat(s.length - prompt.length));
      return escribir('•'.repeat(s.length));
    };
  }
  const lineas = [];
  const esperando = [];
  if (!tty) rl.on('line', (l) => (esperando.length ? esperando.shift()(l) : lineas.push(l)));
  const preguntar = (texto, secreto) => new Promise((ok) => {
    oculto = Boolean(secreto);
    prompt = texto;
    if (tty) rl.question(texto, (r) => { oculto = false; ok(r); });
    else { process.stdout.write(texto + '\n'); lineas.length ? ok(lineas.shift()) : esperando.push(ok); }
  });
  return { preguntar, cerrar: () => rl.close() };
}

async function main() {
  const ruta = asegurarEnv();
  const actuales = leerEnv(readFileSync(ruta, 'utf8'));
  console.log('\n  J A R V I S  ·  claves');
  console.log('  Se guardan solo en tu PC, en .env. Enter = dejar como está · "-" = borrar.');
  const { preguntar, cerrar } = crearPreguntador();
  const cambios = await pedirClaves({ actuales, preguntar });
  cerrar();
  const n = Object.keys(cambios).length;
  if (!n) { console.log('\n  No has cambiado nada.\n'); return; }
  guardarEnv(cambios, ruta);
  console.log(`\n  ✓ Guardado (${n} cambio${n > 1 ? 's' : ''}) en ${path.relative(process.cwd(), ruta) || ENV_PATH}.`);
  console.log('  Reinicia JARVIS para que lo use:  powershell -ExecutionPolicy Bypass -File instalar.ps1 -Reiniciar\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
