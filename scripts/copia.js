// Pasar JARVIS de un equipo a otro (p. ej. del PC al VPS) con todos tus datos.
//   En el PC:   npm run exportar                        → crea JARVIS-copia.tar.gz en la carpeta de JARVIS
//   En el VPS:  npm run importar-copia -- JARVIS-copia.tar.gz
// La copia lleva la base de datos (tareas, piezas, métricas, conexión con Instagram), tus vídeos y fotos,
// el vault de Obsidian y tus claves de .env. Trátala como una contraseña: no la compartas.
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, renameSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { ROOT, getConfig } from '../server/config.js';
import { asegurarEnv, guardarEnv, leerEnv, ENV_PATH } from '../server/env-archivo.js';

// Lo que depende de cada equipo: no se copia de uno a otro
const LOCALES = new Set(['VAULT_PATH', 'PORT', 'JARVIS_DB', 'JARVIS_HOSTS', 'HERMES_HOME', 'HERMES_BIN', 'HERMES_DASHBOARD_URL']);

function tar(args, cwd) {
  const r = spawnSync('tar', args, { cwd, stdio: 'inherit' });
  if (r.error || r.status !== 0) throw new Error(`No se pudo ejecutar tar ${args[0]} (${r.error?.message || `código ${r.status}`})`);
}

export function exportar({ destino = path.join(ROOT, 'JARVIS-copia.tar.gz') } = {}) {
  const cfg = getConfig({ ...process.env, ...leerEnv(readFileSync(asegurarEnv(), 'utf8')) });
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'jarvis-copia-'));
  try {
    // Copia coherente de la base de datos aunque JARVIS esté abierto
    const db = new DatabaseSync(cfg.dbPath);
    db.exec(`VACUUM INTO '${path.join(tmp, 'jarvis.db').replace(/'/g, "''")}'`);
    db.close();
    const contenido = path.join(path.dirname(cfg.dbPath), 'contenido');
    if (existsSync(contenido)) cpSync(contenido, path.join(tmp, 'contenido'), { recursive: true });
    if (existsSync(cfg.vaultPath)) cpSync(cfg.vaultPath, path.join(tmp, 'vault'), { recursive: true, filter: (f) => !/[\\/]\.trash([\\/]|$)/.test(f) });
    if (existsSync(ENV_PATH)) writeFileSync(path.join(tmp, 'env.txt'), readFileSync(ENV_PATH, 'utf8'));
    writeFileSync(path.join(tmp, 'copia.json'), JSON.stringify({ creada: new Date().toISOString(), desde: os.hostname() }, null, 2));
    rmSync(destino, { force: true });
    tar(['-czf', destino, '.'], tmp);
    return destino;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export function importar(archivo) {
  if (!archivo || !existsSync(archivo)) throw new Error('Indica la copia: npm run importar-copia -- JARVIS-copia.tar.gz');
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'jarvis-import-'));
  try {
    tar(['-xzf', path.resolve(archivo)], tmp);
    if (!existsSync(path.join(tmp, 'jarvis.db'))) throw new Error('Esa copia no tiene base de datos: ¿es un JARVIS-copia.tar.gz?');
    const ruta = asegurarEnv();
    const cfg = getConfig({ ...process.env, ...leerEnv(readFileSync(ruta, 'utf8')) });
    const sello = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

    // Claves: las de la copia, menos lo que es propio de este equipo
    if (existsSync(path.join(tmp, 'env.txt'))) {
      const deCopia = leerEnv(readFileSync(path.join(tmp, 'env.txt'), 'utf8'));
      guardarEnv(Object.fromEntries(Object.entries(deCopia).filter(([k, v]) => !LOCALES.has(k) && v !== '')), ruta);
    }
    // Base de datos (la que hubiera se guarda al lado, por si acaso)
    mkdirSync(path.dirname(cfg.dbPath), { recursive: true });
    if (existsSync(cfg.dbPath)) renameSync(cfg.dbPath, `${cfg.dbPath}.antes-${sello}`);
    for (const x of ['-wal', '-shm']) rmSync(cfg.dbPath + x, { force: true });
    cpSync(path.join(tmp, 'jarvis.db'), cfg.dbPath);
    // Vídeos y fotos de Contenido
    if (existsSync(path.join(tmp, 'contenido'))) cpSync(path.join(tmp, 'contenido'), path.join(path.dirname(cfg.dbPath), 'contenido'), { recursive: true });
    // Vault: se juntan las notas (lo del otro equipo manda) y se rehace .mcp.json con las rutas de aquí
    if (existsSync(path.join(tmp, 'vault'))) {
      mkdirSync(cfg.vaultPath, { recursive: true });
      cpSync(path.join(tmp, 'vault'), cfg.vaultPath, { recursive: true, force: true });
      rmSync(path.join(cfg.vaultPath, '.mcp.json'), { force: true });
    }
    return { db: cfg.dbPath, vault: cfg.vaultPath };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function main() {
  const [orden, archivo] = process.argv.slice(2);
  try {
    if (orden === 'exportar') {
      const f = exportar();
      console.log(`\n  ✓ Copia creada: ${f}`);
      console.log('  Lleva tus claves y tu conexión con Instagram: no la compartas y bórrala cuando la hayas pasado.\n');
    } else if (orden === 'importar') {
      const r = importar(archivo);
      console.log(`\n  ✓ Datos importados. Base de datos: ${r.db} · Vault: ${r.vault}`);
      console.log('  Reinicia JARVIS para que los use (en el VPS: sudo systemctl restart jarvis).\n');
    } else {
      console.log('Uso: node scripts/copia.js exportar | importar <archivo>');
      process.exitCode = 1;
    }
  } catch (e) {
    console.error(`\n  ✗ ${e.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
