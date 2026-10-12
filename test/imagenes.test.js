import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { Readable } from 'node:stream';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createVault } from '../server/vault.js';
import { createJarvis } from '../server/jarvis.js';
import { createLaboratorio } from '../server/laboratorio.js';
import { estadoDeSalida } from '../server/imagenes.js';
import { argumentos } from '../server/claude-runner.js';

let dir, lab, img, jarvis, comandos, salida;
const flujo = (txt) => Readable.from([Buffer.from(txt)]);

before(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-img-'));
  jarvis = createJarvis({ db: openDb(':memory:'), vault: createVault(path.join(dir, 'V')) });
  comandos = [];
  salida = 'No MCP server named "higgsfield". Run `claude mcp add` to add one.';
  lab = createLaboratorio({ dir: path.join(dir, 'Lab'), jarvis, env: { PATH: '/usr/bin' }, imagenesOpc: { cacheMs: 0, ejecutarComando: async (args) => { comandos.push(args.join(' ')); if (args[1] === 'add') salida = 'higgsfield:\n  Status: ⚠ Needs authentication\n  Type: http'; return { ok: true, salida }; } } });
  lab.iniciar();
  img = lab.imagenes;
});
after(() => rmSync(dir, { recursive: true, force: true }));

describe('Imágenes con Higgsfield', () => {
  test('lee el estado del conector como lo escribe claude mcp get', () => {
    assert.equal(estadoDeSalida(true, 'No MCP server named "higgsfield". Run `claude mcp add` to add one.').estado, 'sin-anadir');
    assert.deepEqual(estadoDeSalida(true, 'higgsfield:\n  Scope: User config\n  Status: ✓ Connected\n  Type: http'), { anadido: true, conectado: true, estado: 'conectado' });
    assert.equal(estadoDeSalida(true, 'higgsfield:\n  Status: ⚠ Needs authentication').estado, 'falta-login');
    const f = estadoDeSalida(true, 'higgsfield:\n  Status: × Failed to connect\n  Issue: ERR_PROXY_TUNNEL: 403');
    assert.equal(f.estado, 'fallo');
    assert.match(f.detalle, /ERR_PROXY_TUNNEL/);
    assert.equal(estadoDeSalida(false, 'command not found').anadido, false);
  });

  test('añade el conector a tu cuenta (una vez) y dice que falta iniciar sesión', async () => {
    assert.equal((await img.conector()).estado, 'sin-anadir');
    const c = await img.anadirConector();
    assert.ok(comandos.includes('mcp add --transport http --scope user higgsfield https://mcp.higgsfield.ai/mcp'));
    assert.equal(c.estado, 'falta-login');
    await img.anadirConector();
    assert.equal(comandos.filter((x) => x.startsWith('mcp add')).length, 1, 'no lo añade dos veces');
  });

  test('Claude del Laboratorio puede usar el conector', () => {
    const e = lab.entorno();
    assert.ok(e.herramientasExtra.includes('mcp__higgsfield'));
    assert.match(e.sistema, /higgsfield\.mjs/);
    const args = argumentos({ herramientasExtra: e.herramientasExtra });
    assert.ok(args.includes('mcp__higgsfield'));
  });

  test('referencias y fotos de tu cara se suben a su carpeta', async () => {
    const r = await lab.subir(flujo('jpg'), { tipo: 'referencia', nombre: 'producto.jpg' });
    assert.equal(r.ruta, 'imagenes/_referencias/producto.jpg');
    await assert.rejects(lab.subir(flujo('x'), { tipo: 'cara', nombre: 'cara.mp4' }), /fotos/);
    for (let i = 1; i <= 4; i++) await lab.subir(flujo('jpg'), { tipo: 'cara', nombre: `yo-${i}.jpg` });
    const e = await img.estado();
    assert.equal(e.fotosCara.length, 4);
    assert.equal(e.referencias[0].ruta, 'imagenes/_referencias/producto.jpg');
    assert.equal(e.personaje, null);
    assert.ok(lab.archivo('imagenes/_mi-cara/yo-1.jpg').abs);
  });

  test('entrenar tu cara pide al menos 5 fotos y explica cómo subirlas y guardar el personaje', async () => {
    assert.throws(() => img.entrenarCara({}), /al menos 5 fotos tuyas \(llevas 4\)/);
    await lab.subir(flujo('jpg'), { tipo: 'cara', nombre: 'yo-5.jpg' });
    const { prompt } = img.entrenarCara({ nombre: 'Jose' });
    assert.match(prompt, /show_characters action 'train'/);
    assert.match(prompt, /imagenes\/_mi-cara\/yo-5\.jpg/);
    assert.match(prompt, /personaje\.json/);
    assert.match(prompt, /higgsfield\.mjs" subir/);
  });

  test('buscar lo que ya tienes en Higgsfield: sin gastar, eligiendo en el chat', () => {
    const { prompt } = img.buscarCara();
    assert.match(prompt, /No generes nada ni gastes créditos/);
    assert.match(prompt, /select_workspace/);
    assert.match(prompt, /show_characters/);
    assert.match(prompt, /show_reference_elements/);
    assert.match(prompt, /show_medias/);
    assert.match(prompt, /personaje\.json/);
  });

  test('encargos: valida, crea su carpeta y pide mirar el coste', () => {
    assert.throws(() => img.nuevo({ descripcion: ' ' }), /Describe/);
    assert.throws(() => img.nuevo({ tipo: 'animar', descripcion: 'x' }), /Sube la imagen/);
    assert.throws(() => img.nuevo({ tipo: 'conmigo', descripcion: 'yo en la playa' }), /elige tu cara/);
    const p = jarvis.crearPieza({ titulo: 'Carrusel productividad', formato: 'Carrusel' });
    const { nombre, prompt } = img.nuevo({ descripcion: 'Escritorio con portátil y café. Luz de mañana', formato: '4:5', cantidad: 9, presupuesto: 30, referencias: ['imagenes/_referencias/producto.jpg', '../fuera.jpg'], pieza: p.id });
    assert.equal(nombre, 'escritorio-con-portatil-y-cafe');
    assert.ok(existsSync(path.join(lab.dir, 'imagenes', nombre, '_encargo.json')));
    assert.match(prompt, /4 variantes\. Decide tú por lo que pido: si es vídeo/);
    assert.match(prompt, /Si salgo yo .*Busca mi cara en mi Higgsfield/);
    assert.match(prompt, /Formato: Feed 4:5/);
    assert.match(prompt, /get_cost:true/);
    assert.match(prompt, /Presupuesto: 30 créditos/);
    assert.match(prompt, /use_unlim/);
    assert.match(prompt, /imagenes\/_referencias\/producto\.jpg/);
    assert.doesNotMatch(prompt, /fuera\.jpg/);
    assert.match(prompt, /Carrusel productividad/);
    assert.match(prompt, /bajar "<url>" imagenes\/escritorio-con-portatil-y-cafe/);
    // Foto a editar: va aparte de las referencias
    const ed = img.nuevo({ descripcion: 'Cámbiale el fondo por una playa', editar: 'imagenes/_referencias/producto.jpg', referencias: ['imagenes/_referencias/producto.jpg'] }).prompt;
    assert.match(ed, /Foto a editar: imagenes\/_referencias\/producto\.jpg/);
    assert.doesNotMatch(ed, /Referencias \(súbelas/);
    assert.doesNotMatch(img.nuevo({ descripcion: 'x', editar: '../../etc/passwd' }).prompt, /Foto a editar/);
    // Con el personaje listo, fotos contigo con soul_2
    mkdirSync(path.join(lab.dir, 'imagenes', '_mi-cara'), { recursive: true });
    writeFileSync(path.join(lab.dir, 'imagenes', '_mi-cara', 'personaje.json'), JSON.stringify({ soul_id: 'soul-123', nombre: 'Jose', estado: 'listo' }));
    assert.match(img.nuevo({ tipo: 'conmigo', descripcion: 'Yo en un gimnasio' }).prompt, /soul_2' con soul_id soul-123/);
    // Un Elemento de Higgsfield: va como <<<id>>> dentro del prompt
    writeFileSync(path.join(lab.dir, 'imagenes', '_mi-cara', 'personaje.json'), JSON.stringify({ element_id: 'el-9', nombre: 'Jose', estado: 'listo' }));
    assert.equal(img.personaje().tipo, 'elemento');
    assert.match(img.nuevo({ tipo: 'conmigo', descripcion: 'Yo en la playa' }).prompt, /<<<el-9>>> dentro del prompt/);
    // Fotos ya subidas a Higgsfield: como referencias
    writeFileSync(path.join(lab.dir, 'imagenes', '_mi-cara', 'personaje.json'), JSON.stringify({ media_ids: ['m1', 'm2'], nombre: 'Mis fotos' }));
    assert.deepEqual([img.personaje().tipo, img.personaje().estado], ['fotos', 'listo']);
    assert.match(img.nuevo({ tipo: 'conmigo', descripcion: 'Yo en la oficina' }).prompt, /media_id: m1, m2/);
    writeFileSync(path.join(lab.dir, 'imagenes', '_mi-cara', 'personaje.json'), JSON.stringify({ nombre: 'vacío' }));
    assert.equal(img.personaje(), null);
    writeFileSync(path.join(lab.dir, 'imagenes', '_mi-cara', 'personaje.json'), JSON.stringify({ soul_id: 'soul-123', soul_tipo: 'soul_cinematic', estado: 'listo' }));
    assert.match(img.nuevo({ tipo: 'conmigo', descripcion: 'Yo en un plató' }).prompt, /model 'soul_cinematic' con soul_id soul-123/);
    assert.match(img.nuevo({ tipo: 'broll', descripcion: 'Manos en un teclado', duracion: 8 }).prompt, /1 clip de B-roll de unos 8 s/);
  });

  test('resultados por encargo y borrar', async () => {
    const carpeta = path.join(lab.dir, 'imagenes', 'escritorio-con-portatil-y-cafe');
    writeFileSync(path.join(carpeta, '01.jpg'), 'x');
    writeFileSync(path.join(carpeta, '02.mp4'), 'x');
    const t = (await img.estado()).trabajos.find((x) => x.nombre === 'escritorio-con-portatil-y-cafe');
    assert.equal(t.titulo, 'Escritorio con portátil y café');
    assert.deepEqual(t.archivos.map((a) => a.nombre), ['01.jpg', '02.mp4']);
    assert.equal(t.videos, 1);
    assert.equal(t.formato, '4:5');
    assert.ok(!(await img.estado()).trabajos.some((x) => x.nombre.startsWith('_')));
    // A la biblioteca como cualquier resultado del Laboratorio
    lab.borrar('imagenes/escritorio-con-portatil-y-cafe/02.mp4');
    img.borrar('escritorio-con-portatil-y-cafe');
    assert.ok(!existsSync(carpeta));
    assert.throws(() => img.borrar('../x'), /No válido/);
  });

  test('el ayudante solo baja y sube dentro de imagenes/ y con https', () => {
    const script = path.resolve('laboratorio/higgsfield.mjs');
    const correr = (args) => { try { execFileSync(process.execPath, [script, ...args], { cwd: lab.dir, stdio: 'pipe' }); return ''; } catch (e) { return String(e.stderr); } };
    assert.match(correr(['bajar', 'http://ejemplo.com/a.jpg', 'imagenes/x']), /Solo enlaces https/);
    assert.match(correr(['bajar', 'https://ejemplo.com/a.jpg', '../fuera']), /Solo dentro de imagenes/);
    assert.match(correr(['subir', 'imagenes/_referencias/producto.jpg', 'http://x']), /https/);
    assert.match(correr(['subir', '/etc/passwd', 'https://x']), /Solo dentro de imagenes/);
  });
});
