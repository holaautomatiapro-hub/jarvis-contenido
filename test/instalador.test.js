import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import dotenv from 'dotenv';
import { leerEnv, actualizarEnv } from '../server/env-archivo.js';
import { revisar } from '../server/doctor.js';
import { pedirClaves, enmascarar } from '../scripts/claves.js';
import { ROOT } from '../server/config.js';

describe('.env', () => {
  test('cambia valores en su sitio, conserva comentarios y CRLF, y añade lo nuevo al final', () => {
    const antes = '# Voz\r\nELEVENLABS_API_KEY=\r\nPORT=3333\r\n';
    const t = actualizarEnv(antes, { ELEVENLABS_API_KEY: 'sk_1', NUEVA: 'x' });
    assert.equal(t, '# Voz\r\nELEVENLABS_API_KEY=sk_1\r\nPORT=3333\r\nNUEVA=x\r\n');
  });

  test('rutas de Windows con espacios y tildes, y valores con #, se leen igual que dotenv', () => {
    const valores = { VAULT_PATH: 'C:\\Users\\Ana María\\OneDrive\\Documentos\\JARVIS-Vault', CLAVE: 'abc#123', OTRA: "it's" };
    const t = actualizarEnv('', valores);
    assert.deepEqual(dotenv.parse(t), valores);
    assert.deepEqual(leerEnv(t), valores);
    assert.equal(leerEnv('A=hola # comentario\nB="con # dentro"').A, 'hola');
    assert.equal(leerEnv('B="con # dentro"').B, 'con # dentro');
  });
});

function instalacionFalsa({ env = '', vault = true, deps = true, web = true } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'jarvis-inst-'));
  if (deps) mkdirSync(path.join(root, 'node_modules', 'express'), { recursive: true });
  if (web) { mkdirSync(path.join(root, 'web', 'dist'), { recursive: true }); writeFileSync(path.join(root, 'web', 'dist', 'index.html'), ''); }
  const v = path.join(root, 'Vault');
  if (vault) { mkdirSync(v); writeFileSync(path.join(v, 'CLAUDE.md'), '# JARVIS'); }
  writeFileSync(path.join(root, '.env'), `VAULT_PATH=${v}\nPORT=39999\n${env}`);
  return { root, envPath: path.join(root, '.env') };
}
const sinRed = async () => { throw new Error('sin red'); };
const base = { claude: async () => '2.1.0 (Claude Code)', fetchImpl: sinRed, procesoEnv: { HERMES_HOME: path.join(os.tmpdir(), 'no-hay-hermes') }, plataforma: 'linux' };

describe('doctor', () => {
  test('instalación completa sin claves: lo esencial listo y lo opcional como aviso', async () => {
    const r = await revisar({ ...instalacionFalsa(), ...base, nodeVersion: '22.12.0' });
    assert.equal(r.listo, true);
    const t = Object.fromEntries(r.revisiones.map((x) => [x.titulo.split(' (')[0].split(' en ')[0], x.estado]));
    assert.equal(t['Claude Code'], 'ok');
    assert.equal(t['Voz de ElevenLabs'], 'aviso');
    assert.equal(t['Dashboard'], 'aviso', 'no arrancado no es un error');
    assert.equal(t['Hermes'], 'aviso');
    assert.ok(r.revisiones.filter((x) => x.estado !== 'ok').every((x) => x.arreglo), 'todo lo que falta dice cómo arreglarlo');
  });

  test('Node antiguo, sin Claude Code o sin vault: no está listo', async () => {
    assert.equal((await revisar({ ...instalacionFalsa(), ...base, nodeVersion: '20.11.0' })).listo, false);
    assert.equal((await revisar({ ...instalacionFalsa(), ...base, nodeVersion: '22.4.0' })).listo, false, 'node:sqlite necesita 22.5');
    assert.equal((await revisar({ ...instalacionFalsa(), ...base, claude: async () => null, nodeVersion: '22.12.0' })).listo, false);
    const r = await revisar({ ...instalacionFalsa({ vault: false }), ...base, nodeVersion: '24.0.0' });
    assert.equal(r.listo, false);
    assert.match(r.revisiones.find((x) => x.titulo === 'Vault de Obsidian').detalle, /No existe/);
  });

  test('con claves, dashboard en marcha y arranque en Windows', async () => {
    const appdata = mkdtempSync(path.join(os.tmpdir(), 'appdata-'));
    const inicio = path.join(appdata, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
    mkdirSync(inicio, { recursive: true });
    writeFileSync(path.join(inicio, 'JARVIS.vbs'), "' JARVIS");
    const fetchImpl = async (url) => { assert.match(url, /:39999\/api\/health$/); return { ok: true, json: async () => ({ name: 'JARVIS' }) }; };
    const r = await revisar({ ...instalacionFalsa({ env: 'ELEVENLABS_API_KEY=sk\nELEVENLABS_VOICE_ID=v1\n' }), ...base, fetchImpl, plataforma: 'win32', procesoEnv: { ...base.procesoEnv, APPDATA: appdata }, conexiones: async () => ({ instagram: true, ads: true }), nodeVersion: '22.12.0' });
    const estado = (t) => r.revisiones.find((x) => x.titulo.startsWith(t)).estado;
    for (const t of ['Dashboard', 'Arranca solo', 'Voz de ElevenLabs', 'Instagram conectado', 'Meta Ads']) assert.equal(estado(t), 'ok', t);
  });
});

describe('npm run claves', () => {
  const respuestas = (lista) => { const q = [...lista]; const vistas = []; return { vistas, preguntar: async (texto, secreto) => { vistas.push({ texto, secreto }); return q.shift() ?? ''; } }; };

  test('valida, normaliza, Enter deja lo que hay y "-" borra', async () => {
    const { preguntar, vistas } = respuestas(['', '', '123', '1234567', 'malo', '', '', '98765', '@marcauno, @marcados ,']);
    const cambios = await pedirClaves({ actuales: { ELEVENLABS_VOICE_ID: 'v-actual' }, preguntar, decir: () => {}, fetchImpl: sinRed });
    assert.deepEqual(cambios, { META_APP_ID: '1234567', META_AD_ACCOUNT_ID: 'act_98765', COMPETIDORES: 'marcauno,marcados' });
    assert.equal(vistas.find((v) => v.texto.includes('ELEVENLABS_API_KEY')).secreto, true);
    assert.equal(vistas.find((v) => v.texto.includes('META_APP_SECRET')).secreto, true);
    assert.equal(vistas.find((v) => v.texto.includes('META_APP_ID')).secreto, false);

    const borrar = await pedirClaves({ actuales: { COMPETIDORES: 'a' }, preguntar: respuestas(['', '', '', '', '', '', '-']).preguntar, decir: () => {}, fetchImpl: sinRed });
    assert.deepEqual(borrar, { COMPETIDORES: '' });
  });

  test('con la clave de ElevenLabs enseña tus voces y eliges por número', async () => {
    const fetchImpl = async (url, o) => {
      assert.equal(o.headers['xi-api-key'], 'sk_nueva');
      return { ok: true, json: async () => ({ voices: [{ voice_id: 'id-a', name: 'Lucía', category: 'cloned' }, { voice_id: 'id-b', name: 'Mateo' }] }) };
    };
    const dicho = [];
    const cambios = await pedirClaves({ actuales: {}, preguntar: respuestas(['sk_nueva', '2']).preguntar, decir: (t) => dicho.push(t), fetchImpl });
    assert.equal(cambios.ELEVENLABS_VOICE_ID, 'id-b');
    assert.ok(dicho.some((t) => /1\. Lucía \(cloned\)/.test(t)));
    assert.doesNotMatch(dicho.join('\n'), /sk_nueva/, 'nunca escribe la clave en pantalla');
  });

  test('un voice ID con otro formato (p. ej. un token pegado por error) no se guarda', async () => {
    const dicho = [];
    const cambios = await pedirClaves({ actuales: {}, preguntar: respuestas(['', '74d74c5ced31918a0ff30b127a4c1ed2289155ba7acf97ed5fb38890af6b7988', 'dNjJKg63Fr5AXwIdkATa']).preguntar, decir: (t) => dicho.push(t), fetchImpl: sinRed });
    assert.equal(cambios.ELEVENLABS_VOICE_ID, 'dNjJKg63Fr5AXwIdkATa');
    assert.ok(dicho.some((t) => /20 letras y números/.test(t)));
  });

  test('las claves secretas se enseñan enmascaradas', () => {
    assert.equal(enmascarar('sk_abcdef1234', true), '••••1234');
    assert.equal(enmascarar('', true), '(vacío)');
    assert.equal(enmascarar('marcauno', false), 'marcauno');
  });
});

test('instalar.ps1 se guarda en UTF-8 con BOM y CRLF (si no, Windows PowerShell 5.1 rompe las tildes)', () => {
  const b = readFileSync(path.join(ROOT, 'instalar.ps1'));
  assert.deepEqual([...b.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const t = b.toString('utf8');
  assert.ok(!/[^\r]\n/.test(t), 'todas las líneas en CRLF');
  assert.match(readFileSync(path.join(ROOT, '.gitattributes'), 'utf8'), /\*\.ps1 text eol=crlf/);
  // Nada que los antivirus marquen como malware: ni descargar y ejecutar código (irm | iex) ni scripts ocultos en Inicio
  assert.doesNotMatch(t, /Invoke-Expression|\|\s*iex\b|\biex\s*\(|wscript\.exe|\.vbs['"]\s*-Encoding|Set-Content[^\n]*\.vbs/i);
  // Sintaxis que no existe en PowerShell 5.1
  assert.doesNotMatch(t, /\?\?|\?\.|\s&&\s|\s\|\|\s/);
});

