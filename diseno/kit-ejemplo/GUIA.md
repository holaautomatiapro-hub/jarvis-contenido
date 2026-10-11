# Kit de ejemplo de JARVIS

Este es el sistema de diseño que JARVIS usa mientras no importas el tuyo. Sirve para probar: para que los carruseles salgan con **tu** marca, prepara tu kit (ver «Tu propio sistema de diseño» en `docs/DISENO.md`) e impórtalo desde **Laboratorio → Diseño**.

## Marca
- Cuenta: `@tucuenta`. Español de España, tuteo, frases cortas.
- Colores: fondo oscuro `#0f1115` o claro `#f1f0ec`, acento azul `#3d7bff` (sobre claro, `#2456c7`). Texto secundario `#b4b8c2` (sobre oscuro) y `#4a4d55` (sobre claro).
- Tipografía: Inter (`font-family: 'Inter Kit'`), 900 en titulares y 600-800 en el resto.
- Resalta con el acento **solo la palabra clave** de cada titular.

## Carrusel (1080 × 1350)
1. **Portada** (fondo oscuro, `glow: "top"`): promesa o problema con número.
2. **Desarrollo**: una idea por diapositiva, alternando fondo oscuro (`bg: "black"`) y claro (`bg: "grey"`). Etiqueta («Paso 1») + titular + cuerpo + una tarjeta que dibuje la idea.
3. **Cierre** (oscuro, `glow: "mid"`): «Comenta la palabra», la palabra en grande con `.palabra` y qué recibe quien comenta.

Clases disponibles: `.titular`, `.etiqueta`, `.acento`, `.cuerpo`, `.tarjeta`, `.fila`, `.remate`, `.palabra`.

## Stories (1080 × 1920)
Mismo estilo, sin cabecera ni puntos. Textos más grandes (titular 92 px, cuerpo 50 px) y nada fuera de la zona segura (250 px arriba, 300 px abajo).

## Animación (GSAP)
Etiqueta desde la izquierda (x −40 → 0, 0,45 s), titular subiendo (y +40 → 0, 0,6 s), cuerpo y tarjetas después, escalonados. Todo quieto antes de los 5 s.

## Caption
Primera línea con gancho, resumen en lista corta y cierre «Comenta PALABRA y te envío… 👇».
