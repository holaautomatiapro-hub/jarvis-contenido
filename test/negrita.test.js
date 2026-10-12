import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aNegrita, quitarNegrita, esNegrita, alternarNegrita, markdownANegrita } from '../web/src/lib/negrita.js';

test('negrita de Instagram (Unicode) con tildes y ñ', () => {
  const b = aNegrita('Guía Ñandú 2026!');
  assert.equal(b, '𝗚𝘂𝗶́𝗮 𝗡̃𝗮𝗻𝗱𝘂́ 𝟮𝟬𝟮𝟲!');
  assert.ok(esNegrita(b));
  assert.ok(!esNegrita('Guía'));
  assert.ok(!esNegrita('!!'));
  assert.equal(quitarNegrita(b), 'Guía Ñandú 2026!');
  assert.equal(alternarNegrita(alternarNegrita('Comenta SETTER')), 'Comenta SETTER');
  assert.ok(!esNegrita(`${aNegrita('mitad')} normal`), 'si hay algo sin negrita, B la pone');
});

test('**markdown** → negrita al publicar', () => {
  assert.equal(markdownANegrita('Comenta **SETTER** y te lo envío 👇'), 'Comenta 𝗦𝗘𝗧𝗧𝗘𝗥 y te lo envío 👇');
  assert.equal(markdownANegrita('2 ** 3 y **sin cerrar'), '2 ** 3 y **sin cerrar');
  assert.equal(markdownANegrita(null), null);
  assert.equal(markdownANegrita(''), '');
});
