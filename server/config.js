import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function getConfig(env = process.env) {
  return {
    port: Number(env.PORT) || 3333,
    vaultPath: env.VAULT_PATH || path.join(os.homedir(), 'Documents', 'JARVIS-Vault'),
    dbPath: env.JARVIS_DB || path.join(ROOT, 'data', 'jarvis.db'),
    templateDir: path.join(ROOT, 'vault-template'),
    mcpScript: path.join(ROOT, 'mcp', 'jarvis-mcp.js'),
  };
}
