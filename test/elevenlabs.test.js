import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { errorElevenLabs, transcribir } from '../server/stt.js';
import { sintetizar } from '../server/tts.js';
import { vigilarEnv } from '../server/env-archivo.js';

const detalle = (status, message) => JSON.stringify({ detail: { status, message } });

test('ElevenLabs: el 401 dice el motivo de verdad (permiso, créditos o clave mal)', async () => {
  assert.match(errorElevenLabs(401, detalle('missing_permissions', 'The API key you used is missing the permission speech_to_text')), /no tiene permiso de «Speech to Text»/);
  assert.match(errorElevenLabs(401, detalle('quota_exceeded', 'This request exceeds your quota')), /créditos/);
  assert.match(errorElevenLabs(401, detalle('invalid_api_key', 'Invalid API key')), /no es válida/);
  assert.match(errorElevenLabs(401, 'nope'), /no es válida/);
  assert.match(errorElevenLabs(422, detalle('invalid_file', 'Bad file'), { que: 'transcripción' }), /ElevenLabs \(transcripción\) respondió 422: Bad file/);
  const env = { ELEVENLABS_API_KEY: 'k', ELEVENLABS_VOICE_ID: 'v' };
  const sinPermiso = async () => new Response(detalle('missing_permissions', 'missing text_to_speech'), { status: 401 });
  await assert.rejects(transcribir(Buffer.from('x'), { env, fetchImpl: sinPermiso }), /Speech to Text/);
  await assert.rejects(sintetizar('hola', { env, fetchImpl: sinPermiso }), /Text to Speech/);
});

test('ElevenLabs devuelve también el tiempo de cada palabra (para subtítulos)', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ text: 'Hola Miguel', words: [{ text: 'Hola', start: 0.1, end: 0.4, type: 'word' }, { text: ' ', start: 0.4, end: 0.5, type: 'spacing' }, { text: 'Miguel', start: 0.5, end: 0.9, type: 'word' }] }), { status: 200 });
  let palabras;
  const texto = await transcribir(Buffer.from('x'), { env: { ELEVENLABS_API_KEY: 'k' }, fetchImpl, alPalabras: (l) => { palabras = l; } });
  assert.equal(texto, 'Hola Miguel');
  assert.deepEqual(palabras, [[0.1, 0.4, 'Hola'], [0.5, 0.9, 'Miguel']]);
});

test('las claves nuevas del .env se usan sin reiniciar', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-env-'));
  try {
    const ruta = path.join(dir, '.env');
    writeFileSync(ruta, 'ELEVENLABS_API_KEY=vieja\n');
    const env = { ELEVENLABS_API_KEY: 'vieja', PORT: '3333' };
    const avisos = [];
    const parar = vigilarEnv(ruta, { env, cada: 50, alCambiar: (c) => avisos.push(c) });
    writeFileSync(ruta, '# claves\nELEVENLABS_API_KEY=nueva\nMETA_APP_ID=123\n');
    assert.deepEqual(parar.aplicar(), ['ELEVENLABS_API_KEY', 'META_APP_ID']);
    assert.equal(env.ELEVENLABS_API_KEY, 'nueva');
    assert.equal(env.PORT, '3333', 'lo que no está en el .env no se toca');
    assert.deepEqual(parar.aplicar(), [], 'sin cambios, nada');
    assert.deepEqual(avisos, [['ELEVENLABS_API_KEY', 'META_APP_ID']]);
    parar();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
