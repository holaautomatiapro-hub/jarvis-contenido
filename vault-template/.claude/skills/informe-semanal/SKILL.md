---
name: informe-semanal
description: "Informe de rendimiento de la semana. Úsala cada lunes o cuando pidan el resumen semanal."
metadata:
  titulo: "Informe semanal"
  categoria: metricas
  autor: JARVIS
---
# Informe semanal

Informe de rendimiento de la semana. Úsala cada lunes o cuando pidan el resumen semanal.

## Antes de empezar
- Trabaja con datos reales del MCP jarvis: `metricas_instagram` (tus publicaciones), `competencia_datos` / `competencia_mejores` (competencia), `ads_rendimiento` / `ads_biblioteca` (anuncios) y el pipeline (`listar_pipeline`), o lo que la persona pegue. Si los datos son de ejemplo (demo), dilo en la primera línea. Si faltan datos, dilo y pide lo mínimo necesario. **Nunca inventes cifras.**
- Distingue siempre entre hechos (datos) e hipótesis (tu interpretación).

## Pasos
1. Saca las publicaciones de la semana y sus métricas con metricas_instagram (periodo de 7 días).
2. Top 3 y peor pieza con hipótesis de por qué (gancho, tema, formato).
3. Avance del pipeline y lo que estaba previsto y no salió (listar_pipeline, calendario_publicaciones, resumen_del_dia).
4. Prioridades para la semana siguiente.

## Formato de la respuesta
Informe con secciones: Números, Lo mejor, Lo peor, Aprendizajes, Próxima semana. Guárdalo en 07-Diario.

## Al terminar
- Guarda el resultado con `crear_nota` en `07-Diario/` (título claro y la fecha si es un informe).
- Si es una pieza de contenido nueva, créala o muévela en el pipeline (`crear_pieza` / `mover_pieza`) con su pilar, objetivo, gancho y CTA si los sabes.
- Termina proponiendo el siguiente paso en una frase.
