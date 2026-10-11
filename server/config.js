import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Direcciones desde las que se puede abrir JARVIS. Siempre este mismo equipo; en un VPS, además, las de
// JARVIS_HOSTS (p. ej. el nombre de Tailscale: jarvis.tu-red.ts.net). Nunca se abre a internet sin más.
export function hostsPermitidos(port, env = process.env) {
  const extra = String(env.JARVIS_HOSTS || '').split(',').map((h) => h.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean);
  return new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`, 'localhost:5173', '127.0.0.1:5173', ...extra, ...extra.map((h) => `${h}:${port}`)]);
}

export function getConfig(env = process.env) {
  return {
    port: Number(env.PORT) || 3333,
    vaultPath: env.VAULT_PATH || path.join(os.homedir(), 'Documents', 'JARVIS-Vault'),
    dbPath: env.JARVIS_DB || path.join(ROOT, 'data', 'jarvis.db'),
    templateDir: path.join(ROOT, 'vault-template'),
    mcpScript: path.join(ROOT, 'mcp', 'jarvis-mcp.js'),
  };
}
