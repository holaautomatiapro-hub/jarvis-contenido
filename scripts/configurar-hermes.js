// Deja Hermes listo para ser "JARVIS por Telegram": personalidad, MCP jarvis, skills del vault,
// zona horaria y las 4 tareas programadas. Uso:  npm run hermes            (configura)
//                                                npm run hermes -- --simular (solo enseña qué haría)
import path from 'node:path';
import dotenv from 'dotenv';
import { ROOT, getConfig } from '../server/config.js';
import { ensureVault } from '../server/vault.js';
import { createHermes } from '../server/integrations/hermes.js';

dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });
const simular = process.argv.includes('--simular');
const cfg = getConfig();
ensureVault(cfg.vaultPath, cfg.templateDir, cfg.mcpScript);

const hermes = createHermes({ vaultPath: cfg.vaultPath, mcpScript: cfg.mcpScript });
console.log(`\n  Hermes: ${hermes.home}\n  Vault:  ${cfg.vaultPath}\n`);

const r = await hermes.configurar({ simular });
if (!r.pasos.length) {
  console.log(`  ✗ ${r.error}\n`);
  process.exit(1);
}
const icono = { hecho: '✓', ok: '✓', pendiente: '·', manual: '!', aviso: '!', error: '✗' };
for (const p of r.pasos) {
  console.log(`  ${icono[p.estado] || '·'} ${p.titulo}${p.estado === 'hecho' ? ' (ya estaba)' : ''}`);
  if (simular && p.args) console.log(`      hermes ${p.args.map((a) => (/[\s"{]/.test(a) ? JSON.stringify(a) : a)).join(' ')}`.slice(0, 220));
  if (p.aviso) console.log(`      ${p.aviso}`);
  if (p.estado === 'error' || p.estado === 'aviso') console.log(`      ${(p.salida || p.error || '').split('\n').slice(-3).join('\n      ')}`);
}

const e = r.estado || hermes.estado();
const falta = [];
if (!e.telegram.token || !e.telegram.permitidos) falta.push('Conecta Telegram:  hermes gateway setup   (token de @BotFather + tu ID numérico en la lista de permitidos)');
if (!e.telegram.canal) falta.push('En el chat con tu bot escribe /sethome para que las tareas programadas te lleguen ahí');
if (!e.gateway.online) falta.push('Arranca el bot y déjalo al iniciar Windows:  hermes gateway install');
if (falta.length) {
  console.log('\n  Te falta:');
  for (const f of falta) console.log(`   → ${f}`);
}
console.log(simular ? '\n  (Simulación: no se ha cambiado nada)\n' : `\n  ${r.ok ? 'Listo.' : 'Hay pasos con error (arriba).'} Prueba: manda "idea: test desde Telegram" a tu bot y mira Inicio.\n`);
process.exit(r.ok ? 0 : 1);
