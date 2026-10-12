import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { ROOT } from './config.js';

// Quitar el fondo de una foto de la biblioteca (rembg, en el Python del Laboratorio). Devuelve un archivo
// nuevo de la biblioteca: un PNG con la persona recortada sobre transparente.
export function createRecortador({ archivos, python = () => null, script = path.join(ROOT, 'laboratorio', 'quitar-fondo.py'), limiteMs = 180_000 }) {
  return async function recortar(foto) {
    if (!archivos) throw new Error('la biblioteca no está disponible');
    const py = python();
    if (!py) throw new Error('falta el Python del Laboratorio: en el VPS ejecuta bash ~/instalar-vps.sh');
    const origen = archivos.ruta(foto.path);
    if (!existsSync(origen)) throw new Error('la foto ya no está');
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'jarvis-recorte-'));
    try {
      const salida = path.join(tmp, 'sin-fondo.png');
      const r = await new Promise((resolve) => {
        const p = spawn(py, [script, origen, salida], { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
        let err = '';
        const reloj = setTimeout(() => p.kill('SIGKILL'), limiteMs);
        p.stderr.on('data', (d) => { err = (err + d).slice(-1500); });
        p.on('error', (e) => { clearTimeout(reloj); resolve({ ok: false, err: e.message }); });
        p.on('close', (c) => { clearTimeout(reloj); resolve({ ok: c === 0, err }); });
      });
      if (!r.ok || !existsSync(salida)) throw new Error(r.err.trim().split('\n').pop() || 'rembg no ha devuelto nada');
      const base = String(foto.nombre || 'foto').replace(/\.[^.]+$/, '');
      return await archivos.guardar(createReadStream(salida), { nombre: `${base}-sin-fondo.png`, mime: 'image/png' });
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  };
}
