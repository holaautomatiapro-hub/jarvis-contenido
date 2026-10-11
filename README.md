# JARVIS de contenido

Sistema operativo de IA para creadores de contenido, para **Windows**. Dashboard local con voz, memoria en Obsidian, Claude Code como motor y Hermes por Telegram para usarlo desde el móvil.

> Funcionan todas las pestañas: Inicio, **Tareas** (prioridad, estado y fecha límite de día, semana o mes, con tablero y filtros), **Contenido** (calendario, lista, biblioteca con tus vídeos y fotos, y pipeline), Notas, **Voz**, **Skills** (100 skills y el chat para guiones), **Instagram** (dos dashboards y transcripción de reels), **Competencia**, **Meta Ads** (asistente, Ad Library y campañas siempre en pausa), **Publicar** (una pieza adaptada a cada red, con calendario) y **Apps** (Hermes por Telegram, tareas programadas y accesos rápidos), además del MCP `jarvis` que comparten Claude Code y Hermes, y el instalador de un solo prompt.

## Instalar (Windows)

**Con un solo prompt**: abre Claude Code y pega el prompt de **[INSTALAR-JARVIS.md](INSTALAR-JARVIS.md)**. Lo instala todo, te guía con las claves (sin pasarlas por el chat), Instagram y Telegram, y revisa que funciona.

**A mano**: [docs/INSTALACION-WINDOWS.md](docs/INSTALACION-WINDOWS.md). En resumen:

```powershell
git clone https://github.com/holaautomatiapro-hub/jarvis-contenido.git JARVIS
cd JARVIS
powershell -ExecutionPolicy Bypass -File instalar.ps1   # instala, crea el vault y deja JARVIS arrancando con Windows
npm run claves                                           # tus claves, una a una
powershell -ExecutionPolicy Bypass -File instalar.ps1 -Reiniciar
npm run doctor                                           # qué está listo y qué falta
```

Después, ábrelo con el acceso directo **JARVIS** del escritorio o en http://localhost:3333. `iniciar-jarvis.bat` lo abre con la ventana visible, útil para ver errores.

## Tareas (pestaña Tareas)

- Cada tarea tiene **título, descripción, prioridad** (alta, media o baja), **estado** (sin empezar, en proceso o terminada) y **fecha de finalización**: un día concreto, una semana o un mes (o sin fecha).
- **Tablero** con las tres columnas (arrastra las tarjetas para cambiar el estado) o **Lista**. Pulsa una tarea para verla, **modificarla** o **eliminarla**.
- **Filtros** por estado, prioridad y fecha (atrasadas, hoy, esta semana, el mes que viene, sin fecha o entre dos fechas) y buscador. Los contadores de arriba también filtran.
- Por Telegram: "añade para esta semana, prioridad alta: grabar el reel de rutinas".

## Contenido (pestaña Contenido)

- **Calendario** del mes: arrastra las piezas de un día a otro, doble clic (o **+**) en un día para crear una, y **De la biblioteca** para programar algo que ya tienes.
- **Lista**: próximos, sin fecha y anteriores, con buscador y filtros por tipo y estado.
- **Biblioteca**: lo que aún no tiene día. Arrastra vídeos, fotos o **carpetas enteras** (eliges si son un carrusel, stories o piezas sueltas), ordénalas en carpetas, junta varias en un carrusel y **Programa** cada una.
- **Pipeline**: el tablero idea → guion → grabar → editar → listo → publicado (el que antes estaba en Tareas).
- La ficha de cada pieza guarda tipo, estado, fecha y hora, caption, enlace al vídeo y sus archivos. JARVIS no publica: cuando esté lista, la adaptas a cada red en **Publicar**.

## Hablar con JARVIS (pestaña Voz)

Necesitas **Claude Code** instalado y con tu sesión iniciada: abre una terminal, ejecuta `claude` una vez y entra con tu cuenta (Pro o Max). JARVIS lo usa en segundo plano, dentro de tu vault, así que lee `CLAUDE.md` y tiene el MCP `jarvis` conectado.

- **JEV** (el clasificador) elige el modelo al instante y sin gastar: Haiku para lo rápido y la memoria, Sonnet para escribir y buscar en la web, Opus para analizar y planificar. Puedes forzar uno en el panel "Modelo".
- **Oídos**: el micrófono usa el reconocimiento de voz de Chrome o Edge (es-ES).
- **Voz**: con `ELEVENLABS_API_KEY` y `ELEVENLABS_VOICE_ID` en `.env` responde con ElevenLabs; sin ellas, con la voz del navegador.
- JARVIS puede leer y escribir notas del vault y buscar en la web, pero **no puede ejecutar comandos** en tu PC (Bash está desactivado).
- El coste que ves en el terminal es el equivalente en API; con la suscripción de Claude no se te cobra aparte.

## Skills de contenido (pestaña Skills)

100 skills en 11 categorías (ganchos, guiones, carruseles, historias, formatos, ideas, reescritura, CTA, métricas, competencia y Meta Ads). Viven en tu vault, en `.claude/skills/<nombre>/SKILL.md` (formato abierto de agentskills.io, que entienden Claude Code y Hermes).

- **Chat para guiones**: antes de escribir lee `_voz.md` y busca en tus transcripciones e ideas, y te dice de qué nota sale cada idea. Con "Guardar en el vault" lo guarda en `02-Guiones` y mueve la pieza a Guion.
- **Usar**: cualquier skill se lanza desde su botón y se completa en el chat.
- **Tus propias skills**: crea una carpeta con su `SKILL.md` en `.claude/skills/` y aparece en "Otras" con la etiqueta "tuya". Si editas una skill de JARVIS, tus cambios se respetan: las actualizaciones solo añaden skills nuevas.
- **Perfil de voz**: la skill `perfil-de-voz` escribe `_voz.md` a partir de `03-Transcripciones`. Las transcripciones llegarán solas al conectar Instagram (fase 5).
- Para editar el catálogo base: `skills/catalogo.js` y `npm run skills`.

## Instagram (pestaña Instagram)

Conecta tu cuenta siguiendo **[docs/INSTAGRAM.md](docs/INSTAGRAM.md)**: con una app de Meta en modo desarrollo (sin revisión) o, más fácil, con **Windsor.ai** (`WINDSOR_API_KEY` con `npm run claves`). Hasta entonces verás datos de ejemplo.

- **Rendimiento de la cuenta**: alcance, visualizaciones, interacción, seguidores, guardados y compartidos frente al periodo anterior; evolución diaria; distribución por formato; y los temas, ganchos y formatos que mejor funcionan.
- **Análisis de contenido**: cada pieza con sus métricas, su tema y su alcance frente a tu media. Se puede ordenar y buscar.
- Con Windsor, además, **todas las métricas de la cuenta** día a día (visitas al perfil, clics en la web, cuentas que interactúan, impresiones…) y las de tus **historias**.
- Cada 6 horas JARVIS **sincroniza**, **transcribe tus reels** en `03-Transcripciones` (con ElevenLabs), **clasifica los temas** y, con 5 transcripciones o más, **crea tu perfil de voz**.
- Por MCP (Claude Code y Hermes) pregunta con `metricas_instagram`: "¿qué contenido funcionó mejor este mes?".

## Competencia (pestaña Competencia)

Los perfiles iniciales salen de `COMPETIDORES` en `.env` (usuarios separados por comas); después se añaden y quitan desde la pestaña. Necesita Instagram conectado: la API oficial (Business Discovery) solo deja ver **perfiles profesionales públicos** y da texto, likes, comentarios, formato y fecha. **No da su alcance** ni sus vídeos.

- Calculado al momento: **mejores ganchos** por engagement (interacciones / seguidores), **formatos ganadores** y **frecuencia** de publicación.
- Con **Analizar con JARVIS** (y solo cada semana): **temas que más funcionan**, **patrones** e **ideas adaptadas a tu negocio**, guardados también como nota en `04-Competencia`. Cada idea se guarda en tu pipeline con un clic.
- Mientras no haya datos reales verás un ejemplo con perfiles **ficticios**: JARVIS nunca inventa datos de cuentas reales.

## Meta Ads (pestaña Meta Ads)

Guía: **[docs/META-ADS.md](docs/META-ADS.md)**. Usa la conexión de Instagram; solo falta elegir la cuenta publicitaria (y verificar tu identidad en Meta para la Ad Library).

- **Asistente en chat**: gasto, CTR, CPC y resultados por campaña; qué reel impulsar; ángulos de la competencia.
- **Ad Library** de tus competidores: los anuncios que más tiempo llevan activos (los que les funcionan).
- **Contenido orgánico para impulsar**: tus piezas que se guardan, comparten e interactúan más que tu media.
- **Campañas**: JARVIS solo propone borradores. Tú pulsas **Crear en pausa** y la activas tú en el Administrador de anuncios. Ninguna herramienta de JARVIS puede crear ni activar campañas, el código bloquea cualquier cosa que no esté en pausa y hay un tope de presupuesto diario (`ADS_PRESUPUESTO_MAX_DIA`).

## Publicar (pestaña Publicar)

"Crea una vez, publica en todos lados". JARVIS **no publica nada**: prepara cada versión y tú la copias y la publicas.

- Eliges una pieza del pipeline (o escribes una idea nueva) y las redes: Reel, Carrusel, Historias, TikTok, Shorts, LinkedIn, X, Threads, Facebook, Pinterest, canal de Telegram o newsletter.
- **Adaptar con JARVIS** usa la skill `adaptar-a-todas-las-redes` y tu `_voz.md` para escribir una versión nativa por red: guion con gancho y texto en pantalla para vídeo, slide a slide para carruseles y el texto listo para pegar en LinkedIn, X o Threads. Si regeneras, se sustituye la versión que aún no está publicada.
- Cada versión tiene **Copiar**, fecha y hora (**Programar**) y **Marcar como publicado**. Cuando todas las versiones están publicadas, la pieza pasa sola a *Publicado* en el pipeline.
- El **calendario** muestra la semana, con lo programado y la lista de versiones listas sin fecha.
- Todo se guarda también como nota en `06-Publicaciones` (una por pieza), para que lo tengas en Obsidian.

## Hermes por Telegram (pestaña Apps)

Guía paso a paso: **[docs/HERMES.md](docs/HERMES.md)**. Hermes es JARVIS en el móvil: le escribes o le mandas notas de voz por Telegram y usa la misma memoria, skills y datos que el dashboard.

- **Configurar Hermes** (en Apps, o `npm run hermes`) copia la personalidad (`hermes/SOUL.md`), conecta el MCP `jarvis`, añade las skills del vault, pone la hora de Madrid y crea 4 tareas programadas: plan del día (8:45), informe del lunes (9:10), competencia del jueves (9:40) y planificación del domingo (18:50).
- La pestaña Apps enseña qué falta por configurar, si el bot está en marcha, las próximas ejecuciones y lo último que ha llegado por Telegram.
- Hermes necesita su propio modelo (API key de Anthropic u OpenRouter, con coste aparte): no puede usar la suscripción de Claude Pro.

## Dónde se guardan tus datos

- **Notas, ideas y guiones**: en tu vault de Obsidian, por defecto `Documentos\JARVIS-Vault`. Se crea solo la primera vez que arrancas JARVIS. Ábrelo en Obsidian con "Abrir carpeta como vault". Puedes cambiar la ruta con `VAULT_PATH` en `.env`.
- **Tareas, pipeline, actividad, métricas de Instagram y la conexión con Meta**: en `data\jarvis.db` (SQLite), dentro de la carpeta de JARVIS. No la compartas: contiene el token de tu página.
- **Vídeos y fotos de la pestaña Contenido**: en `data\contenido\`, también en tu PC. Solo se ven desde el dashboard.

Mientras no hayas guardado nada, Inicio muestra datos de ejemplo (etiqueta "Demo" bajo el logo).

## MCP `jarvis` (puente con Claude Code y Hermes)

`mcp/jarvis-mcp.js` da acceso a la memoria y al pipeline: `capturar_idea`, `crear_nota`, `buscar_notas`, `leer_nota`, `listar_notas`, `crear_pieza`, `mover_pieza`, `listar_pipeline`, `anadir_tarea`, `actualizar_tarea`, `completar_tarea`, `listar_tareas`, `borrar_tarea`, `tareas_de_hoy` y `resumen_del_dia`, además de las de Instagram, competencia, Meta Ads y publicar (`guardar_versiones`, `versiones_de_pieza`, `calendario_publicaciones`, `programar_version`). Lo que se guarda por el MCP aparece al momento en el dashboard.

- **Claude Code**: el vault ya incluye `.mcp.json`, así que al abrir `claude` dentro del vault tiene el MCP conectado y lee `CLAUDE.md` (la personalidad de JARVIS).
- **Hermes**: lo conecta **Configurar Hermes** (ver arriba), con `JARVIS_ORIGEN=hermes` para que lo que llegue por Telegram salga marcado como tal.

## Desarrollo

```bash
npm install
npm run dev      # servidor (3333) + interfaz con recarga en caliente (5173)
npm run build    # compila la interfaz en web/dist
npm start        # sirve la versión compilada en http://localhost:3333
npm test         # tests de datos, API y MCP
```

## Estructura

```
web/             interfaz (Vite + React). Tokens de color en web/src/theme.css
server/          servidor local (Express + WebSocket), base de datos, vault y lógica de JARVIS
mcp/             MCP jarvis para Claude Code y Hermes
hermes/          personalidad de JARVIS para Hermes (SOUL.md)
scripts/         claves, doctor, preparar (lo usa el instalador), configurar-hermes, generador de skills y modo desarrollo
assets/          icono de JARVIS para el acceso directo
instalar.ps1     instalador para Windows (también -Reiniciar, -Parar, -Desinstalar)
vault-template/  plantilla del vault: CLAUDE.md (personalidad), _voz.md y carpetas
test/            tests (node --test)
docs/            guías: instalación en Windows, estilo, Instagram, Meta Ads y Hermes
```
