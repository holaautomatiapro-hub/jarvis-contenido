import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createVault } from '../server/vault.js';
import { createJarvis } from '../server/jarvis.js';

const nuevo = () => createJarvis({ db: openDb(':memory:'), vault: createVault(mkdtempSync(path.join(os.tmpdir(), 'jarvis-pipe-'))) });
const sin = (fases) => fases.map(({ id, label, color, icon, ayuda }) => ({ id, label, color, icon, ayuda }));

describe('Pipeline configurable', () => {
  test('de serie: las seis fases de siempre', () => {
    const j = nuevo();
    assert.deepEqual(j.pipeline.ids(), ['idea', 'guion', 'grabar', 'editar', 'listo', 'publicado']);
    assert.deepEqual(j.pipeline.fases().filter((f) => f.sistema).map((f) => f.id), ['idea', 'listo', 'publicado']);
  });

  test('añadir, renombrar y ordenar (Idea primero y Publicado al final)', () => {
    const j = nuevo();
    const f = sin(j.pipeline.fases());
    f.find((x) => x.id === 'idea').label = 'Ideas sueltas';
    const r = j.pipeline.guardar([f[5], { label: 'Revisión cliente' }, ...f.slice(0, 5)]);
    assert.deepEqual(r.map((x) => x.id), ['idea', 'revision_cliente', 'guion', 'grabar', 'editar', 'listo', 'publicado']);
    assert.equal(r[0].label, 'Ideas sueltas');
    const p = j.crearPieza({ titulo: 'A revisar', estado: 'revision_cliente' });
    assert.equal(p.estado, 'revision_cliente');
    assert.throws(() => j.actualizarPieza(p.id, { estado: 'inventada' }), /Fase no válida/);
  });

  test('no deja borrar las del sistema ni perder piezas', () => {
    const j = nuevo();
    const f = sin(j.pipeline.fases());
    assert.throws(() => j.pipeline.guardar(f.filter((x) => x.id !== 'listo')), /del sistema/);
    const p = j.crearPieza({ titulo: 'Para grabar', estado: 'grabar' });
    const sinGrabar = f.filter((x) => x.id !== 'grabar');
    assert.throws(() => j.pipeline.guardar(sinGrabar), /tiene 1 pieza/);
    j.pipeline.guardar(sinGrabar, { mover: { grabar: 'editar' } });
    assert.equal(j.listarPiezas().find((x) => x.id === p.id).estado, 'editar');
    assert.equal(j.pipeline.existe('grabar'), false);
  });

  test('una fase nueva no reutiliza el id de otra', () => {
    const j = nuevo();
    const f = sin(j.pipeline.fases());
    const r = j.pipeline.guardar([...f.slice(0, 5), { label: 'Guion' }, f[5]]);
    assert.deepEqual(r.filter((x) => x.label === 'Guion').map((x) => x.id), ['guion', 'guion_2']);
    assert.throws(() => j.pipeline.guardar([...f, { id: 'guion', label: 'Otra' }]), /repetida/);
  });

  test('si borras «Editar», lo que la biblioteca crea en «Editar» va a la primera fase de trabajo', () => {
    const j = nuevo();
    const f = sin(j.pipeline.fases()).filter((x) => !['guion', 'grabar', 'editar'].includes(x.id));
    j.pipeline.guardar([f[0], { label: 'Producción' }, ...f.slice(1)]);
    assert.equal(j.crearPieza({ titulo: 'Vídeo subido', estado: 'editar' }).estado, 'produccion');
    assert.equal(j.resumenDelDia().fases.map((x) => x.nombre).join(','), 'Idea,Producción,Listo,Publicado');
  });
});
