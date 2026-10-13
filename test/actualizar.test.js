import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createActualizar } from '../server/actualizar.js';

let dir, origen, copia, otra;
const g = (cwd, ...a) => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { stdio: 'pipe' }).toString().trim();
before(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-act-'));
  origen = path.join(dir, 'origen.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origen]);
  otra = path.join(dir, 'otra');
  execFileSync('git', ['clone', '-q', origen, otra], { stdio: 'pipe' });
  writeFileSync(path.join(otra, 'a.txt'), '1');
  g(otra, 'add', '.'); g(otra, 'commit', '-qm', 'Primera versión'); g(otra, 'push', '-q', 'origin', 'HEAD:main');
  copia = path.join(dir, 'JARVIS');
  execFileSync('git', ['clone', '-q', origen, copia], { stdio: 'pipe' });
});
after(() => rmSync(dir, { recursive: true, force: true }));

describe('actualizar JARVIS', () => {
  test('mira en GitHub los cambios que faltan, con su título', async () => {
    const a = createActualizar({ dir: copia, dataDir: path.join(dir, 'data'), plataforma: 'linux' });
    assert.equal((await a.estado()).actual.titulo, 'Primera versión');
    assert.deepEqual((await a.comprobar()).comprobado.pendientes, []);
    for (const t of ['Replicar desde un enlace', 'Barra de progreso en Diseño']) {
      writeFileSync(path.join(otra, 'a.txt'), t); g(otra, 'commit', '-qam', t); g(otra, 'push', '-q', 'origin', 'HEAD:main');
    }
    const e = await a.comprobar();
    assert.deepEqual(e.comprobado.pendientes.map((c) => c.titulo), ['Replicar desde un enlace', 'Barra de progreso en Diseño']);
    assert.equal(e.actual.titulo, 'Primera versión', 'comprobar no aplica nada');
    assert.equal(e.puedeSola, false, 'sin el servicio jarvis no se actualiza sola');
  });

  test('en el VPS lanza el instalador aparte del servicio (systemd-run) y apunta el estado', async () => {
    let llamada;
    const lanzar = (bin, args) => { llamada = { bin, args }; const p = new EventEmitter(); setImmediate(() => p.emit('close', 0)); return p; };
    const a = createActualizar({ dir: copia, dataDir: path.join(dir, 'data'), plataforma: 'linux', env: { HOME: '/root', PATH: '/usr/bin', PORT: '3333' }, existe: () => true, lanzar });
    assert.equal((await a.estado()).puedeSola, true);
    const r = await a.actualizar();
    assert.ok(r.ok);
    const args = llamada.bin === 'sudo' ? llamada.args.slice(2) : llamada.args;
    assert.ok(args.includes('--collect') && args.includes(`--setenv=JARVIS_DIR=${copia}`) && args.includes('--setenv=HOME=/root') && args.includes('--setenv=JARVIS_PUERTO=3333'));
    assert.match(args.at(-1), /bash "\$JARVIS_DIR\/scripts\/instalar-vps\.sh" > ".*actualizacion\.log" 2>&1/);
  });

  test('no corta un trabajo en marcha sin confirmar, ni se lanza dos veces, y en Windows explica cómo', async () => {
    const lanzar = () => { const p = new EventEmitter(); setImmediate(() => p.emit('close', 0)); return p; };
    const data = path.join(dir, 'data2');
    const a = createActualizar({ dir: copia, dataDir: data, plataforma: 'linux', existe: () => true, lanzar, ocupado: () => true });
    await assert.rejects(() => a.actualizar(), /está trabajando/);
    // El script escribe «actualizando» al empezar: mientras, no se puede lanzar otra
    execFileSync('mkdir', ['-p', data]);
    writeFileSync(path.join(data, 'actualizacion.json'), JSON.stringify({ estado: 'actualizando', inicio: new Date().toISOString() }));
    assert.equal((await a.estado()).actualizando, true);
    await assert.rejects(() => a.actualizar({ aunqueOcupado: true }), /Ya se está actualizando/);
    writeFileSync(path.join(data, 'actualizacion.json'), JSON.stringify({ estado: 'actualizando', inicio: new Date(Date.now() - 3600_000).toISOString() }));
    assert.equal((await a.estado()).ultima.cortada, true, 'una que se quedó a medias no bloquea');
    const w = createActualizar({ dir: copia, dataDir: data, plataforma: 'win32' });
    await assert.rejects(() => w.actualizar(), /instalar\.ps1/);
  });
});
