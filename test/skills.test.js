import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKILLS, RETIRADAS } from '../skills/catalogo.js';
import { CATEGORIAS } from '../skills/categorias.js';
import { generar } from '../scripts/generar-skills.js';
import { createSkills, leerFrontmatter } from '../server/skills.js';
import { openDb } from '../server/db.js';
import { createVault, ensureVault } from '../server/vault.js';
import { createJarvis } from '../server/jarvis.js';
import { getConfig } from '../server/config.js';
import { createAsistente, CONVERSACIONES } from '../server/asistente.js';
import { argumentos, ejecutar } from '../server/claude-runner.js';

const FALSO = `${process.execPath}|${path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'claude-falso.js')}`;

let dir, vaultPath, skills, jarvis;
before(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-skills-'));
  vaultPath = path.join(dir, 'V');
  const cfg = getConfig({});
  ensureVault(vaultPath, cfg.templateDir, cfg.mcpScript);
  jarvis = createJarvis({ db: openDb(':memory:'), vault: createVault(vaultPath) });
  skills = createSkills(vaultPath);
});
after(() => rmSync(dir, { recursive: true, force: true }));

describe('catálogo', () => {
  test('pocas skills, nombres únicos y válidos, todas las categorías con contenido', () => {
    assert.ok(SKILLS.length >= 15 && SKILLS.length <= 30, `${SKILLS.length} skills`);
    assert.equal(new Set(SKILLS.map((s) => s.n)).size, SKILLS.length);
    assert.ok(!RETIRADAS.some((n) => SKILLS.some((s) => s.n === n)), 'una skill no puede estar activa y retirada');
    for (const s of SKILLS) {
      assert.match(s.n, /^[a-z0-9]+(-[a-z0-9]+)*$/, s.n);
      assert.ok(s.p.length >= 3 && s.s && s.d.length > 30, `${s.n} incompleta`);
    }
    for (const c of CATEGORIAS) assert.ok(SKILLS.some((s) => s.c === c.id), c.id);
  });

  test('las skills de anuncios recuerdan que las campañas se crean en pausa', () => {
    const ads = SKILLS.find((s) => s.n === 'copy-anuncio-meta');
    assert.match(ads.p.join(' '), /SIEMPRE en pausa/);
  });

  test('las de análisis usan las herramientas reales de datos y adaptar guarda en la pieza', () => {
    for (const s of SKILLS.filter((x) => ['metricas', 'competencia'].includes(x.c))) assert.match(s.p.join(' '), /metricas_instagram|competencia_mejores/, s.n);
    const adaptar = SKILLS.find((s) => s.n === 'adaptar-a-todas-las-redes');
    assert.match(adaptar.p.join(' '), /guardar_versiones/);
  });

  test('el generador produce SKILL.md con frontmatter válido (agentskills.io)', () => {
    const destino = path.join(dir, 'gen');
    assert.equal(generar({ destino }), SKILLS.length);
    const md = readFileSync(path.join(destino, 'guion-reel-30s', 'SKILL.md'), 'utf8');
    const fm = leerFrontmatter(md);
    assert.equal(fm.name, 'guion-reel-30s');
    assert.match(fm.description, /reel corto/);
    assert.equal(fm.metadata.categoria, 'guiones');
    assert.match(md, /_voz\.md/);
    assert.match(md, /crear_nota` en `02-Guiones\//);
  });

  test('las skills de análisis no piden escribir con la voz pero prohíben inventar cifras', () => {
    const md = readFileSync(path.join(dir, 'gen', 'informe-semanal', 'SKILL.md'), 'utf8');
    assert.match(md, /Nunca inventes cifras/);
    assert.doesNotMatch(md, /lista anti-IA/);
  });
});

describe('skills en el vault', () => {
  test('el vault nuevo trae las skills del catálogo y el resumen las agrupa', () => {
    const r = skills.resumen(jarvis.vault);
    assert.equal(r.total, SKILLS.length);
    assert.equal(r.categorias.find((c) => c.id === 'ganchos').total, SKILLS.filter((s) => s.c === 'ganchos').length);
    assert.equal(r.transcripciones, 0);
    assert.equal(r.vozLista, false, 'la plantilla de _voz.md está vacía');
  });

  test('detecta skills propias y el perfil de voz relleno', () => {
    mkdirSync(path.join(vaultPath, '.claude', 'skills', 'mi-skill'), { recursive: true });
    writeFileSync(path.join(vaultPath, '.claude', 'skills', 'mi-skill', 'SKILL.md'), '---\nname: mi-skill\ndescription: Mi skill personal\n---\n# Mi skill\n');
    const voz = jarvis.vault.read('_voz.md').contenido.replace('- Tono:', '- Tono: cercano y con humor');
    writeFileSync(path.join(vaultPath, '_voz.md'), voz);
    const r = skills.resumen(jarvis.vault);
    assert.equal(r.total, SKILLS.length + 1);
    assert.equal(r.skills.find((s) => s.nombre === 'mi-skill').propia, true);
    assert.ok(r.categorias.some((c) => c.id === 'otras'));
    assert.equal(r.vozLista, true);
  });

  test('leer una skill y rechazar nombres raros', () => {
    assert.match(skills.leer('ganchos-reel').contenido, /# Ganchos para reels/);
    assert.throws(() => skills.leer('../CLAUDE'), /no válido/);
    assert.throws(() => skills.leer('no-existe'), /no existe/);
  });

  test('un vault ya existente recibe las skills nuevas sin pisar las editadas', () => {
    const f = path.join(vaultPath, '.claude', 'skills', 'ganchos-reel', 'SKILL.md');
    writeFileSync(f, readFileSync(f, 'utf8') + '\nMi ajuste personal\n');
    rmSync(path.join(vaultPath, '.claude', 'skills', 'evaluar-gancho'), { recursive: true });
    const cfg = getConfig({});
    ensureVault(vaultPath, cfg.templateDir, cfg.mcpScript);
    assert.match(readFileSync(f, 'utf8'), /Mi ajuste personal/);
    assert.ok(existsSync(path.join(vaultPath, '.claude', 'skills', 'evaluar-gancho', 'SKILL.md')));
  });

  test('las skills retiradas de JARVIS se archivan (no se borran) y las tuyas se quedan', () => {
    const dirSkills = path.join(vaultPath, '.claude', 'skills');
    const vieja = (n, autor) => {
      mkdirSync(path.join(dirSkills, n), { recursive: true });
      writeFileSync(path.join(dirSkills, n, 'SKILL.md'), `---\nname: ${n}\ndescription: x\nmetadata:\n  titulo: X\n  autor: ${autor}\n---\n# X\n`);
    };
    vieja('cta-seguir', 'JARVIS');
    vieja('bio-instagram', 'yo');
    const cfg = getConfig({});
    ensureVault(vaultPath, cfg.templateDir, cfg.mcpScript);
    assert.ok(!existsSync(path.join(dirSkills, 'cta-seguir')));
    assert.ok(existsSync(path.join(vaultPath, '.claude', 'skills-archivadas', 'cta-seguir', 'SKILL.md')));
    assert.ok(existsSync(path.join(dirSkills, 'bio-instagram', 'SKILL.md')), 'la editada por la persona no se toca');
  });
});

describe('chat de guiones (conversación propia)', () => {
  test('argumentos incluyen el prompt de sistema del chat', () => {
    const a = argumentos({ sistema: CONVERSACIONES.guiones.sistema });
    assert.ok(a.includes('--append-system-prompt'));
    assert.match(a[a.indexOf('--append-system-prompt') + 1], /03-Transcripciones/);
  });

  test('guiones y principal llevan sesiones e historiales separados; Haiku sube a Sonnet en guiones', async () => {
    const llamadas = [];
    const asistente = createAsistente({
      db: openDb(':memory:'), jarvis, vaultPath,
      ejecutarImpl: (o) => { llamadas.push(o); return ejecutar({ ...o, bin: FALSO }); },
    });
    const esperar = () => new Promise((ok) => { const t = setInterval(() => { if (!asistente.estado().ocupado) { clearInterval(t); ok(); } }, 20); });

    const r = asistente.preguntar({ texto: 'hola', conversacion: 'guiones' });
    assert.equal(r.modelo, 'sonnet');
    await esperar();
    asistente.preguntar({ texto: 'hola' });
    await esperar();

    assert.match(llamadas[0].sistema, /CHAT PARA GUIONES/);
    assert.equal(llamadas[1].sistema, null);
    assert.equal(llamadas[1].sesion, null, 'la principal no reutiliza la sesión de guiones');
    assert.equal(asistente.estado({ conversacion: 'guiones' }).eventos.every((e) => e.conversacion === 'guiones'), true);
    assert.equal(asistente.estado().eventos.every((e) => e.conversacion === 'principal'), true);

    asistente.nuevaSesion({ conversacion: 'guiones' });
    assert.equal(asistente.estado({ conversacion: 'guiones' }).eventos.length, 1); // solo el aviso de sesión nueva
    assert.ok(asistente.estado().eventos.length > 1, 'la principal no se borra');
    assert.throws(() => asistente.preguntar({ texto: 'x', conversacion: 'otra' }), /conversacion/);
  });
});
