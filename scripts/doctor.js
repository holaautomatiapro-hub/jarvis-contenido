// Revisa la instalación de JARVIS y dice qué falta. Uso: npm run doctor
import path from 'node:path';
import { existsSync } from 'node:fs';
import dotenv from 'dotenv';
import { ROOT } from '../server/config.js';
import { revisar } from '../server/doctor.js';

dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

// Las conexiones con Meta se leen de la base de datos (solo si ya existe; no la crea)
async function conexiones(cfg) {
  if (!existsSync(cfg.dbPath)) return { instagram: false, ads: false };
  try {
    const { openDb } = await import('../server/db.js');
    const { createInstagram } = await import('../server/integrations/instagram.js');
    const { createAds } = await import('../server/integrations/ads.js');
    const db = openDb(cfg.dbPath);
    const instagram = createInstagram({ db });
    const a = createAds({ db, instagram }).estado();
    const out = { instagram: instagram.estado().conectado, ads: Boolean(a.conectado && a.cuenta) };
    db.close();
    return out;
  } catch {
    return { instagram: false, ads: false };
  }
}

const { listo, revisiones } = await revisar({ conexiones });
const icono = { ok: '✓', aviso: '!', error: '✗' };
console.log('\n  J A R V I S  ·  revisión de la instalación\n');
for (const x of revisiones) {
  console.log(`  ${icono[x.estado]} ${x.titulo}${x.detalle ? `  — ${x.detalle}` : ''}`);
  if (x.estado !== 'ok' && x.arreglo) console.log(`      → ${x.arreglo}`);
}
const avisos = revisiones.filter((x) => x.estado === 'aviso').length;
console.log(listo
  ? `\n  Lo esencial está listo.${avisos ? ` ${avisos} cosa${avisos > 1 ? 's' : ''} opcional${avisos > 1 ? 'es' : ''} por configurar (arriba).` : ''}\n`
  : '\n  Falta algo esencial (✗). Arréglalo y vuelve a ejecutar: npm run doctor\n');
process.exit(listo ? 0 : 1);
