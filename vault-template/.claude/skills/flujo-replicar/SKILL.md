---
name: flujo-replicar
description: "De un enlace de Instagram de otra cuenta (carrusel, post o reel) a tu versión: el carrusel con tu diseño o el guion del reel con tu voz, como pieza lista. Úsala cuando peguen un enlace de Instagram o digan \"replica este post\", \"hazme uno como este\" o \"transcribe este reel y adáptalo\"."
metadata:
  titulo: "Replicar un post o un reel desde su enlace"
  categoria: flujos
  autor: JARVIS
---
# Replicar un post o un reel desde su enlace

De un enlace de Instagram de otra cuenta (carrusel, post o reel) a tu versión: el carrusel con tu diseño o el guion del reel con tu voz, como pieza lista. Úsala cuando peguen un enlace de Instagram o digan "replica este post", "hazme uno como este" o "transcribe este reel y adáptalo".

## Antes de empezar
- Lee `_voz.md` (en la raíz del vault) y escribe con esa voz. Si está vacío, usa un tono cercano y directo en español de España y avísalo en una sola línea al final.
- Busca material propio con `buscar_notas` (sobre todo en `03-Transcripciones` y `01-Ideas`): historias, frases y ejemplos reales valen más que cualquier invento.
- Si te falta un dato imprescindible (tema, objetivo o público), pregunta una sola cosa y espera.

## Pasos
1. traer_publicacion con el enlace (si te pide la cuenta, pregunta de quién es). Te da el caption, la transcripción si es un reel y las imágenes de los slides: léelas con Read, en orden.
2. Resume en 3 líneas su estructura (gancho, desarrollo, CTA) y por qué funciona. Pregunta solo lo que falte: en qué formato lo quiere (el mismo, si no dice otro) y qué quiere cambiar.
3. Escribe su versión con su voz (_voz.md) y su negocio (CLAUDE.md): misma estructura y la misma idea en cada slide o bloque, todo el texto nuevo, nunca frases literales, y «Inspirado en: <enlace>» al final. Guárdalo en 02-Guiones con crear_nota y crea la pieza con crear_pieza (su nota, caption, pilar, objetivo, gancho y CTA). Enséñaselo y ESPERA el visto bueno.
4. Carrusel o stories: diséñalo como en flujo-carrusel-stories (ver_kit_diseno, crear_diseno con pieza_id, guardar_diseno y, con su sí, exportar_diseno). Reel: deja la pieza en la fase de grabar y, cuando lo grabe, sigue con flujo-reel.
5. Ponle día con mover_pieza tapando un hueco de mi_semana.

## Formato de la respuesta
En cada parada, lo que tiene que revisar. Al final: la pieza, el día en que sale y lo que falta (grabar, revisar el diseño…).

## Al terminar
- Repasa el texto contra la lista anti-IA: nada de "en el mundo de hoy", "descubre", "sumérgete", "no solo… sino también", tríos de adjetivos ni emojis de relleno. Frases concretas, como se dicen en voz alta.
- Si es una pieza de contenido nueva, créala o muévela en el pipeline (`crear_pieza` / `mover_pieza`) con su pilar, objetivo, gancho y CTA si los sabes.
- Termina proponiendo el siguiente paso en una frase.
