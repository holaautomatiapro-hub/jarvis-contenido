# Guía de estilo — JARVIS de contenido

Especificación visual extraída de las capturas del post de referencia (diapositivas 1–8).
Los valores viven como variables CSS en `web/src/theme.css`; cambia ahí y se actualiza todo.

## Modo y color (Apariencia)

El botón de la paleta, arriba a la derecha, abre **Apariencia**: modo **Oscuro**, **Claro** o **Sistema** (sigue al de Windows) y el **color principal**, con 10 colores listos, cualquier otro con el selector o pegando su código (`#ff5a1f`). Se guarda en el navegador y se aplica antes de pintar la página.

- El modo va en `<html data-theme="light|dark">`. Las variables de fondo y texto (`--bg`, `--panel`, `--hondo`, `--tinta`, `--text`, `--text-2`, `--muted`, `--…-texto`) tienen un valor para cada modo en `theme.css`.
- El color principal es `--accent`. De él salen `--accent-2` (tono más claro), `--sobre-acento` (texto blanco u oscuro según lo claro que sea), `--glow`, `--border` y todas las transparencias, con `color-mix(in srgb, var(--accent) N%, transparent)`. No escribas azules fijos: usa estas variables.
- La esfera (canvas) toma el acento al cambiarlo con el evento `apariencia` de `web/src/lib/apariencia.js`. Los colores por categoría (tareas, ideas, notas, formatos de Instagram…) no cambian.

La tabla de abajo son los valores del modo oscuro con el azul por defecto.

## Paleta

| Token | Valor | Uso |
|---|---|---|
| `--bg` | `#050a17` | Fondo de la app (con degradado radial a `--bg-2`) |
| `--bg-2` | `#0a1330` | Resplandor de fondo |
| `--panel` | `#0b1428` | Tarjetas y paneles |
| `--panel-2` | `#0e1934` | Hover, filas alternas, inputs |
| `--border` | `rgba(56,120,255,.18)` | Borde de 1px de los paneles |
| `--accent` | `#2f6bff` | Azul eléctrico principal (píldora activa, botones) |
| `--accent-2` | `#3d8bff` | Brillos, enlaces, partículas |
| `--glow` | `rgba(47,107,255,.35)` | Sombras luminosas |
| `--orange` | `#f59e0b` | Tareas |
| `--blue` | `#3b82f6` | Ideas |
| `--purple` | `#8b5cf6` | Notas |
| `--green` | `#22c55e` | Contenido / "Online" / subidas |
| `--pink` | `#ec4899` | Interacción |
| `--cyan` | `#22d3ee` | Aprendizaje / secundario |
| `--red` | `#ef4444` | Bajadas / errores |
| `--text` | `#e6edf7` | Texto principal |
| `--muted` | `#7d8aa5` | Texto secundario |
| `--dim` | `#45526b` | Texto terciario, ejes |

## Tipografía

- **Logo**: `J A R V I S` + punto azul — Inter 800, `letter-spacing: .45em`, 18px. Subtítulo "Sistema Operativo de IA" 9px, `--muted`.
- **Interfaz**: Inter 400/500/600.
- **Etiquetas de sección**: MAYÚSCULAS, 10px, 600, `letter-spacing: .12em`, `--muted`.
- **Cifras KPI**: Inter 600, 24px.
- **Reloj**: Inter 500, 24px + fecha 10px debajo.
- **Terminal**: JetBrains Mono 12px.

## Componentes

- **Panel**: fondo `--panel`, borde 1px `--border`, radio 14px, `box-shadow: inset 0 1px 0 rgba(255,255,255,.03), 0 0 0 1px rgba(0,0,0,.2)`.
- **Píldoras de navegación**: 30px alto, radio 8px, icono + texto 12px. Activa = fondo `--accent` + brillo.
- **Tarjeta KPI**: icono cuadrado redondeado de color (fondo del color al 15%), etiqueta en mayúsculas, cifra grande, badge de variación (verde ↑ / rojo ↓) y minigráfica de línea con degradado del color de la categoría.
- **Esfera central**: partículas azules en esfera con núcleo brillante, rotación lenta, partículas sueltas alrededor. Debajo: "J A R V I S" espaciado + "Tu espacio de trabajo inteligente", caja "Pregúntale a JARVIS lo que quieras…" con botón circular azul y chips de acciones.
- **Barras de distribución**: icono + etiqueta + barra de 6px redondeada con el color de categoría + porcentaje.
- **Estado del sistema**: icono + servicio + punto verde + "Online".
- **Tabla de actividad**: hora en `--muted`, icono, texto y etiqueta de color (píldora pequeña) a la derecha.

## Mascota

Robot 3D azul propio, generado con Higgsfield (Nano Banana 2.1) y con el fondo quitado en local (rembg). No copia la mascota del post de referencia.

Poses en `web/public/mascota/` (WebP 512×512 con transparencia): `base`, `saludando`, `senalando`, `sentada`, `pensando`. Se usan con el componente `web/src/components/Mascota.jsx`, por ejemplo `<Mascota pose="saludando" size={150} />`. Flota suavemente y la animación se desactiva si el sistema pide reducir el movimiento.

- Inicio: `saludando`, en la esquina de la esfera.
- Pestañas en construcción: `pensando`.
