#!/usr/bin/env node
// Ayudante de archivos para Higgsfield en el Laboratorio (lo usa Claude; el conector solo da enlaces):
//   node laboratorio/higgsfield.mjs subir <archivo> <upload_url>   sube un archivo local al enlace de media_upload
//   node laboratorio/higgsfield.mjs bajar <url> <carpeta> [nombre]  baja un resultado a imagenes/<encargo>/
// Solo trabaja dentro de imagenes/ de la carpeta actual (la del Laboratorio) y solo con https.
import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';

const [orden, a, b, c] = process.argv.slice(2);
const base = path.resolve(process.cwd(), 'imagenes');
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' };
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' };
const MAX = 500 * 1024 ** 2;

function fallar(m) { console.error(`ERROR: ${m}`); process.exit(1); }
function dentro(p) {
  const abs = path.resolve(p);
  if (!abs.startsWith(base + path.sep)) fallar(`Solo dentro de imagenes/ (la carpeta del Laboratorio): ${p}`);
  return abs;
}
const https = (u) => { try { return new URL(u).protocol === 'https:'; } catch { return false; } };

if (orden === 'subir') {
  if (!a || !b) fallar('Uso: subir <archivo> <upload_url>');
  const abs = dentro(a);
  if (!existsSync(abs)) fallar(`No existe ${a}`);
  if (!https(b)) fallar('El enlace de subida debe ser https');
  const ext = path.extname(abs).slice(1).toLowerCase();
  const r = await fetch(b, { method: 'PUT', headers: { 'Content-Type': MIME[ext] || 'application/octet-stream' }, body: readFileSync(abs) });
  if (!r.ok) fallar(`La subida respondió ${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}`);
  console.log(`OK subido ${path.basename(abs)} (${statSync(abs).size} bytes)`);
} else if (orden === 'bajar') {
  if (!a || !b) fallar('Uso: bajar <url> <carpeta> [nombre]');
  if (!https(a)) fallar('Solo enlaces https');
  const dir = dentro(b);
  mkdirSync(dir, { recursive: true });
  const r = await fetch(a);
  if (!r.ok) fallar(`La descarga respondió ${r.status}`);
  const tipo = String(r.headers.get('content-type') || '').split(';')[0].trim();
  const ext = EXT[tipo] || (path.extname(new URL(a).pathname).slice(1).toLowerCase().match(/^(jpe?g|png|webp|mp4|mov|webm)$/)?.[0]) || fallar(`No es una imagen ni un vídeo (${tipo || 'sin tipo'})`);
  const datos = Buffer.from(await r.arrayBuffer());
  if (datos.length > MAX) fallar('Pesa más de 500 MB');
  let nombre = c ? c.replace(/[^\w.-]+/g, '-').replace(/\.[^.]+$/, '') : null;
  if (!nombre) {
    const n = readdirSync(dir).filter((f) => /^\d{2}\./.test(f)).length + 1;
    nombre = String(n).padStart(2, '0');
  }
  let destino = path.join(dir, `${nombre}.${ext === 'jpeg' ? 'jpg' : ext}`);
  for (let i = 2; existsSync(destino); i++) destino = path.join(dir, `${nombre}-${i}.${ext === 'jpeg' ? 'jpg' : ext}`);
  writeFileSync(destino, datos);
  console.log(`OK ${path.relative(process.cwd(), destino)} (${Math.round(datos.length / 1024)} KB)`);
} else {
  console.log('Uso:\n  node laboratorio/higgsfield.mjs subir <archivo> <upload_url>\n  node laboratorio/higgsfield.mjs bajar <url> <carpeta> [nombre]');
  process.exit(orden ? 1 : 0);
}
