---
name: flujo-clips
description: "Saca varios clips de un directo, un pódcast o un vídeo largo, cada uno como su pieza, unidos al vídeo de origen y repartidos en el calendario. Úsala cuando digan \"saca clips de…\" o \"trocea este vídeo\". (Si es la entrevista de un cliente, usa flujo-testimonio.)"
metadata:
  titulo: "De un vídeo largo a varios clips"
  categoria: flujos
  autor: JARVIS
---
# De un vídeo largo a varios clips

Saca varios clips de un directo, un pódcast o un vídeo largo, cada uno como su pieza, unidos al vídeo de origen y repartidos en el calendario. Úsala cuando digan "saca clips de…" o "trocea este vídeo". (Si es la entrevista de un cliente, usa flujo-testimonio.)

## Antes de empezar
- Lee `_voz.md` (en la raíz del vault) y escribe con esa voz. Si está vacío, usa un tono cercano y directo en español de España y avísalo en una sola línea al final.
- Busca material propio con `buscar_notas` (sobre todo en `03-Transcripciones` y `01-Ideas`): historias, frases y ejemplos reales valen más que cualquier invento.
- Si te falta un dato imprescindible (tema, objetivo o público), pregunta una sola cosa y espera.

## Pasos
1. Crea la pieza madre del vídeo largo con crear_pieza (formato Reel, estado editar, su pilar).
2. laboratorio_estado y, si hace falta, laboratorio_subir (tipo video).
3. laboratorio_encargar tipo reel en modo clips (entre 3 y 8 clips de 30-60 s, plantilla pantalla salvo que pida otra). Lee con laboratorio_chat los clips propuestos (inicio, fin, gancho), enséñaselos y pasa su respuesta con laboratorio_responder.
4. Cuando termine: laboratorio_a_biblioteca de cada clip, de uno en uno, con padre_id de la pieza madre, su pilar y su objetivo.
5. Reparte los clips en los huecos de mi_semana (uno por día de publicación) con mover_pieza.

## Formato de la respuesta
En cada parada, lo que tiene que revisar. Al final: la lista de clips con el día en que sale cada uno.

## Al terminar
- Repasa el texto contra la lista anti-IA: nada de "en el mundo de hoy", "descubre", "sumérgete", "no solo… sino también", tríos de adjetivos ni emojis de relleno. Frases concretas, como se dicen en voz alta.
- Si es una pieza de contenido nueva, créala o muévela en el pipeline (`crear_pieza` / `mover_pieza`) con su pilar, objetivo, gancho y CTA si los sabes.
- Termina proponiendo el siguiente paso en una frase.
