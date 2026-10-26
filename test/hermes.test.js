import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { olvidarHerramientasJarvis, hermesHome, leerEstado, planConfiguracion, createHermes, TAREAS_PROGRAMADAS, SOUL_ORIGEN } from '../server/integrations/hermes.js';
import { openDb } from '../server/db.js';
import { createVault, ensureVault } from '../server/vault.js';
import { createJarvis } from '../server/jarvis.js';
import { getConfig } from '../server/config.js';
import { createApp } from '../server/index.js';

function homeFalso({ config = '', env = '', gateway, jobs, soul } = {}) {
  const home = mkdtempSync(path.join(os.tmpdir(), 'hermes-home-'));
  if (config) writeFileSync(path.join(home, 'config.yaml'), config);
  if (env) writeFileSync(path.join(home, '.env'), env);
  if (soul) writeFileSync(path.join(home, 'SOUL.md'), soul);
  if (gateway) writeFileSync(path.join(home, 'gateway_state.json'), JSON.stringify(gateway));
  if (jobs) { mkdirSync(path.join(home, 'cron')); writeFileSync(path.join(home, 'cron', 'jobs.json'), JSON.stringify({ jobs })); }
  return home;
}
const VAULT = path.join(os.tmpdir(), 'JARVIS-Vault');

describe('Hermes', () => {
  test('HERMES_HOME: %LOCALAPPDATA%\\hermes en Windows, ~/.hermes en el resto, o la variable', () => {
    assert.equal(hermesHome({ LOCALAPPDATA: 'C:\\Users\\ana\\AppData\\Local' }, 'win32'), path.join('C:\\Users\\ana\\AppData\\Local', 'hermes'));
    assert.equal(hermesHome({}, 'linux'), path.join(os.homedir(), '.hermes'));
    assert.equal(hermesHome({ HERMES_HOME: '/opt/h' }, 'win32'), '/opt/h');
  });

  test('lee el estado de sus archivos sin exponer secretos', () => {
    const home = homeFalso({
      config: `model:\n  provider: anthropic\n  default: sonnet-de-prueba\nmcp_servers:\n  jarvis:\n    command: node\n    env:\n      JARVIS_ORIGEN: hermes\nskills:\n  external_dirs:\n    - ${path.join(VAULT, '.claude', 'skills')}\n`,
      env: 'TELEGRAM_BOT_TOKEN=123:SECRETO\nTELEGRAM_ALLOWED_USERS=\nHERMES_TIMEZONE=Europe/Madrid\n',
      gateway: { pid: process.pid, gateway_state: 'running', updated_at: '2026-10-10T10:00:00Z', platforms: { telegram: { state: 'connected' } } },
      jobs: [{ id: 'a1', name: 'jarvis-plan-diario', schedule_display: '45 8 * * *', enabled: true, state: 'scheduled', next_run_at: '2026-10-11T08:45:00+02:00', last_status: 'ok' }, { id: 'b2', name: 'mi-tarea', enabled: false, state: 'paused' }],
      soul: '# JARVIS (por Telegram)\n',
    });
    const e = leerEstado({ home, vaultPath: VAULT });
    assert.equal(e.instalado, true);
    assert.deepEqual(e.gateway, { online: true, estado: 'running', actualizado: '2026-10-10T10:00:00Z', telegram: 'connected' });
    assert.deepEqual(e.telegram, { token: true, permitidos: false, canal: false }, 'una variable vacía cuenta como no configurada');
    assert.equal(e.mcp, true); assert.equal(e.soul, true); assert.equal(e.skills, true); assert.equal(e.zona, true);
    assert.equal(e.modelo, 'sonnet-de-prueba');
    assert.equal(e.tareas.length, 2);
    assert.equal(e.tareas[0].jarvis, true); assert.equal(e.tareas[0].activa, true);
    assert.equal(e.tareas[1].activa, false); assert.equal(e.tareas[1].jarvis, false);
    assert.doesNotMatch(JSON.stringify(e), /SECRETO/);
  });

  test('sin instalar, o con el gateway caído (PID muerto), sale apagado', () => {
    const vacio = leerEstado({ home: path.join(os.tmpdir(), 'no-existe-hermes'), vaultPath: VAULT });
    assert.equal(vacio.instalado, false); assert.equal(vacio.gateway.online, false); assert.equal(vacio.mcp, false);
    const caido = leerEstado({ home: homeFalso({ gateway: { pid: 999999999, gateway_state: 'running' } }), vaultPath: VAULT });
    assert.equal(caido.gateway.online, false);
    // MCP jarvis sin JARVIS_ORIGEN=hermes (configuración antigua): hay que volver a configurarlo
    const viejo = leerEstado({ home: homeFalso({ config: 'mcp_servers:\n  jarvis:\n    command: node\n' }), vaultPath: VAULT });
    assert.equal(viejo.mcp, false);
  });

  test('plan: MCP con JARVIS_ORIGEN=hermes, skills del vault, zona horaria y las 4 tareas sin duplicar', () => {
    const home = homeFalso({ jobs: [{ id: 'x', name: 'jarvis-informe-lunes' }] });
    const pasos = planConfiguracion({ home, vaultPath: VAULT, mcpScript: '/j/mcp/jarvis-mcp.js', nodePath: 'C:\\node\\node.exe' });
    const mcp = pasos.find((p) => p.id === 'mcp');
    assert.deepEqual(mcp.args.slice(0, 3), ['config', 'set', 'mcp_servers.jarvis']);
    assert.deepEqual(JSON.parse(mcp.args[3]), { command: 'C:\\node\\node.exe', args: ['--disable-warning=ExperimentalWarning', '/j/mcp/jarvis-mcp.js'], env: { JARVIS_ORIGEN: 'hermes' }, timeout: 300 });
    assert.deepEqual(JSON.parse(pasos.find((p) => p.id === 'skills').args[3]), [path.join(VAULT, '.claude', 'skills')]);
    const crons = pasos.filter((p) => p.id.startsWith('cron:'));
    assert.equal(crons.length, TAREAS_PROGRAMADAS.length);
    assert.equal(crons.find((p) => p.id === 'cron:jarvis-informe-lunes').hecho, true);
    const diario = crons.find((p) => p.id === 'cron:jarvis-plan-diario');
    assert.deepEqual(diario.args.slice(0, 3), ['cron', 'create', '45 8 * * *']);
    assert.ok(diario.args.includes('--deliver') && diario.args.includes('telegram'));
    assert.equal(diario.args[diario.args.indexOf('--workdir') + 1], VAULT);
    for (const t of TAREAS_PROGRAMADAS) assert.doesNotMatch(t.prompt, /proponer_campana|guardar_versiones|programar_version|activa|publícal/i, 'ninguna tarea publica, programa ni propone campañas');
  });

  test('si ya tienes otras carpetas de skills no las pisa: avisa para añadirla a mano', () => {
    const home = homeFalso({ config: 'skills:\n  external_dirs:\n    - ~/.agents/skills\n' });
    const s = planConfiguracion({ home, vaultPath: VAULT, mcpScript: 'm.js' }).find((p) => p.id === 'skills');
    assert.equal(s.args, undefined);
    assert.match(s.aviso, /Añade a mano/);
  });

  test('configurar ejecuta los pasos pendientes, guarda copia de tu SOUL.md y simular no toca nada', async () => {
    const home = homeFalso({ soul: 'Mi personalidad anterior' });
    const llamadas = [];
    const run = async (bin, args) => { llamadas.push(args); return { ok: true, salida: args[0] === '--version' ? 'Hermes Agent v1.0' : 'ok' }; };
    const hermes = createHermes({ home, vaultPath: VAULT, mcpScript: 'm.js', bin: 'hermes', run });

    const sim = await hermes.configurar({ simular: true });
    assert.equal(llamadas.length, 0);
    assert.ok(sim.pasos.every((p) => ['pendiente', 'hecho', 'manual'].includes(p.estado)));
    assert.equal(readFileSync(path.join(home, 'SOUL.md'), 'utf8'), 'Mi personalidad anterior');

    // Hermes guarda la lista de herramientas del MCP: al configurar se borra la de jarvis (para que vea las nuevas)
    mkdirSync(path.join(home, 'cache'), { recursive: true });
    const cache = path.join(home, 'cache', 'mcp_schema_cache.json');
    writeFileSync(cache, JSON.stringify({ jarvis: { fingerprint: 'a', tools: [] }, otro: { fingerprint: 'b', tools: [] } }));
    const r = await hermes.configurar();
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(cache, 'utf8'))), ['otro']);
    assert.equal(olvidarHerramientasJarvis(home), false, 'ya no estaba');
    assert.equal(olvidarHerramientasJarvis(path.join(home, 'no-existe')), false);
    assert.equal(r.ok, true);
    assert.equal(r.version, 'Hermes Agent v1.0');
    assert.equal(readFileSync(path.join(home, 'SOUL.md'), 'utf8'), readFileSync(SOUL_ORIGEN, 'utf8'));
    assert.equal(readFileSync(path.join(home, 'SOUL.md.antes-de-jarvis'), 'utf8'), 'Mi personalidad anterior');
    assert.equal(llamadas.filter((a) => a[0] === 'cron').length, 4);
    assert.deepEqual(llamadas.at(-1), ['mcp', 'test', 'jarvis']);
    assert.ok(r.pasos.every((p) => !('archivo' in p)), 'no devuelve rutas internas');
  });

  test('sin Hermes instalado lo dice claro y no ejecuta nada más', async () => {
    const llamadas = [];
    const hermes = createHermes({ home: homeFalso(), vaultPath: VAULT, mcpScript: 'm.js', run: async (b, a) => { llamadas.push(a); return { ok: false, error: 'No encuentro el comando hermes' }; } });
    const r = await hermes.configurar();
    assert.equal(r.ok, false);
    assert.match(r.error, /No encuentro Hermes/);
    assert.equal(llamadas.length, 1);
  });

  test('API /api/hermes y /api/hermes/configurar; otra web no puede lanzarlo (CSRF)', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-hermes-'));
    const cfg = getConfig({});
    ensureVault(path.join(dir, 'V'), cfg.templateDir, cfg.mcpScript);
    const db = openDb(':memory:');
    const jarvis = createJarvis({ db, vault: createVault(path.join(dir, 'V')) });
    const r1 = jarvis.capturarIdea({ texto: 'idea: Reel enseñando el bot', origen: 'hermes' });
    assert.equal(r1.pieza.titulo, 'Reel enseñando el bot', '"idea:" no forma parte del título');

    let configurado = 0;
    const hermes = { estado: () => leerEstado({ home: homeFalso(), vaultPath: VAULT }), configurar: async ({ simular }) => { configurado++; return { ok: true, simular, pasos: [] }; } };
    const server = http.createServer();
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
    const port = server.address().port;
    server.on('request', createApp({ jarvis, hermes, port, status: async () => [] }));
    const base = `http://127.0.0.1:${port}`;
    try {
      const d = await (await fetch(`${base}/api/hermes`)).json();
      assert.equal(d.plantillas.length, 4);
      assert.equal(d.mensajes[0].texto, 'Nueva idea vía Telegram: Reel enseñando el bot');
      assert.equal(d.vault, 'V');

      const ok = await fetch(`${base}/api/hermes/configurar`, { method: 'POST', headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}` }, body: '{"simular":true}' });
      assert.equal(ok.status, 200);
      assert.equal((await ok.json()).simular, true);

      const malo = await fetch(`${base}/api/hermes/configurar`, { method: 'POST', headers: { 'content-type': 'text/plain', origin: 'https://web-maliciosa.example' }, body: 'x' });
      assert.equal(malo.status, 403);
      const malo2 = await fetch(`${base}/api/tareas`, { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' }, body: '{"texto":"x"}' });
      assert.equal(malo2.status, 403);
      assert.equal(configurado, 1);
    } finally {
      server.close();
    }
  });
});
