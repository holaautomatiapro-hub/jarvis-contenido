---
name: guion-teleprompter
description: "Convierte un guion en texto cómodo para leer en teleprompter. Úsala antes de grabar."
metadata:
  titulo: "Texto para teleprompter"
  categoria: guiones
  autor: JARVIS
---
# Texto para teleprompter

Convierte un guion en texto cómodo para leer en teleprompter. Úsala antes de grabar.

## Antes de empezar
- Lee `_voz.md` (en la raíz del vault) y escribe con esa voz. Si está vacío, usa un tono cercano y directo en español de España y avísalo en una sola línea al final.
- Busca material propio con `buscar_notas` (sobre todo en `03-Transcripciones` y `01-Ideas`): historias, frases y ejemplos reales valen más que cualquier invento.
- Si te falta un dato imprescindible (tema, objetivo o público), pregunta una sola cosa y espera.

## Pasos
1. Divide en frases de máximo 10 palabras, una por línea.
2. Marca pausas con " / " y énfasis en MAYÚSCULAS (solo 1-2 palabras por bloque).
3. Quita acotaciones de edición y deja solo lo que se dice.

## Formato de la respuesta
Texto limpio línea a línea, listo para copiar.

## Al terminar
- Repasa el texto contra la lista anti-IA: nada de "en el mundo de hoy", "descubre", "sumérgete", "no solo… sino también", tríos de adjetivos ni emojis de relleno. Frases concretas, como se dicen en voz alta.
- Guarda el resultado con `crear_nota` en `02-Guiones/` (título claro y la fecha si es un informe).
- Si es una pieza de contenido nueva, créala o muévela en el pipeline (`crear_pieza` / `mover_pieza`).
- Termina proponiendo el siguiente paso en una frase.
