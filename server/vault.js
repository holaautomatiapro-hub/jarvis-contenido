import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Acceso al vault de Obsidian: la "memoria" de JARVIS. Todo son archivos Markdown normales.

export const CARPETAS = [
  '00-Inbox', '01-Ideas', '02-Guiones', '03-Transcripciones', '04-Competencia', '05-Ads', '06-Publicaciones', '07-Diario',
];

export class VaultError extends Error {}

export function createVault(root) {
  const base = path.resolve(root);

  // Ruta segura dentro del vault (evita salir con ../ y solo permite .md)
  const resolve = (rel) => {
    if (typeof rel !== 'string' || !rel.trim()) throw new VaultError('Ruta vacía');
    const clean = rel.replace(/\\/g, '/').replace(/^\/+/, '');
    const abs = path.resolve(base, clean);
    if (abs !== base && !abs.startsWith(base + path.sep)) throw new VaultError('Ruta fuera del vault');
    if (!abs.toLowerCase().endsWith('.md')) throw new VaultError('Solo se permiten notas .md');
    if (clean.split('/').some((p) => p.startsWith('.'))) throw new VaultError('Ruta no permitida');
    return abs;
  };
  const rel = (abs) => path.relative(base, abs).split(path.sep).join('/');

  function list() {
    const out = [];
    const walk = (dir) => {
      let entries;
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) walk(abs);
        else if (e.name.toLowerCase().endsWith('.md')) {
          const st = statSync(abs);
          const r = rel(abs);
          out.push({
            path: r,
            carpeta: r.includes('/') ? r.split('/')[0] : '',
            titulo: e.name.replace(/\.md$/i, ''),
            modificado: st.mtime.toISOString(),
            creado: (st.birthtimeMs ? st.birthtime : st.mtime).toISOString(),
            bytes: st.size,
          });
        }
      }
    };
    walk(base);
    return out.sort((a, b) => b.modificado.localeCompare(a.modificado));
  }

  function read(relPath) {
    const abs = resolve(relPath);
    if (!existsSync(abs)) throw new VaultError('La nota no existe');
    return { path: rel(abs), titulo: path.basename(abs, '.md'), contenido: readFileSync(abs, 'utf8'), modificado: statSync(abs).mtime.toISOString() };
  }

  // Crea una nota nueva sin pisar ninguna existente (añade " 2", " 3"… si hace falta)
  function create(carpeta, titulo, contenido) {
    const nombre = nombreArchivo(titulo);
    const dir = carpeta ? carpeta.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') : '';
    let relPath = (dir ? `${dir}/` : '') + `${nombre}.md`;
    for (let n = 2; existsSync(resolve(relPath)); n++) relPath = (dir ? `${dir}/` : '') + `${nombre} ${n}.md`;
    const abs = resolve(relPath);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, contenido, { encoding: 'utf8', flag: 'wx' });
    return rel(abs);
  }

  // Escribe (o reescribe) una nota concreta; para notas que mantiene JARVIS, como las versiones por red
  function write(relPath, contenido) {
    const abs = resolve(relPath);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, contenido, 'utf8');
    return rel(abs);
  }

  function append(relPath, texto) {
    const abs = resolve(relPath);
    const prev = existsSync(abs) ? readFileSync(abs, 'utf8') : '';
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, prev + (prev && !prev.endsWith('\n') ? '\n' : '') + texto, 'utf8');
    return rel(abs);
  }

  function search(q, limit = 30) {
    const needle = normaliza(q.trim());
    if (!needle) return [];
    const res = [];
    for (const n of list()) {
      let text = '';
      try { text = readFileSync(resolve(n.path), 'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').replace(/^#\s.*\r?\n/, ''); } catch { continue; }
      const enTitulo = normaliza(n.titulo).includes(needle);
      const idx = normaliza(text).indexOf(needle);
      if (!enTitulo && idx < 0) continue;
      const start = Math.max(0, idx - 60);
      const fragmento = idx < 0 ? text.slice(0, 140) : (start ? '…' : '') + text.slice(start, idx + needle.length + 80);
      res.push({ ...n, fragmento: fragmento.replace(/\s+/g, ' ').trim(), puntuacion: enTitulo ? 2 : 1 });
    }
    return res.sort((a, b) => b.puntuacion - a.puntuacion).slice(0, limit);
  }

  return { base, nombre: path.basename(base), list, read, create, write, append, search, resolve };
}

// Copia la plantilla la primera vez (sin pisar nada) y deja configurado el MCP para Claude Code.
export function ensureVault(vaultPath, templateDir, mcpScript) {
  const nuevo = !existsSync(vaultPath);
  mkdirSync(vaultPath, { recursive: true });
  if (existsSync(templateDir)) cpSync(templateDir, vaultPath, { recursive: true, force: false, errorOnExist: false });
  for (const c of CARPETAS) mkdirSync(path.join(vaultPath, c), { recursive: true });
  const mcpFile = path.join(vaultPath, '.mcp.json');
  if (!existsSync(mcpFile)) {
    const cfg = { mcpServers: { jarvis: { command: 'node', args: ['--disable-warning=ExperimentalWarning', mcpScript] } } };
    writeFileSync(mcpFile, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  }
  return { nuevo };
}

export function normaliza(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Nombre de archivo válido en Windows y legible en Obsidian
export function nombreArchivo(titulo) {
  const limpio = String(titulo || 'Sin título')
    .replace(/[<>:"/\\|?*#^[\]\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 80)
    .trim();
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(limpio) || !limpio ? `Nota ${limpio}`.trim() : limpio;
}
