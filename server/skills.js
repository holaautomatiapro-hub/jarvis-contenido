import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CATEGORIAS } from '../skills/categorias.js';
import { VaultError } from './vault.js';

// Lee las skills del vault (.claude/skills/<nombre>/SKILL.md). Incluye las que la persona añada o edite a mano.

const NOMBRE_OK = /^[a-z0-9][a-z0-9-]{0,63}$/;

// Frontmatter sencillo: claves de primer nivel y el bloque "metadata:" con sangría
export function leerFrontmatter(md) {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = { metadata: {} };
  let enMeta = false;
  for (const linea of m[1].split(/\r?\n/)) {
    const meta = linea.match(/^\s{2,}([\w-]+):\s*(.*)$/);
    const top = linea.match(/^([\w-]+):\s*(.*)$/);
    const valor = (v) => { const t = v.trim(); try { return t.startsWith('"') ? JSON.parse(t) : t.replace(/^'(.*)'$/, '$1'); } catch { return t; } };
    if (enMeta && meta) out.metadata[meta[1]] = valor(meta[2]);
    else if (top) { enMeta = top[1] === 'metadata' && !top[2].trim(); if (!enMeta) out[top[1]] = valor(top[2]); }
  }
  return out;
}

export function createSkills(vaultPath) {
  const dir = path.join(vaultPath, '.claude', 'skills');

  function listar() {
    if (!existsSync(dir)) return [];
    const res = [];
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      if (!d.isDirectory() || !NOMBRE_OK.test(d.name)) continue;
      const f = path.join(dir, d.name, 'SKILL.md');
      if (!existsSync(f)) continue;
      const fm = leerFrontmatter(readFileSync(f, 'utf8'));
      const categoria = CATEGORIAS.some((c) => c.id === fm.metadata?.categoria) ? fm.metadata.categoria : 'otras';
      res.push({ nombre: d.name, titulo: fm.metadata?.titulo || d.name, descripcion: fm.description || '', categoria, propia: fm.metadata?.autor !== 'JARVIS' });
    }
    return res.sort((a, b) => a.titulo.localeCompare(b.titulo, 'es'));
  }

  function leer(nombre) {
    if (!NOMBRE_OK.test(String(nombre))) throw new VaultError('Nombre de skill no válido');
    const f = path.join(dir, nombre, 'SKILL.md');
    if (!existsSync(f)) throw new VaultError('Esa skill no existe');
    return { nombre, contenido: readFileSync(f, 'utf8') };
  }

  function resumen(vault) {
    const skills = listar();
    const categorias = [...CATEGORIAS, { id: 'otras', titulo: 'Otras', icono: 'sparkle', color: 'var(--muted)', descripcion: 'Skills que has añadido tú.', accion: 'Usar' }]
      .map((c) => ({ ...c, total: skills.filter((s) => s.categoria === c.id).length }))
      .filter((c) => c.total > 0);
    const notas = vault.list();
    const transcripciones = notas.filter((n) => n.carpeta === '03-Transcripciones').length;
    let vozLista = false;
    try { vozLista = /^- Tono:[ \t]*\S/m.test(vault.read('_voz.md').contenido.replace(/^>.*$/gm, '')); } catch { /* sin _voz.md */ }
    return { total: skills.length, categorias, skills, transcripciones, vozLista };
  }

  return { listar, leer, resumen };
}
