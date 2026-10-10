import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../server/db.js';
import { createVault, ensureVault } from '../server/vault.js';
import { createJarvis } from '../server/jarvis.js';
import { getConfig } from '../server/config.js';
import { clasificar } from '../server/router-jev.js';
import { argumentos, ejecutar, entornoLimpio } from '../server/claude-runner.js';
import { createAsistente, OcupadoError } from '../server/asistente.js';
import { textoParaVoz, sintetizar } from '../server/tts.js';

const FALSO = `${process.execPath}|${path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'claude-falso.js')}`;
const ejecutarFalso = (o) => ejecutar({ ...o, bin: FALSO });

describe('JEV (clasificador)', () => {
  const casos = [
    ['Analiza qué reel debería impulsar esta semana', 'estrategia', 'opus'],
    ['Escríbeme un guion para un reel sobre automatizar WhatsApp', 'escritura', 'sonnet'],
    ['Busca en internet las tendencias de reels de este mes', 'web', 'sonnet'],
    ['Apunta esta idea: reel sobre JARVIS en Windows', 'memoria', 'haiku'],
    ['Resume mi día', 'memoria', 'haiku'],
    ['¿Qué hora es en México?', 'rapido', 'haiku'],
  ];
  for (const [texto, ruta, modelo] of casos) {
    test(`"${texto}" → ${ruta}`, () => {
      const r = clasificar(texto);
      assert.equal(r.ruta, ruta);
      assert.equal(r.modelo, modelo);
    });
  }
  test('se puede forzar el modelo', () => {
    const r = clasificar('Resume mi día', { forzarModelo: 'opus' });
    assert.equal(r.modelo, 'opus');
    assert.equal(r.etiqueta, 'Claude Opus');
    assert.equal(clasificar('hola', { forzarModelo: 'gpt' }).modelo, 'haiku');
  });
});

describe('motor (Claude Code headless)', () => {
  test('argumentos: sin Bash, con MCP del vault y modo stream', () => {
    const a = argumentos({ modelo: 'sonnet', sesion: 'abc', mcpConfig: '/v/.mcp.json' });
    assert.ok(a.includes('-p') && a.includes('stream-json') && a.includes('--verbose'));
    assert.deepEqual(a.slice(a.indexOf('--disallowedTools'), a.indexOf('--disallowedTools') + 2), ['--disallowedTools', 'Bash']);
    assert.equal(a[a.indexOf('--resume') + 1], 'abc');
    assert.equal(a[a.indexOf('--mcp-config') + 1], '/v/.mcp.json');
    assert.ok(a.includes('mcp__jarvis'));
  });

  test('traduce el stream a eventos: inicio, herramienta, texto en directo y fin', async () => {
    const ev = [];
    const r = ejecutarFalso({ prompt: 'hola', cwd: os.tmpdir(), modelo: 'haiku', onEvento: (e) => ev.push(e) });
    await r.terminado;
    const tipos = ev.map((e) => e.tipo);
    assert.equal(tipos[0], 'inicio');
    assert.ok(tipos.includes('herramienta'));
    assert.deepEqual(ev.filter((e) => e.tipo === 'herramienta').map((e) => e.nombre), ['capturar_idea'], 'oculta ToolSearch');
    assert.equal(ev.filter((e) => e.tipo === 'resultado_herramienta').length, 1);
    const texto = ev.filter((e) => e.tipo === 'texto').map((e) => e.texto).join('');
    assert.match(texto, /modelo haiku/);
    assert.equal((texto.match(/Hecho\./g) || []).length, 1, 'no duplica el texto final');
    const fin = ev.at(-1);
    assert.equal(fin.tipo, 'fin');
    assert.equal(fin.coste, 0.0123);
    assert.equal(fin.sesion, 'sesion-falsa-1');
  });

  test('errores claros: fallo de Claude, sin sesión iniciada y CLI no instalado', async () => {
    const run = async (prompt, bin = FALSO) => {
      const ev = [];
      await ejecutar({ prompt, cwd: os.tmpdir(), bin, onEvento: (e) => ev.push(e) }).terminado;
      return ev.at(-1);
    };
    assert.equal((await run('FALLA')).mensaje, 'Algo salió mal');
    assert.match((await run('SINLOGIN')).mensaje, /sesión iniciada/);
    if (process.platform !== 'win32') assert.match((await run('hola', '/no/existe/claude')).mensaje, /No encuentro Claude Code/);
  });

  test('no hereda la sesión de otro Claude Code (si JARVIS se arranca desde uno)', () => {
    const env = entornoLimpio({ CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'x', CLAUDE_CODE_ENTRYPOINT: 'cli', PATH: '/bin', ELEVENLABS_API_KEY: 'k' });
    assert.deepEqual(Object.keys(env).sort(), ['ELEVENLABS_API_KEY', 'PATH']);
  });

  test('se puede cancelar', async () => {
    const ev = [];
    const r = ejecutarFalso({ prompt: 'LENTO', cwd: os.tmpdir(), onEvento: (e) => ev.push(e) });
    setTimeout(r.cancelar, 300);
    const t0 = Date.now();
    await r.terminado;
    assert.ok(Date.now() - t0 < 3000);
    assert.equal(ev.at(-1).tipo, 'error');
  });
});

describe('asistente', () => {
  let dir, asistente, jarvis, db;
  const emitidos = [];
  before(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-asis-'));
    const cfg = getConfig({});
    const v = path.join(dir, 'V');
    ensureVault(v, cfg.templateDir, cfg.mcpScript);
    db = openDb(':memory:');
    jarvis = createJarvis({ db, vault: createVault(v) });
    asistente = createAsistente({ db, jarvis, vaultPath: v, emitir: (e) => emitidos.push(e), ejecutarImpl: ejecutarFalso });
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  const esperarFin = () => new Promise((ok) => {
    const t = setInterval(() => { if (!asistente.estado().ocupado) { clearInterval(t); ok(); } }, 20);
  });

  test('pregunta → enruta, responde, registra actividad y retoma la sesión', async () => {
    const r = asistente.preguntar({ texto: 'Escríbeme un guion sobre IA', canal: 'voz' });
    assert.equal(r.modelo, 'sonnet');
    assert.throws(() => asistente.preguntar({ texto: 'otra' }), OcupadoError);
    await esperarFin();
    assert.equal(asistente.estado().sesion, 'sesion-falsa-1');
    assert.ok(emitidos.some((e) => e.type === 'jarvis' && e.tipo === 'fin'));
    assert.ok(jarvis.inicio().actividad.some((a) => a.texto.startsWith('JARVIS (Claude Sonnet)')));

    asistente.preguntar({ texto: 'Y ahora un gancho' });
    await esperarFin();
    const fin = asistente.estado().eventos.filter((e) => e.tipo === 'texto').map((e) => e.texto).join('');
    assert.match(fin, /sesión retomada/);
  });

  test('estadísticas de enrutamiento', () => {
    const e = asistente.enrutamiento();
    assert.equal(e.total, 2);
    assert.equal(e.barras.find((b) => b.label === 'Claude Sonnet').pct, 100);
    assert.equal(e.barras.find((b) => b.label === 'Por voz').pct, 50);
    assert.equal(e.coste, 0.02);
  });

  test('nueva sesión borra el contexto', () => {
    asistente.nuevaSesion();
    assert.equal(asistente.estado().sesion, null);
    assert.throws(() => asistente.preguntar({ texto: '  ' }), /Falta/);
  });
});

describe('voz (ElevenLabs)', () => {
  test('limpia el Markdown antes de leerlo', () => {
    const t = textoParaVoz('## Guion\n\n**Gancho:** deja de hacer *esto*.\n\n- Punto uno\n- Punto dos\n\n```js\ncodigo()\n```\nMira https://x.com');
    assert.equal(t, 'Guion. Gancho: deja de hacer esto. Punto uno Punto dos. Mira');
    const largo = textoParaVoz('Frase corta. '.repeat(200), 100);
    assert.ok(largo.length <= 100 && largo.endsWith('.'));
  });

  test('llama a ElevenLabs con la clave en cabecera y devuelve audio', async () => {
    let llamada;
    const fetchImpl = async (url, opts) => { llamada = { url, opts }; return new Response(new Uint8Array([1, 2, 3]), { status: 200 }); };
    const audio = await sintetizar('Hola **mundo**', { env: { ELEVENLABS_API_KEY: 'k', ELEVENLABS_VOICE_ID: 'voz1' }, fetchImpl });
    assert.equal(audio.length, 3);
    assert.match(llamada.url, /text-to-speech\/voz1\/stream/);
    assert.equal(llamada.opts.headers['xi-api-key'], 'k');
    const body = JSON.parse(llamada.opts.body);
    assert.equal(body.text, 'Hola mundo');
    assert.equal(body.language_code, 'es');
  });

  test('sin configurar o con clave mala da errores claros', async () => {
    await assert.rejects(sintetizar('hola', { env: {} }), /no está configurado/);
    const fetchImpl = async () => new Response('nope', { status: 401 });
    await assert.rejects(sintetizar('hola', { env: { ELEVENLABS_API_KEY: 'k', ELEVENLABS_VOICE_ID: 'v' }, fetchImpl }), /no es válida/);
  });
});
