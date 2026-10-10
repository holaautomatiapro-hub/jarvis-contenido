import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';

// Comprueba qué piezas del sistema están listas. Devuelve 'on' | 'warn' | 'off'.

function hasCommand(cmd) {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  return new Promise((resolve) => {
    execFile(probe, [cmd], { timeout: 3000, windowsHide: true }, (err) => resolve(!err));
  });
}

async function hermesOnline(url) {
  if (!url) return false;
  try {
    const ctrl = AbortSignal.timeout(1500);
    const r = await fetch(url, { signal: ctrl });
    return r.ok;
  } catch {
    return false;
  }
}

export async function systemStatus({ env = process.env, vaultPath = env.VAULT_PATH, instagram = false, ads = false, hermes: gateway = false } = {}) {
  // Hermes está "online" si su gateway (Telegram) está corriendo o, en su defecto, si responde su panel
  const [claude, hermes] = await Promise.all([hasCommand('claude'), gateway || hermesOnline(env.HERMES_DASHBOARD_URL && `${env.HERMES_DASHBOARD_URL.replace(/\/$/, '')}/api/status`)]);
  const on = (ok) => (ok ? 'on' : 'warn');
  return [
    { label: 'Claude Code', icon: 'claude', estado: on(claude) },
    { label: 'Obsidian', icon: 'obsidian', estado: on(vaultPath && existsSync(vaultPath)) },
    { label: 'Voz · ElevenLabs', icon: 'mic', estado: on(env.ELEVENLABS_API_KEY) },
    { label: 'Instagram', icon: 'instagram', estado: on(instagram) },
    { label: 'Meta Ads', icon: 'ads', estado: on(ads) },
    { label: 'Hermes · Telegram', icon: 'telegram', estado: on(hermes) },
    { label: 'JARVIS Core', icon: 'core', estado: 'on' },
  ];
}
