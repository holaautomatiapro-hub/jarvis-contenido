import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createVault } from '../server/vault.js';
import { createJarvis } from '../server/jarvis.js';
import { createArchivos } from '../server/archivos.js';
import { crearZip } from '../server/diseno/zip.js';
import { createLaboratorio, elegirCaption } from '../server/laboratorio.js';
import { createAsistente } from '../server/asistente.js';
import { argumentos } from '../server/claude-runner.js';

let dir, lab, jarvis;
const flujo = (txt) => Readable.from([Buffer.from(txt)]);
// Un plugin mínimo con la forma del de testimonios, hecho en Windows (con una carpeta raíz)
const pluginZip = () => crearZip([
  { nombre: 'testimonios/.claude-plugin/plugin.json', contenido: Buffer.from(JSON.stringify({ name: 'testimonios', version: '1.0.0' })) },
  { nombre: 'testimonios/motor/montar.py', contenido: Buffer.from('print("montar")') },
  { nombre: 'testimonios/motor/marca.py', contenido: Buffer.from('print("OK     ffmpeg\\nFALTA  rembg   <- pip install rembg")') },
  { nombre: 'testimonios/skills/testimonio-completo/SKILL.md', contenido: Buffer.from('---\nname: testimonio-completo\n---\n') },
  { nombre: 'testimonios/skills/clips-reel/SKILL.md', contenido: Buffer.from('---\nname: clips-reel\n---\n') },
]);

before(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-lab-'));
  jarvis = createJarvis({ db: openDb(':memory:'), vault: createVault(path.join(dir, 'V')) });
  lab = createLaboratorio({ dir: path.join(dir, 'Lab'), archivos: createArchivos({ dir: path.join(dir, 'contenido') }), jarvis, env: { PATH: '/usr/bin' } });
});
after(() => rmSync(dir, { recursive: true, force: true }));

describe('Laboratorio', () => {
  test('sin plugin: lo dice y no deja empezar', () => {
    const e = lab.estado();
    assert.equal(e.plugin.instalado, false);
    assert.throws(() => lab.prompt('testimonio', {}), /importa el plugin/);
  });

  test('importa el plugin desde el .zip (privado, en la carpeta del Laboratorio) y guarda el anterior', () => {
    const e = lab.importarPlugin(pluginZip());
    assert.equal(e.plugin.instalado, true);
    assert.deepEqual(e.plugin.skills.sort(), ['clips-reel', 'testimonio-completo']);
    assert.ok(existsSync(path.join(lab.pluginDir, 'motor', 'montar.py')));
    lab.importarPlugin(pluginZip());
    assert.ok(existsSync(path.join(lab.dir, '.jarvis', 'plugins-anteriores')));
    assert.throws(() => lab.importarPlugin(crearZip([{ nombre: 'x/README.md', contenido: Buffer.from('x') }])), /no es el plugin de testimonios/);
    assert.throws(() => lab.importarPlugin(crearZip([{ nombre: 'p/motor/montar.py', contenido: Buffer.from('x') }])), /testimonio-completo/);
    assert.throws(() => lab.importarPlugin(crearZip([{ nombre: 'kit/kit.json', contenido: Buffer.from('{}') }])), /sistema de diseño/);
    assert.throws(() => lab.importarPlugin(crearZip([{ nombre: 'otra/cosa/a.txt', contenido: Buffer.from('x') }])), /Lleva: otra\/cosa/);
  });

  test('acepta el plugin recomprimido sin .claude-plugin y un .zip dentro de otro', () => {
    const sinManifiesto = crearZip([
      { nombre: 'testimonios/motor/montar.py', contenido: Buffer.from('x') },
      { nombre: 'testimonios/skills/testimonio-completo/SKILL.md', contenido: Buffer.from('x') },
    ]);
    assert.equal(lab.importarPlugin(sinManifiesto).plugin.instalado, true);
    assert.ok(existsSync(path.join(lab.pluginDir, '.claude-plugin', 'plugin.json')));
    const anidado = crearZip([{ nombre: 'testimonios-plugin.zip', contenido: pluginZip() }, { nombre: '__MACOSX/._x', contenido: Buffer.from('x') }]);
    assert.deepEqual(lab.importarPlugin(anidado).plugin.skills.sort(), ['clips-reel', 'testimonio-completo']);
  });

  test('sube la entrevista a crudo/ y la foto a fotos/<cliente>/, sin pisar ni salirse', async () => {
    const a = await lab.subir(flujo('video'), { tipo: 'entrevista', nombre: 'Entrevista María.mp4' });
    assert.equal(a.ruta, 'crudo/Entrevista_Maria.mp4');
    const b = await lab.subir(flujo('video2'), { tipo: 'entrevista', nombre: 'Entrevista María.mp4' });
    assert.equal(b.ruta, 'crudo/Entrevista_Maria-2.mp4');
    const f = await lab.subir(flujo('jpg'), { tipo: 'foto', nombre: 'foto.jpg', cliente: 'María López' });
    assert.equal(f.ruta, 'fotos/Maria_Lopez/foto.jpg');
    await assert.rejects(() => lab.subir(flujo('x'), { tipo: 'entrevista', nombre: 'notas.txt' }), /Sube un vídeo/);
    await assert.rejects(() => lab.subir(flujo(''), { tipo: 'foto', nombre: 'vacia.png', cliente: 'x' }), /vacío/);
  });

  test('resultados: testimonios (stories, carrusel, clips, portadas, captions) y reels', () => {
    const w = (rel, txt = 'x') => { const f = path.join(lab.dir, rel); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, txt); };
    w('testimonios/Maria Lopez/stories/slide-01.mp4'); w('testimonios/Maria Lopez/stories/slide-02.mp4');
    w('testimonios/Maria Lopez/carrusel-video/slide-01.mp4'); w('testimonios/Maria Lopez/portada.jpg');
    w('testimonios/Maria Lopez/_caption.md', '## Versión dolor\nTexto');
    w('testimonios/Maria Lopez/_proyecto/index.html');
    w('clips/Maria Lopez/reel-9x16/01-antes-y-ahora.mp4'); w('clips/Maria Lopez/youtube/entrevista-completa.mp4');
    w('clips/Maria Lopez/entrevistador/reel-9x16/01-explica.mp4');
    w('reels/Mi reel/pantalla/01-gancho.mp4'); w('reels/Mi reel/_preview-pantalla.jpg');
    const r = lab.resultados();
    assert.equal(r.testimonios.length, 1);
    const m = r.testimonios[0];
    assert.equal(m.cliente, 'Maria Lopez');
    assert.deepEqual(m.grupos.map((g) => [g.nombre, g.archivos.length]), [
      ['Stories', 2], ['Carrusel en vídeo', 1], ['Clips en reel · entrevistador', 1], ['Clips en reel', 1], ['YouTube', 1],
    ]);
    assert.deepEqual(m.portadas.map((p) => p.ruta), ['testimonios/Maria Lopez/portada.jpg']);
    assert.equal(lab.texto(m.caption).texto.split('\n')[0], '## Versión dolor');
    assert.equal(r.reels[0].nombre, 'Mi reel');
    assert.equal(r.reels[0].previas[0].nombre, '_preview-pantalla.jpg');
    assert.deepEqual(r.entrevistas.map((e) => e.nombre), ['Entrevista_Maria-2.mp4', 'Entrevista_Maria.mp4']);
  });

  test('solo se sirven archivos de las carpetas visibles', () => {
    assert.equal(lab.archivo('reels/Mi reel/pantalla/01-gancho.mp4').mime, 'video/mp4');
    assert.throws(() => lab.archivo('../V/secreto.md'), /fuera/);
    assert.throws(() => lab.archivo('.jarvis/plugin/motor/montar.py'), /no permitida/);
    assert.throws(() => lab.archivo('fichas/clips/x.json'), /no permitida/);
    assert.throws(() => lab.texto('reels/Mi reel/pantalla/01-gancho.mp4'), /\.md/);
    assert.throws(() => lab.borrar('marca/marca.json'), /no se puede borrar/);
  });

  test('a la biblioteca: copia los vídeos y crea una pieza en Listo', async () => {
    const p = await lab.aBiblioteca({ rutas: ['testimonios/Maria Lopez/carrusel-video/slide-01.mp4', 'testimonios/Maria Lopez/portada.jpg'], titulo: 'Testimonio María', formato: 'Carrusel', caption: 'Hola' });
    assert.equal(p.estado, 'listo');
    assert.equal(p.formato, 'Carrusel');
    assert.equal(p.archivos.length, 2);
    assert.equal(p.caption, 'Hola');
    assert.equal(p.carpeta, 'Testimonios/Maria Lopez');
    assert.match(p.origen_ref, /^laboratorio:testimonios\/Maria Lopez\/carrusel-video\/slide-01\.mp4 \(\+1\)$/);
  });

  test('a la biblioteca: sin caption usa el de _caption.md, no duplica y marca lo ya enviado', async () => {
    const rel = 'clips/Maria Lopez/reel-9x16/01-antes-y-ahora.mp4';
    const p = await lab.aBiblioteca({ rutas: [rel], titulo: 'Clip María', formato: 'Reel' });
    assert.equal(p.caption, 'Texto', 'la primera versión de testimonios/<cliente>/_caption.md');
    assert.equal(p.carpeta, 'Testimonios/Maria Lopez');
    const otra = await lab.aBiblioteca({ rutas: [rel], titulo: 'Clip María' });
    assert.equal(otra.id, p.id);
    assert.equal(otra.yaEstaba, true);
    const clips = lab.resultados().testimonios[0].grupos.find((g) => g.nombre === 'Clips en reel');
    assert.equal(clips.archivos[0].enBiblioteca, true);
  });

  test('elegir el caption de cada archivo entre varias versiones', () => {
    const md = 'Intro\n## Clip 1 · antes y ahora\nCaption del uno\n\n## Clip 2 · el gancho\nCaption del dos\n';
    assert.equal(elegirCaption(md, 'reels/x/pantalla/02-el-gancho.mp4'), 'Caption del dos');
    assert.equal(elegirCaption(md, 'reels/x/pantalla/09-otro.mp4'), 'Caption del uno');
    assert.equal(elegirCaption('Solo un texto', 'a.mp4'), 'Solo un texto');
    assert.equal(elegirCaption('', 'a.mp4'), null);
  });

  test('prompts: testimonio completo o solo algunas piezas, y reel', () => {
    const t = lab.prompt('testimonio', { cliente: 'María', entrevista: 'crudo/Entrevista_Maria.mp4', foto: 'fotos/Maria/foto.jpg', frase: 'He duplicado mis agendas' });
    assert.match(t, /testimonio-completo/);
    assert.match(t, /«He duplicado mis agendas»/);
    assert.match(t, /pregúntamelo/);
    const solo = lab.prompt('testimonio', { cliente: 'María', entrevista: 'crudo/x.mp4', piezas: ['reel', 'portada'] });
    assert.match(solo, /SOLO estas piezas: Clips en reel \(9:16\), Portada/);
    const r = lab.prompt('reel', { video: 'crudo/mi.mp4', nombre: 'Lanzamiento', clips: 2, duracion: 30, plantillas: ['pantalla', 'feed'] });
    assert.match(r, /2 clips con los MEJORES momentos, de unos 30 s/);
    assert.match(r, /fichas\/reels\/Lanzamiento\.json/);
    assert.match(r, /ESPERA mi visto bueno/);
    assert.throws(() => lab.prompt('reel', {}), /Sube el vídeo/);
  });

  test('configurar la marca: parte de lo que JARVIS ya sabe (sistema de diseño, voz y negocio)', () => {
    const v = path.join(dir, 'VaultMarca');
    mkdirSync(path.join(v, '_diseno'), { recursive: true });
    writeFileSync(path.join(v, '_diseno', 'kit.json'), '{}');
    writeFileSync(path.join(v, '_voz.md'), 'voz');
    const l2 = createLaboratorio({ dir: lab.dir, jarvis, vaultPath: v, env: { PATH: '/usr/bin' } });
    const p = l2.prompt('marca', {});
    assert.match(p, /configurar-marca/);
    assert.match(p, /YA ESTÁ en JARVIS/);
    assert.ok(p.includes(path.join(v, '_diseno')) && p.includes(path.join(v, '_voz.md')));
    assert.ok(!p.includes('CLAUDE.md:'), 'sin CLAUDE.md en el vault no lo cita');
    assert.match(l2.entorno().sistema, /Su vault/);
    assert.doesNotMatch(lab.prompt('marca', {}), /YA ESTÁ/, 'sin vault, la entrevista de siempre');
  });

  test('entorno de Claude: carpeta del Laboratorio, plugin y Bash solo para el montaje', () => {
    const e = lab.entorno();
    assert.equal(e.cwd, lab.dir);
    assert.deepEqual(e.pluginDirs, [lab.pluginDir]);
    assert.ok(e.herramientasExtra.includes('Bash(python:*)') && e.herramientasExtra.includes('Bash(ffmpeg:*)'));
    assert.ok(!e.herramientasExtra.some((h) => /rm|curl|pip|sudo/.test(h)));
    assert.equal(e.env.TESTIMONIOS_TRABAJO, lab.dir);
    const args = argumentos({ herramientasExtra: e.herramientasExtra, pluginDirs: e.pluginDirs });
    assert.ok(!args.includes('--disallowedTools'), 'con permisos de Bash no se prohíbe Bash entero');
    assert.deepEqual(args.slice(args.indexOf('--plugin-dir'), args.indexOf('--plugin-dir') + 2), ['--plugin-dir', lab.pluginDir]);
    assert.ok(argumentos({}).includes('--disallowedTools'), 'el resto de JARVIS sigue sin Bash');
    const conEsfuerzo = argumentos({ esfuerzo: 'high' });
    assert.equal(conEsfuerzo[conEsfuerzo.indexOf('--effort') + 1], 'high');
    assert.ok(!argumentos({}).includes('--effort'), 'sin esfuerzo, no se pasa la opción');
  });

  test('el Laboratorio va en su propio carril: no bloquea al resto de JARVIS', () => {
    const corriendo = [];
    const asistente = createAsistente({
      db: openDb(':memory:'), jarvis, vaultPath: path.join(dir, 'V'),
      entornos: { laboratorio: () => ({ cwd: lab.dir, env: { X: '1' }, pluginDirs: ['p'], herramientasExtra: ['Bash(python:*)'], sistema: 'extra' }) },
      ejecutarImpl: (o) => { corriendo.push(o); return { cancelar: () => {}, terminado: new Promise(() => {}) }; },
    });
    asistente.preguntar({ conversacion: 'laboratorio', texto: 'monta el testimonio' });
    assert.equal(corriendo[0].cwd, lab.dir);
    assert.deepEqual(corriendo[0].pluginDirs, ['p']);
    assert.match(corriendo[0].sistema, /LABORATORIO[\s\S]*extra/);
    assert.equal(asistente.estado({ conversacion: 'laboratorio' }).ocupadoAqui, true);
    assert.equal(asistente.estado().ocupado, false, 'el carril principal sigue libre');
    asistente.preguntar({ conversacion: 'principal', texto: 'hola' });
    assert.equal(corriendo[1].cwd, path.join(dir, 'V'));
    assert.equal(corriendo[1].pluginDirs, undefined);
    assert.throws(() => asistente.preguntar({ conversacion: 'laboratorio', texto: 'otra' }), /Laboratorio está terminando/);
  });
});
