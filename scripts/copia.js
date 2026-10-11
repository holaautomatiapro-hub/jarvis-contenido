// Pasar JARVIS de un equipo a otro (p. ej. del PC al VPS) con todos tus datos.
//   En el PC:   npm run exportar                        → crea JARVIS-copia.tar.gz en la carpeta de JARVIS
//   En el VPS:  npm run importar-copia -- JARVIS-copia.tar.gz
// La copia lleva la base de datos (tareas, piezas, métricas, conexión con Instagram), tus vídeos y fotos,
// el vault de Obsidian y tus claves de .env. Trátala como una contraseña: no la compartas.
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cpSync, createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, renameSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { ROOT, getConfig } from '../server/config.js';
import { asegurarEnv, guardarEnv, leerEnv, ENV_PATH } from '../server/env-archivo.js';

// Lo que depende de cada equipo: no se copia de uno a otro
const LOCALES = new Set(['VAULT_PATH', 'PORT', 'JARVIS_DB', 'JARVIS_HOSTS', 'HERMES_HOME', 'HERMES_BIN', 'HERMES_DASHBOARD_URL']);

function tar(args, cwd) {
  const r = spawnSync('tar', args, { cwd, stdio: 'inherit' });
  if (r.error || r.status !== 0) throw new Error(`No se pudo ejecutar tar ${args[0]} (${r.error?.message || `código ${r.status}`})`);
}

// .tar.gz escrito con Node, sin el tar del sistema: el tar.exe de Windows se cierra con un error de acceso
// (código 3221225477) con algunas copias. Formato ustar, con cabeceras PAX para rutas largas o con tildes.
const MAX_USTAR = 0o77777777777;

function cabecera(nombre, tam, tipo) {
  const h = Buffer.alloc(512);
  h.write(nombre, 0, 100, 'utf8');
  h.write(tipo === '5' ? '0000755\0' : '0000644\0', 100);
  h.write('0000000\0', 108);
  h.write('0000000\0', 116);
  h.write(`${tam.toString(8).padStart(11, '0')}\0`, 124);
  h.write(`${Math.floor(Date.now() / 1000).toString(8).padStart(11, '0')}\0`, 136);
  h.fill(' ', 148, 156);
  h.write(tipo, 156);
  h.write('ustar\0' + '00', 257);
  let suma = 0;
  for (const b of h) suma += b;
  h.write(`${suma.toString(8).padStart(6, '0')}\0 `, 148);
  return h;
}

// Registro PAX "LONGITUD clave=valor\n", donde LONGITUD cuenta también sus propias cifras
function registroPax(clave, valor) {
  const resto = Buffer.byteLength(` ${clave}=${valor}\n`);
  let n = resto + 1;
  while (String(n).length + resto !== n) n = String(n).length + resto;
  return `${n} ${clave}=${valor}\n`;
}

const relleno = (tam) => Buffer.alloc((512 - (tam % 512)) % 512);

function* entrada(nombre, tam, tipo) {
  const grande = tam > MAX_USTAR;
  if (grande || Buffer.byteLength(nombre) > 100 || !/^[\x20-\x7e]*$/.test(nombre)) {
    const pax = Buffer.from(registroPax('path', nombre) + (grande ? registroPax('size', String(tam)) : ''));
    yield cabecera('PaxHeader', pax.length, 'x');
    yield pax;
    yield relleno(pax.length);
    nombre = nombre.replace(/[^\x20-\x7e]/g, '_').slice(-100);
  }
  yield cabecera(nombre, grande ? 0 : tam, tipo);
}

async function* contenidoTar(dir, rel = '') {
  for (const d of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${d.name}` : d.name;
    const abs = path.join(dir, r);
    if (d.isDirectory()) {
      yield* entrada(`${r}/`, 0, '5');
      yield* contenidoTar(dir, r);
    } else if (d.isFile()) {
      const tam = statSync(abs).size;
      yield* entrada(r, tam, '0');
      for await (const trozo of createReadStream(abs)) yield trozo;
      yield relleno(tam);
    }
  }
  if (!rel) yield Buffer.alloc(1024);
}

export async function crearTarGz(dir, destino) {
  await pipeline(Readable.from(contenidoTar(dir)), createGzip(), createWriteStream(destino));
}

export async function exportar({ destino = path.join(ROOT, 'JARVIS-copia.tar.gz') } = {}) {
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
    await crearTarGz(tmp, destino);
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

async function main() {
  const [orden, archivo] = process.argv.slice(2);
  try {
    if (orden === 'exportar') {
      const f = await exportar();
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
