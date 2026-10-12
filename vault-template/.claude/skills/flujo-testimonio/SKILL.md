---
name: flujo-testimonio
description: "De la entrevista de un cliente a stories, carrusel, clips, portada y captions en la biblioteca, repartidos en el calendario. Úsala cuando digan \"tengo la entrevista de…\" o \"monta el testimonio de…\"."
metadata:
  titulo: "Testimonio de principio a fin"
  categoria: flujos
  autor: JARVIS
---
# Testimonio de principio a fin

De la entrevista de un cliente a stories, carrusel, clips, portada y captions en la biblioteca, repartidos en el calendario. Úsala cuando digan "tengo la entrevista de…" o "monta el testimonio de…".

## Antes de empezar
- Lee `_voz.md` (en la raíz del vault) y escribe con esa voz. Si está vacío, usa un tono cercano y directo en español de España y avísalo en una sola línea al final.
- Busca material propio con `buscar_notas` (sobre todo en `03-Transcripciones` y `01-Ideas`): historias, frases y ejemplos reales valen más que cualquier invento.
- Si te falta un dato imprescindible (tema, objetivo o público), pregunta una sola cosa y espera.

## Pasos
1. laboratorio_estado: comprueba que el Laboratorio está listo (plugin, Python y marca) y si la entrevista ya está subida. Si no, pide la ruta del vídeo en su ordenador y súbelo con laboratorio_subir (tipo entrevista; la foto del cliente con tipo foto y su nombre).
2. Pide solo lo que falte: nombre del cliente, qué hicisteis con él y, si quiere, la frase de la portada. Nunca inventes resultados ni frases.
3. laboratorio_encargar tipo testimonio. Lo monta el Laboratorio: ve leyendo con laboratorio_chat y enséñale el guion y los clips cuando los proponga; su respuesta, tal cual, con laboratorio_responder. Nunca des tú el visto bueno.
4. Cuando termine: laboratorio_estado para ver lo que ha salido y laboratorio_a_biblioteca (stories y clips en reel de uno en uno, el carrusel en vídeo junto, las portadas) con pilar de casos o testimonios y objetivo convertir.
5. Reparte las piezas en los huecos de mi_semana con mover_pieza (no todo el mismo día) y dile qué sale cada día.

## Formato de la respuesta
En cada parada, lo que tiene que revisar. Al final: qué piezas hay en la biblioteca y qué día sale cada una.

## Al terminar
- Repasa el texto contra la lista anti-IA: nada de "en el mundo de hoy", "descubre", "sumérgete", "no solo… sino también", tríos de adjetivos ni emojis de relleno. Frases concretas, como se dicen en voz alta.
- Si es una pieza de contenido nueva, créala o muévela en el pipeline (`crear_pieza` / `mover_pieza`) con su pilar, objetivo, gancho y CTA si los sabes.
- Termina proponiendo el siguiente paso en una frase.
