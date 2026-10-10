// Genera vault-template/.claude/skills/<nombre>/SKILL.md desde skills/catalogo.js.
// Uso: npm run skills
import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKILLS } from '../skills/catalogo.js';
import { CATEGORIAS } from '../skills/categorias.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DESTINO = path.join(ROOT, 'vault-template', '.claude', 'skills');
const ANALISIS = new Set(['metricas', 'competencia', 'ads']);

const yaml = (s) => JSON.stringify(s); // cadena YAML segura (JSON es YAML válido)

function preambulo(cat) {
  if (ANALISIS.has(cat.id)) {
    return `## Antes de empezar
- Trabaja con datos reales: métricas del vault, notas de \`04-Competencia\`/\`05-Ads\`, el pipeline (\`listar_pipeline\`) o lo que la persona pegue. Si faltan datos, dilo y pide lo mínimo necesario. **Nunca inventes cifras.**
- Distingue siempre entre hechos (datos) e hipótesis (tu interpretación).`;
  }
  return `## Antes de empezar
- Lee \`_voz.md\` (en la raíz del vault) y escribe con esa voz. Si está vacío, usa un tono cercano y directo en español de España y avísalo en una sola línea al final.
- Busca material propio con \`buscar_notas\` (sobre todo en \`03-Transcripciones\` y \`01-Ideas\`): historias, frases y ejemplos reales valen más que cualquier invento.
- Si te falta un dato imprescindible (tema, objetivo o público), pregunta una sola cosa y espera.`;
}

function cierre(cat) {
  const anti = ANALISIS.has(cat.id) ? '' : `- Repasa el texto contra la lista anti-IA: nada de "en el mundo de hoy", "descubre", "sumérgete", "no solo… sino también", tríos de adjetivos ni emojis de relleno. Frases concretas, como se dicen en voz alta.\n`;
  return `## Al terminar
${anti}- Guarda el resultado con \`crear_nota\` en \`${cat.carpeta}/\` (título claro y la fecha si es un informe).
- Si es una pieza de contenido nueva, créala o muévela en el pipeline (\`crear_pieza\` / \`mover_pieza\`).
- Termina proponiendo el siguiente paso en una frase.`;
}

export function generar({ destino = DESTINO, limpiar = true } = {}) {
  const porCat = new Map(CATEGORIAS.map((c) => [c.id, c]));
  const nombres = new Set();
  if (limpiar && existsSync(destino)) {
    for (const d of readdirSync(destino)) if (!d.startsWith('.')) rmSync(path.join(destino, d), { recursive: true, force: true });
  }
  for (const s of SKILLS) {
    const cat = porCat.get(s.c);
    if (!cat) throw new Error(`Categoría desconocida en ${s.n}: ${s.c}`);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.n) || s.n.length > 64) throw new Error(`Nombre no válido: ${s.n}`);
    if (nombres.has(s.n)) throw new Error(`Skill repetida: ${s.n}`);
    nombres.add(s.n);
    const md = `---
name: ${s.n}
description: ${yaml(s.d)}
metadata:
  titulo: ${yaml(s.t)}
  categoria: ${s.c}
  autor: JARVIS
---
# ${s.t}

${s.d}

${preambulo(cat)}

## Pasos
${s.p.map((x, i) => `${i + 1}. ${x}`).join('\n')}

## Formato de la respuesta
${s.s}

${cierre(cat)}
`;
    mkdirSync(path.join(destino, s.n), { recursive: true });
    writeFileSync(path.join(destino, s.n, 'SKILL.md'), md, 'utf8');
  }
  return nombres.size;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`✓ ${generar()} skills generadas en ${path.relative(ROOT, DESTINO)}`);
}
