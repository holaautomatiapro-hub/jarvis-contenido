# JARVIS de contenido

Sistema operativo de IA para creadores de contenido, para **Windows**. Dashboard local con voz, memoria en Obsidian, Claude Code como motor y Hermes por Telegram para usarlo desde el móvil.

> Estado: **fase 12**. Todo gira alrededor de la **pieza de contenido**: de la idea al calendario, con su estrategia (pilar, objetivo, gancho y CTA), lo que sale de ella y sus versiones para otras redes. Pestañas: **Inicio** (tu día: tu semana con los huecos, tu ritmo y los días que tienes cubiertos, qué se publica hoy y lo que falta producir, además de tareas y recordatorios), **Tareas**, **Contenido** (calendario único, lista, biblioteca, banco de ideas y pipeline), **Laboratorio** (Diseño, Testimonios, Reels, Lead magnets e Imágenes; lo que sale pasa a la biblioteca con su caption y en su carpeta), **Notas**, **Chat**, **Skills** (5 flujos completos y 22 skills útiles), **Instagram**, **Competencia**, **Meta Ads** y **Apps** (Hermes por Telegram), además del MCP `jarvis` que comparten Claude Code y Hermes y el instalador de un solo prompt.

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

**Modo claro u oscuro y tu color**: el botón de la paleta, arriba a la derecha. Eliges oscuro, claro o el del sistema, y cambias el azul por cualquier color (de la lista, con el selector o con su código hex).

## Inicio: tu día

- **Tu semana**: los 7 días con lo que sale cada uno. Un día en que publicas sin nada programado es un **hueco**: pulsa «Hueco · tapar» y elige una pieza de la biblioteca que aún no tiene día. Arriba ves **hasta cuándo tienes cubierto** (días de publicación seguidos con algo programado).
- **Tu ritmo**: en «Ritmo» pones cuántas piezas de cada tipo quieres a la semana (p. ej. 4 reels, 2 carruseles, 5 stories) y qué días publicas. Las barras enseñan lo publicado (verde) y lo programado (azul) frente a tu objetivo.
- **Hoy se publica**: copia el caption (o el texto de la versión para otra red), descarga los archivos y márcala como publicada sin salir de Inicio. Lo que Instagram publica solo no hace falta marcarlo.
- **Por producir**: lo que tiene día en las próximas dos semanas y aún no está listo, con lo urgente (2 días o menos) en rojo.
- Los contadores: lo publicado esta semana, lo programado en 7 días, lo listo sin fecha y las ideas en el banco.
- Hermes usa lo mismo (`mi_semana`) en el plan diario de las 8:45 y en la planificación del domingo. Ojo: si ya tenías Hermes configurado, sus tareas programadas siguen con el texto anterior (Configurar Hermes no toca las que ya existen). Para usar el nuevo, borra en Hermes `jarvis-plan-diario` y `jarvis-semana-domingo` (`hermes cron list` las enseña) y vuelve a pulsar **Configurar Hermes** en Apps.

## Un solo chat para todo

Ya no hace falta un chat de Claude Code para cada cosa. Abre `claude` dentro de tu vault (o usa la pestaña **Chat**) y pide lo que quieras; para cada trabajo hay una skill de flujo completo que va de principio a fin y lo deja en la biblioteca, con su estrategia y con día:

| Antes (un chat para cada cosa) | Ahora, en el mismo chat | Skill |
| --- | --- | --- |
| Carruseles y stories | «Hazme un carrusel sobre…» | `flujo-carrusel-stories` |
| Testimonios | «Tengo la entrevista de Ana: monta el testimonio» | `flujo-testimonio` |
| Editar vídeos | «Edítame este vídeo» | `flujo-reel` |
| Sacar clips | «Saca clips de este directo» | `flujo-clips` |
| Lead magnets | «Hazme un checklist para regalar» | `flujo-lead-magnet` |

- El diseño lo hace el propio chat con tu sistema de diseño. Testimonios, reels, clips, imágenes y lead magnets los monta el **Laboratorio** del dashboard (con tu plugin, Python y ffmpeg): el chat le pasa el encargo, te enseña el guion y los clips cuando el Laboratorio se para a revisar y le pasa tu respuesta. Nunca da el visto bueno por ti.
- Puedes darle la ruta de un vídeo de tu ordenador: lo sube al Laboratorio (`laboratorio_subir`).
- JARVIS tiene que estar abierto (el Laboratorio vive en el dashboard). Publicar un lead magnet en Vercel sigue siendo un botón tuyo.
- Herramientas del MCP: `laboratorio_estado`, `laboratorio_subir`, `laboratorio_encargar`, `laboratorio_chat`, `laboratorio_responder`, `laboratorio_a_biblioteca`, `asignar_leadmagnet` y `exportar_diseno`.

## Resultados: qué te funciona

- **Cada pieza unida a su publicación de Instagram** (con Facebook y Windsor a la vez no se duplica nada: comparten el id de Instagram). JARVIS las une solo cuando está claro: las que publica él, por el enlace de Instagram puesto en «URL del vídeo», por el caption (aunque lleve negritas) o, si no hay duda, por el día y el formato. Lo que une pasa a *Publicado*. Las que no, desde la ficha: «Elegir su publicación» (o «No está en Instagram», y no se vuelve a unir sola).
- **En la ficha**: alcance, visualizaciones, guardados, compartidos, comentarios e interacción, frente a la media de su formato. En la **Lista**, el alcance de cada pieza.
- **Instagram → Qué me funciona**: por pilar, objetivo, formato y CTA (alcance medio, frente a tu media, interacción y guardados + compartidos por cada 1.000 personas), los mejores y peores ganchos y unas conclusiones en una frase. Solo saca conclusiones con 3 piezas o más por grupo. Todo son datos: no inventa.
- **Informe semanal** en `07-Diario` cada lunes, solo (aunque Instagram no esté conectado, con lo publicado): números frente a la semana anterior, ritmo, días sin publicar, lo mejor y lo peor, qué te funciona y los huecos y lo que falta producir de la semana que empieza. También a mano, con «Informe de la semana pasada».
- Por el MCP: `que_me_funciona`, `resultados_pieza` e `informe_semanal`.

## Tareas (pestaña Tareas)

- Cada tarea tiene **título, descripción, prioridad** (alta, media o baja), **estado** (sin empezar, en proceso o terminada) y **fecha de finalización**: un día concreto, una semana o un mes (o sin fecha).
- **Tablero** con las tres columnas (arrastra las tarjetas para cambiar el estado) o **Lista**. Pulsa una tarea para verla, **modificarla** o **eliminarla**.
- **Filtros** por estado, prioridad y fecha (atrasadas, hoy, esta semana, el mes que viene, sin fecha o entre dos fechas) y buscador. Los contadores de arriba también filtran.
- Por Telegram: "añade para esta semana, prioridad alta: grabar el reel de rutinas".

## Contenido (pestaña Contenido)

- **Calendario** del mes: arrastra las piezas de un día a otro, doble clic (o **+**) en un día para crear una, y **De la biblioteca** para programar algo que ya tienes.
- **Lista**: próximos, sin fecha y anteriores, con buscador y filtros por tipo, estado, **pilar** y **objetivo**.
- **Ideas**: el banco de ideas sin desarrollar, agrupado por pilar, con un botón para pasar cada una a la siguiente fase. No se mezcla con la biblioteca.
- **Biblioteca**: lo que tiene archivos o está en marcha y aún no tiene día. Arrastra vídeos, fotos o **carpetas enteras** (eliges si son un carrusel, stories o piezas sueltas), ordénalas en carpetas y **subcarpetas** (dentro de una carpeta, «+ Subcarpeta»; al borrar una, sus piezas suben a la de arriba), junta varias en un carrusel y **Programa** cada una.
- **Pipeline**: el tablero por fases (de serie idea → guion → grabar → editar → listo → publicado). Con **Editar fases** añades, renombras, ordenas o borras fases; Idea, Listo y Publicado se renombran pero no se borran.
- La ficha de cada pieza guarda tipo, estado, fecha y hora, caption, enlace al vídeo y sus archivos, y su **estrategia**: pilar (te sugiere los que ya usas), objetivo (atraer, nutrir o convertir), gancho y CTA. Así JARVIS puede decirte qué te funciona.
- **De dónde sale**: una pieza puede salir de otra (el clip de un vídeo largo, el carrusel de un reel) o de un trabajo del Laboratorio. La ficha lo enseña, lista lo que ha salido de ella y tiene «+ Sacar otra pieza de esta».
- **Otras redes** (en la ficha): JARVIS adapta la pieza a TikTok, Shorts, LinkedIn, X, Threads… con tu voz (skill `adaptar-a-todas-las-redes`). Cada versión se copia y se marca como publicada, y sale **el mismo día que la pieza** (o el que le pongas): no hay un segundo calendario. En el calendario la pieza lleva «+N» redes, y las que van otro día tienen su propio chip. Todo se guarda también en `06-Publicaciones`.
- **Generar portada** (en la ficha de la pieza): tus plantillas son tus propias portadas de referencia (de serie, **Carrusel** 4:5 y **Testimonio** 9:16; sube su imagen una vez y añade las que quieras). Pones el título, lo que quieras distinto (p. ej. «fondo blanco con letras negras») y, si quieres, una foto: JARVIS copia el diseño de la referencia y solo cambia lo que pidas. Se añade sola: en un reel queda como su portada (se manda a Instagram al publicar); en un carrusel o un post, como primera imagen.
- **Al elegir qué publicar** en el calendario, navegas por las carpetas y subcarpetas de la biblioteca.
- **Publicar en Instagram** (con Instagram conectado con Facebook): marca «Publicar sola en Instagram» y se publica a su hora como foto, reel, carrusel o story, o pulsa «Publicar ahora». Solo lo activas tú desde el dashboard (Hermes y Claude Code no pueden) y JARVIS tiene que estar abierto. Para las demás redes, usa **Otras redes** en la ficha y la subes tú. Guía: [docs/INSTAGRAM.md](docs/INSTAGRAM.md#publicar-en-instagram-desde-jarvis).

## Laboratorio (pestaña Laboratorio)

- **Diseño**: elige un guion y una plantilla de **tu sistema de diseño** y Claude te prepara el carrusel o las stories. JARVIS revisa que nada se salga ni se pise, lo ajustas en el chat y lo exportas a la biblioteca en **JPG o vídeo MP4** (7 s por diapositiva) para programarlo o publicarlo. Tu sistema (marca, fuentes, plantillas y ejemplos) se importa en un .zip y se queda en tu vault. Guía: [docs/DISENO.md](docs/DISENO.md).
- **Testimonios**: sube la entrevista de un cliente (y, si quieres, su foto y la frase de la portada) y JARVIS, con **tu plugin «testimonios»**, saca stories y carrusel en vídeo, clips en reel, 4:5 y YouTube, la portada y 3 captions. Antes de montar te enseña el guion y los clips en el chat y espera tu visto bueno. Con **Todo a la biblioteca** pasan de una vez stories, carrusel, clips en reel y portadas, cada uno con su caption y en la carpeta `Testimonios/<cliente>`; lo que ya está se marca con ✓ y no se duplica.
- **Reels**: sube tu vídeo hablando a cámara y JARVIS elige los mejores momentos, quita silencios y muletillas y le pone tus subtítulos y tu título, a pantalla completa, en ventana con marco o en 4:5.
- **Lead magnets**: guías, checklists, tests y generadores en una **página web** con tu sistema de diseño. JARVIS los escribe con tu voz, los revisa a 375 px y tú los **publicas en Vercel** con un clic; el enlace se copia o se pone solo en la pieza que lo anuncia.
- **Imágenes**: con **Higgsfield** (tu cuenta y tus créditos), imágenes para tus diseños, **fotos contigo** (tu personaje entrenado con tus fotos), **B-roll** y animar una imagen. JARVIS mira el coste antes de generar y lo deja listo para pasar a la biblioteca.
- **Captions**: botón **B** para negrita que se ve en Instagram, selector de **emojis** y **Crear con IA** (JARVIS lo escribe con tu voz a partir de la transcripción del reel o de lo que dicen las slides del carrusel) al crear o programar un post.
- El plugin se importa en un .zip y se queda solo en tu servidor. En el VPS, `bash ~/instalar-vps.sh` prepara Python, sus librerías y el modelo de transcripción. Guía: [docs/LABORATORIO.md](docs/LABORATORIO.md).

## JARVIS en un VPS (24 h)

¿Quieres que publique y conteste por Telegram con el PC apagado? Instálalo en un VPS Linux y ábrelo desde tu PC o tu móvil por una red privada (Tailscale): **[docs/VPS.md](docs/VPS.md)**. `npm run exportar` y `npm run importar-copia` pasan todos tus datos de un equipo a otro.

## Hablar con JARVIS (pestaña Chat)

Necesitas **Claude Code** instalado y con tu sesión iniciada: abre una terminal, ejecuta `claude` una vez y entra con tu cuenta (Pro o Max). JARVIS lo usa en segundo plano, dentro de tu vault, así que lee `CLAUDE.md` y tiene el MCP `jarvis` conectado.

- **Modelo**: Normal (Sonnet, por defecto), Rápido (Haiku) o A fondo (Opus). Diseño y Laboratorio usan siempre Opus.
- **Dictar**: el micro usa el reconocimiento de voz de Chrome o Edge (es-ES). **En voz alta**: con `ELEVENLABS_API_KEY` y `ELEVENLABS_VOICE_ID` en `.env` lee las respuestas con ElevenLabs; sin ellas, con la voz del navegador.
- JARVIS puede leer y escribir notas del vault y buscar en la web, pero **no puede ejecutar comandos** en tu PC (Bash está desactivado).

## Skills de contenido (pestaña Skills)

27 skills, pocas y buenas: 5 flujos completos y 22 para tareas sueltas (ganchos, guiones, carruseles, historias, formatos, ideas, reescritura, CTA, métricas, competencia y Meta Ads). Las de análisis trabajan con tus datos reales del MCP (`metricas_instagram`, `competencia_mejores`…). Viven en tu vault, en `.claude/skills/<nombre>/SKILL.md` (formato abierto de agentskills.io, que entienden Claude Code y Hermes).

- **Chat para guiones**: antes de escribir lee `_voz.md` y busca en tus transcripciones e ideas, y te dice de qué nota sale cada idea. Con "Guardar en el vault" lo guarda en `02-Guiones` y mueve la pieza a Guion.
- **Usar**: cualquier skill se lanza desde su botón y se completa en el chat.
- **Tus propias skills**: crea una carpeta con su `SKILL.md` en `.claude/skills/` y aparece en "Otras" con la etiqueta "tuya". Si editas una skill de JARVIS, tus cambios se respetan: las actualizaciones solo añaden skills nuevas. Las que JARVIS ya no trae se apartan a `.claude/skills-archivadas/` (no se borran: para recuperar una, muévela de vuelta a `.claude/skills/`).
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

## Hermes por Telegram (pestaña Apps)

Guía paso a paso: **[docs/HERMES.md](docs/HERMES.md)**. Hermes es JARVIS en el móvil: le escribes o le mandas notas de voz por Telegram y usa la misma memoria, skills y datos que el dashboard.

- **Configurar Hermes** (en Apps, o `npm run hermes`) copia la personalidad (`hermes/SOUL.md`), conecta el MCP `jarvis`, añade las skills del vault, pone la hora de Madrid y crea 4 tareas programadas: plan del día (8:45), informe del lunes (9:10), competencia del jueves (9:40) y planificación del domingo (18:50).
- La pestaña Apps enseña qué falta por configurar, si el bot está en marcha, las próximas ejecuciones y lo último que ha llegado por Telegram.
- Hermes necesita su propio modelo (API key de Anthropic u OpenRouter, con coste aparte): no puede usar la suscripción de Claude Pro.

## Dónde se guardan tus datos

- **Notas, ideas y guiones**: en tu vault de Obsidian, por defecto `Documentos\JARVIS-Vault`. Se crea solo la primera vez que arrancas JARVIS. Ábrelo en Obsidian con "Abrir carpeta como vault". Puedes cambiar la ruta con `VAULT_PATH` en `.env`.
- **Tareas, pipeline, actividad, métricas de Instagram y la conexión con Meta**: en `data\jarvis.db` (SQLite), dentro de la carpeta de JARVIS. No la compartas: contiene el token de tu página.
- **Vídeos y fotos de la pestaña Contenido**: en `data\contenido\`, también en tu PC. Solo se ven desde el dashboard.
- **Tu sistema de diseño**: en el vault, en `_diseno\`. Las vistas previas de los diseños, en `.jarvis\disenos\` dentro del vault.

Los contadores de Inicio son siempre reales (empiezan en cero).

## MCP `jarvis` (puente con Claude Code y Hermes)

`mcp/jarvis-mcp.js` da acceso a la memoria y al pipeline: `capturar_idea`, `crear_nota`, `buscar_notas`, `leer_nota`, `editar_nota`, `borrar_nota`, `listar_notas`, `crear_pieza` y `mover_pieza` (con pilar, objetivo, gancho, CTA y de qué pieza sale), `ver_pilares`, `mi_semana` (huecos, ritmo, días cubiertos y lo que falta producir), `que_me_funciona`, `resultados_pieza`, `informe_semanal`, `listar_pipeline`, `anadir_tarea`, `actualizar_tarea`, `completar_tarea`, `listar_tareas`, `borrar_tarea`, `tareas_de_hoy`, `resumen_del_dia` y los recordatorios diarios (`crear_recordatorio`, `recordatorios_de_hoy`, `marcar_recordatorio`…), además de las de Instagram, competencia, Meta Ads, otras redes (`guardar_versiones`, `versiones_de_pieza`, `calendario_publicaciones` —piezas y versiones juntas—, `programar_version`) y diseño (`ver_kit_diseno`, `leer_archivo_kit`, `listar_medios`, `listar_disenos`, `ver_diseno`, `crear_diseno`, `guardar_diseno`). Lo que se guarda por el MCP aparece al momento en el dashboard.

- **Claude Code**: el vault ya incluye `.mcp.json`, así que al abrir `claude` dentro del vault tiene el MCP conectado y lee `CLAUDE.md` (la personalidad de JARVIS). Si tu vault es anterior a la fase 12, copia en tu `CLAUDE.md` la línea sobre la estrategia de las piezas de `vault-template/CLAUDE.md` (las actualizaciones no tocan tu `CLAUDE.md`).
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
server/diseno/   Diseño: kit (sistema de diseño), motor (HTML + GSAP → JPG/MP4 con Edge/Chrome y ffmpeg) y diseños
diseno/          sistema de diseño de ejemplo (el que se usa hasta que importas el tuyo)
mcp/             MCP jarvis para Claude Code y Hermes
hermes/          personalidad de JARVIS para Hermes (SOUL.md)
scripts/         claves, doctor, preparar (lo usa el instalador), configurar-hermes, generador de skills y modo desarrollo
assets/          icono de JARVIS para el acceso directo
instalar.ps1     instalador para Windows (también -Reiniciar, -Parar, -Desinstalar)
vault-template/  plantilla del vault: CLAUDE.md (personalidad), _voz.md y carpetas
test/            tests (node --test)
docs/            guías: instalación en Windows, estilo, Instagram, Meta Ads, Hermes, VPS y Diseño
```
