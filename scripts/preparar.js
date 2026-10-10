// Lo llama instalar.ps1: crea .env (si falta), apunta VAULT_PATH a Documentos\JARVIS-Vault,
// crea el vault y la base de datos. Uso: node scripts/preparar.js [--documentos <ruta>]
import path from 'node:path';
import os from 'node:os';
import { readFileSync } from 'node:fs';
import { asegurarEnv, guardarEnv, leerEnv } from '../server/env-archivo.js';
import { getConfig } from '../server/config.js';
import { ensureVault } from '../server/vault.js';
import { openDb } from '../server/db.js';

const i = process.argv.indexOf('--documentos');
// En Windows "Documentos" puede estar en OneDrive: instalar.ps1 pasa la ruta real
const documentos = i > 0 ? process.argv[i + 1] : path.join(os.homedir(), 'Documents');

const ruta = asegurarEnv();
const env = leerEnv(readFileSync(ruta, 'utf8'));
if (!env.VAULT_PATH || /TU_USUARIO/.test(env.VAULT_PATH)) guardarEnv({ VAULT_PATH: path.join(documentos, 'JARVIS-Vault') }, ruta);

const cfg = getConfig({ ...process.env, ...leerEnv(readFileSync(ruta, 'utf8')) });
const { nuevo } = ensureVault(cfg.vaultPath, cfg.templateDir, cfg.mcpScript);
openDb(cfg.dbPath).close();
console.log(JSON.stringify({ vault: cfg.vaultPath, vaultNuevo: nuevo, db: cfg.dbPath, port: cfg.port }));
