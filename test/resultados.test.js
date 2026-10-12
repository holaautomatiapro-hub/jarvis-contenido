import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createVault, ensureVault } from '../server/vault.js';
import { createJarvis, hoy } from '../server/jarvis.js';
import { getConfig } from '../server/config.js';
import { lunesDe, sumarDias } from '../server/tareas.js';
import { createResultados, textoComparable } from '../server/resultados.js';

let dir, db, jarvis, res;
const ins = (m) => db.prepare(`INSERT INTO ig_media (id, formato, caption, permalink, fecha, alcance, views, likes, comentarios, guardados, compartidos, interacciones, gancho)
  VALUES (@id, @formato, @caption, @permalink, @fecha, @alcance, @views, 0, 0, @guardados, @compartidos, @interacciones, @gancho)`)
  .run({ formato: 'Reels', caption: null, permalink: null, views: null, guardados: 0, compartidos: 0, interacciones: 0, gancho: null, ...m });
const dia = (n) => sumarDias(hoy(), n);
const alMediodia = (f) => `${f}T12:00:00+0000`;

before(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-res-'));
  const cfg = getConfig({});
  ensureVault(path.join(dir, 'V'), cfg.templateDir, cfg.mcpScript);
  db = openDb(':memory:');
  jarvis = createJarvis({ db, vault: createVault(path.join(dir, 'V')) });
  res = createResultados({ db, jarvis, vault: jarvis.vault });
});
after(() => rmSync(dir, { recursive: true, force: true }));

describe('unir piezas con sus publicaciones', () => {
  test('texto comparable: sin negritas de Instagram, tildes ni emojis', () => {
    assert.equal(textoComparable('𝗚𝗨𝗜́𝗔 del **setter** 👇'), 'guia del setter');
  });

  test('por enlace, por caption (aunque lleve negritas) y por día y formato si no hay duda', () => {
    ins({ id: 'm1', permalink: 'https://www.instagram.com/reel/AAA/', fecha: alMediodia(dia(-3)), alcance: 1000 });
    ins({ id: 'm2', caption: 'Nadie te cuenta esto de los 𝘀𝗲𝘁𝘁𝗲𝗿𝘀 y por eso fallan 👇', fecha: alMediodia(dia(-2)), alcance: 3000, guardados: 60, compartidos: 30, interacciones: 300 });
    ins({ id: 'm3', formato: 'Carruseles', fecha: alMediodia(dia(-1)), alcance: 500 });
    const a = jarvis.crearPieza({ titulo: 'Por enlace', formato: 'Reel', estado: 'listo', video_url: 'https://instagram.com/reel/AAA?igsh=x' });
    const b = jarvis.crearPieza({ titulo: 'Por caption', formato: 'Reel', estado: 'editar', fecha: dia(-2), caption: 'Nadie te cuenta esto de los **setters** y por eso fallan' });
    const c = jarvis.crearPieza({ titulo: 'Por fecha', formato: 'Carrusel', estado: 'listo', fecha: dia(-1) });
    const idea = jarvis.crearPieza({ titulo: 'Una idea', estado: 'idea', fecha: dia(-1), formato: 'Carrusel' });
    assert.equal(res.vincularTodo().vinculadas, 3);
    const p = (x) => jarvis.leerPieza(x.id);
    assert.deepEqual([p(a).ig_media_id, p(a).ig_vinculo, p(a).estado], ['m1', 'enlace', 'publicado']);
    assert.equal(p(a).fecha, dia(-3), 'sin día: toma el de Instagram');
    assert.deepEqual([p(b).ig_media_id, p(b).ig_vinculo, p(b).estado], ['m2', 'caption', 'publicado']);
    assert.deepEqual([p(c).ig_media_id, p(c).ig_vinculo], ['m3', 'fecha']);
    assert.equal(p(idea).ig_media_id, null, 'las ideas no se unen por fecha');
    assert.equal(res.vincularTodo().vinculadas, 0, 'no repite');
  });

  test('si hay dos piezas posibles para un día, no adivina', () => {
    ins({ id: 'm4', fecha: alMediodia(dia(-5)), alcance: 800 });
    const x = jarvis.crearPieza({ titulo: 'Reel A', formato: 'Reel', estado: 'listo', fecha: dia(-5) });
    const y = jarvis.crearPieza({ titulo: 'Reel B', formato: 'Reel', estado: 'listo', fecha: dia(-5) });
    res.vincularTodo();
    assert.equal(jarvis.leerPieza(x.id).ig_media_id, null);
    assert.equal(jarvis.leerPieza(y.id).ig_media_id, null);
    // A mano sí, y la misma publicación no puede ir a dos piezas
    assert.ok(res.candidatas(x.id).some((m) => m.id === 'm4'));
    assert.equal(res.vincular(x.id, 'm4').ig_vinculo, 'manual');
    assert.throws(() => res.vincular(y.id, 'm4'), /ya está unida a «Reel A»/);
    assert.equal(res.candidatas(y.id).find((m) => m.id === 'm4').usada, true);
    // Soltada a mano: no se vuelve a unir sola
    assert.equal(res.vincular(x.id, null).ig_vinculo, 'ninguna');
    res.vincularTodo();
    assert.equal(jarvis.leerPieza(x.id).ig_media_id, null);
    jarvis.borrarPieza(x.id); jarvis.borrarPieza(y.id);
  });

  test('las que publicó JARVIS ya llevan su id', () => {
    ins({ id: 'm5', fecha: alMediodia(dia(-4)), alcance: 2000 });
    const p = jarvis.crearPieza({ titulo: 'Publicada por JARVIS', formato: 'Reel', estado: 'publicado', fecha: dia(-4) });
    db.prepare("UPDATE piezas SET ig_media_id = 'm5', ig_estado = 'publicado' WHERE id = ?").run(p.id);
    res.vincularTodo();
    assert.equal(jarvis.leerPieza(p.id).ig_vinculo, 'jarvis');
  });
});

describe('métricas y qué funciona', () => {
  test('las métricas de una pieza frente a la media de su formato', () => {
    const b = jarvis.listarPiezas().find((p) => p.titulo === 'Por caption');
    const r = res.deLaPieza(b.id);
    assert.equal(r.metricas.alcance, 3000);
    assert.equal(r.metricas.valor, 30, '(60 + 30) / 3000 × 1000');
    assert.ok(r.comparado.alcance > 0, 'por encima de la media de los reels');
    assert.equal(res.porPieza()[b.id].alcance, 3000);
    const sin = jarvis.crearPieza({ titulo: 'Sin publicar', estado: 'listo' });
    assert.equal(res.deLaPieza(sin.id).metricas, null);
    jarvis.borrarPieza(sin.id);
  });

  test('qué funciona: por pilar con conclusiones solo si hay 3 piezas o más', () => {
    const crear = (n, pilar, alcance) => {
      ins({ id: `p${n}`, fecha: alMediodia(dia(-10 - n)), alcance, guardados: pilar === 'Casos' ? 40 : 2, compartidos: 0, interacciones: 50 });
      const p = jarvis.crearPieza({ titulo: `${pilar} ${n}`, formato: 'Reel', estado: 'publicado', pilar, objetivo: pilar === 'Casos' ? 'convertir' : 'atraer', gancho: `Gancho ${n}`, cta: 'Comenta GUÍA' });
      res.vincular(p.id, `p${n}`);
    };
    [1, 2, 3].forEach((n) => crear(n, 'Casos', 4000));
    [4, 5, 6].forEach((n) => crear(n, 'Opinión', 300));
    crear(7, 'Tutoriales', 9000);
    const f = res.queFunciona({ dias: 90 });
    assert.equal(f.porPilar[0].clave, 'Casos', 'los grupos con pocas piezas van al final');
    assert.equal(f.porPilar.find((g) => g.clave === 'Tutoriales').pocas, true);
    assert.ok(f.conclusiones.some((c) => /pilar «Casos» llega a un \d+ % más/.test(c)));
    assert.ok(f.conclusiones.some((c) => /pilar «Opinión» se queda un \d+ % por debajo/.test(c)));
    assert.ok(!f.conclusiones.some((c) => c.includes('Tutoriales')), 'una sola pieza no es una conclusión');
    assert.equal(f.mejoresGanchos[0].gancho, 'Gancho 7');
    assert.equal(f.porCta[0].clave, 'Comenta GUÍA');
    assert.ok(f.cobertura.conPieza >= 7 && f.cobertura.conPilar === 7);
  });
});

describe('informe semanal', () => {
  test('se escribe en 07-Diario con números, lo mejor y lo que viene', () => {
    const r = res.informeSemanal({ fecha: dia(-3) });
    assert.match(r.nota, /^07-Diario\/Informe semana \d{4}-\d{2}-\d{2}\.md$/);
    const md = jarvis.vault.read(r.nota).contenido;
    assert.match(md, /# Informe de la semana del/);
    assert.match(md, /## Números/);
    assert.match(md, /## Qué te funciona/);
    assert.match(md, /## Esta semana \(desde el/);
    assert.equal(r.lunes, lunesDe(dia(-3)));
  });

  test('solo, una vez por semana y solo si hay algo que contar', () => {
    db.prepare("DELETE FROM ajustes WHERE clave = 'informe_semanal'").run();
    const r1 = res.alDia();
    const pasada = sumarDias(lunesDe(hoy()), -7);
    const hubo = jarvis.listarPiezas({ estado: 'publicado' }).some((p) => p.fecha >= pasada && p.fecha <= sumarDias(pasada, 6));
    if (hubo) assert.ok(r1.informe);
    assert.equal(res.alDia().informe, null, 'la segunda vez no lo repite');
  });
});
