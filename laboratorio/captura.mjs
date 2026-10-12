#!/usr/bin/env node
// Comprueba una página (un lead magnet) como en un móvil: capturas a 375 px de ancho, lo que se sale por
// los lados y los errores de JavaScript. Lo usa Claude en el Laboratorio para revisar lo que hace.
//   node laboratorio/captura.mjs <pagina.html> [--ancho 375] [--max 20]
// Deja <carpeta>/_capturas/01.png, 02.png… (una pantalla cada una) y <carpeta>/captura.png (la portada).
import path from 'node:path';
import { existsSync, mkdirSync, readdirSync, rmSync, copyFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { lanzarNavegador } from '../server/diseno/motor.js';

const args = process.argv.slice(2);
const opc = (n, def) => { const i = args.indexOf(`--${n}`); return i >= 0 ? Number(args[i + 1]) || def : def; };
const archivo = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!archivo) {
  console.log('Uso: node laboratorio/captura.mjs <pagina.html> [--ancho 375] [--max 20]');
  process.exit(1);
}
const abs = path.resolve(archivo);
if (!existsSync(abs)) { console.error(`No existe ${abs}`); process.exit(1); }
const ancho = opc('ancho', 375);
const alto = 812;
const max = opc('max', 20);
const dir = path.dirname(abs);
const salida = path.join(dir, '_capturas');
rmSync(salida, { recursive: true, force: true });
mkdirSync(salida, { recursive: true });

const navegador = await lanzarNavegador({ log: (m) => console.log(m) });
try {
  const pagina = await navegador.newPage({ viewport: { width: ancho, height: alto }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errores = [];
  pagina.on('pageerror', (e) => errores.push(e.message));
  pagina.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
  await pagina.goto(pathToFileURL(abs).href, { waitUntil: 'load', timeout: 60_000 });
  await pagina.waitForTimeout(800);
  const datos = await pagina.evaluate((w) => {
    const fuera = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.right > w + 1 || r.left < -1) {
        // Solo el primero de cada rama (si el padre ya se sale, los hijos no se cuentan)
        if (fuera.some((f) => f.el.contains(el))) continue;
        const s = getComputedStyle(el);
        if (s.position === 'fixed' && s.visibility === 'hidden') continue;
        fuera.push({ el, que: `<${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? ` class="${el.className.trim().split(/\s+/).slice(0, 3).join(' ')}"` : ''}> ${(el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60)}`, de: Math.round(r.left), a: Math.round(r.right) });
      }
    }
    const imgsRotas = [...document.images].filter((i) => i.complete && !i.naturalWidth).map((i) => (i.getAttribute('src') || '').slice(0, 60));
    return {
      altura: document.documentElement.scrollHeight,
      anchoReal: document.documentElement.scrollWidth,
      fuera: fuera.slice(0, 15).map(({ que, de, a }) => ({ que, de, a })),
      imgsRotas,
      marcadores: (document.body.innerHTML.match(/\{\{[A-Z_]+\}\}/g) || []).slice(0, 5),
      viewport: Boolean(document.querySelector('meta[name=viewport]')),
    };
  }, ancho);
  const pantallas = Math.min(max, Math.ceil(datos.altura / alto));
  for (let i = 0; i < pantallas; i++) {
    await pagina.evaluate((y) => window.scrollTo(0, y), i * alto);
    await pagina.waitForTimeout(250);
    await pagina.screenshot({ path: path.join(salida, `${String(i + 1).padStart(2, '0')}.png`) });
  }
  copyFileSync(path.join(salida, '01.png'), path.join(dir, 'captura.png'));

  console.log(`Página de ${datos.altura} px de alto a ${ancho} px de ancho: ${pantallas} capturas en ${path.relative(process.cwd(), salida) || salida}/ (${readdirSync(salida).join(', ')})${datos.altura / alto > max ? ` — solo las ${max} primeras pantallas; usa --max para más` : ''}`);
  if (!datos.viewport) console.log('✗ Falta <meta name="viewport" content="width=device-width, initial-scale=1"> en el <head>: sin ella el móvil la ve como un ordenador (980 px) y en pequeño.');
  if (datos.anchoReal > ancho + 1) console.log(`✗ La página se sale por los lados: mide ${datos.anchoReal} px de ancho (debe ser ${ancho}).`);
  if (datos.fuera.length) {
    console.log('✗ Elementos que se salen de la pantalla:');
    for (const f of datos.fuera) console.log(`   ${f.que}  (de ${f.de} a ${f.a} px)`);
  }
  if (datos.imgsRotas.length) console.log(`✗ Imágenes que no cargan: ${datos.imgsRotas.join(', ')}`);
  if (datos.marcadores.length) console.log(`✗ Quedan marcadores sin cambiar: ${datos.marcadores.join(', ')}`);
  if (errores.length) { console.log('✗ Errores de JavaScript:'); for (const e of [...new Set(errores)].slice(0, 10)) console.log(`   ${e}`); }
  if (datos.viewport && datos.anchoReal <= ancho + 1 && !datos.fuera.length && !datos.imgsRotas.length && !datos.marcadores.length && !errores.length) console.log('✓ Nada se sale de la pantalla y no hay errores. Revisa igualmente las capturas.');
} finally {
  await navegador.close();
}
