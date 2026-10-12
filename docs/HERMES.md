# JARVIS en el móvil: Hermes por Telegram

[Hermes Agent](https://github.com/NousResearch/hermes-agent) (de Nous Research) es un agente que vive en tu PC y se conecta a Telegram. Lo configuramos para que sea **el mismo JARVIS**: misma personalidad, mismas skills de contenido y, gracias al MCP `jarvis`, la misma memoria (tu vault) y los mismos datos que el dashboard. Lo que hagas por Telegram aparece al momento en Inicio y en la pestaña **Apps**.

Funciona en Windows nativo (sin WSL). Solo responde mientras el PC está encendido.

## Qué le puedes pedir

- "idea: reel sobre cómo contesto los DMs con IA" → la guarda en el pipeline.
- "¿Qué contenido funcionó mejor esta semana?"
- "Escríbeme un guion usando mis transcripciones" → lo escribe con tu voz (`_voz.md`) y lo guarda en `02-Guiones`.
- "¿Qué reel debería impulsar?" / "Prepárame una campaña con 10 € al día para ese reel" → deja un **borrador**; la creas en pausa desde el dashboard.
- "Convierte esta idea en un reel y adáptalo a todas mis redes" → las versiones quedan en la ficha de la pieza, en Contenido.
- Notas de voz: las transcribe y responde a lo que dices.

Y cada semana te escribe solo (tareas programadas, hora de Madrid):

| Tarea | Cuándo | Qué hace |
|---|---|---|
| Plan del día | Todos los días, 8:45 | Tus tareas de hoy, lo urgente primero, y 2 ideas a partir del pipeline |
| Informe de rendimiento | Lunes, 9:10 | Mejor y peor pieza de la semana, por qué, y qué reel merece impulsarse |
| Novedades de la competencia | Jueves, 9:40 | Qué les funciona a tus competidores y 3 ideas adaptadas (las guarda) |
| Planificación de la semana | Domingo, 18:50 | Qué grabar, editar y publicar cada día, y las 3 tareas clave del lunes |

Ninguna publica, programa ni crea campañas.

## Lo que cuesta

Hermes necesita su propio modelo de IA, y **no puede usar tu suscripción de Claude Pro** (con Max solo consume créditos de uso extra, no los incluidos en el plan). Lo normal es una **API key de Anthropic** (pago por uso, independiente de tu suscripción) o de OpenRouter. Pon un límite de gasto mensual en la consola del proveedor para dormir tranquilo. JARVIS en el dashboard sigue usando tu Claude Code, como hasta ahora.

## Paso 1 · Instalar Hermes

Abre **PowerShell** (no hace falta ser administrador) y pega:

```powershell
iex (irm https://hermes-agent.nousresearch.com/install.ps1)
```

Cierra y abre otra ventana de PowerShell y comprueba con `hermes --version`. Se instala en `%LOCALAPPDATA%\hermes`.

> Si el antivirus pone en cuarentena `uv.exe` de la carpeta de Hermes, es un falso positivo conocido (es el gestor de Python que usa Hermes). Consulta la sección de Windows del README de Hermes.

## Paso 2 · Elegir el modelo

```powershell
hermes model
```

Elige **Anthropic**, pega tu API key y escoge Sonnet: es la mejor relación calidad/precio para este uso.

## Paso 3 · Crear el bot de Telegram (solo para ti)

1. En Telegram abre **@BotFather**, envía `/newbot`, ponle nombre (por ejemplo "JARVIS") y un usuario que acabe en `bot`. Te dará un **token** como `123456789:ABC…`. No lo compartas.
2. Abre **@userinfobot** y te dirá tu **ID numérico**.
3. En PowerShell:

```powershell
hermes gateway setup
```

Elige Telegram, pega el token y pon tu ID en la lista de usuarios permitidos. **No la dejes vacía**: si no, cualquiera que encuentre tu bot podría usarlo.

## Paso 4 · Conectarlo con JARVIS

Con el dashboard abierto, ve a **Apps** y pulsa **Configurar Hermes** (o, en la carpeta de JARVIS, `npm run hermes`; con `npm run hermes -- --simular` ves antes qué va a hacer). Hace esto:

- Copia la personalidad de JARVIS (`hermes/SOUL.md`) a Hermes. Si ya tenías un `SOUL.md`, guarda una copia como `SOUL.md.antes-de-jarvis`.
- Añade el MCP `jarvis` a Hermes con `JARVIS_ORIGEN=hermes`, para que lo que llegue por Telegram salga marcado como tal.
- Añade las skills de contenido del vault (`.claude/skills`) como carpeta de skills de Hermes.
- Pone la zona horaria en Europe/Madrid.
- Crea las 4 tareas programadas (si ya existen, no las duplica), que se ejecutan dentro del vault.
- Prueba la conexión con `hermes mcp test jarvis`.

Puedes repetirlo cuando quieras: lo que ya está hecho no lo toca.

## Paso 5 · Avisos y arranque automático

1. Abre el chat con tu bot y envía `/sethome`: ahí te llegarán las tareas programadas.
2. Deja el bot en marcha y que arranque al iniciar sesión en Windows:

```powershell
hermes gateway install
```

Para ver cómo va: `hermes gateway status`. Para pararlo: `hermes gateway stop`.

## Prueba final

Manda a tu bot: **idea: test desde Telegram**. En unos segundos debería aparecer en **Inicio** (actividad), en **Apps → Últimos mensajes por Telegram**, en el pipeline de **Contenido** y como nota en `01-Ideas`.

## Voz

- **Notas de voz que le mandas**: Hermes las transcribe en tu PC con `faster-whisper` (sin clave ni coste).
- **Que te responda con tu voz de ElevenLabs** (opcional): añade `ELEVENLABS_API_KEY` al `.env` de Hermes (`%LOCALAPPDATA%\hermes\.env`) y en `config.yaml` pon `tts.provider: elevenlabs` y `tts.elevenlabs.voice_id` con tu voice ID.

## Cambiar las tareas programadas

Pídeselo a Hermes en el chat ("mueve el plan del día a las 8:15") o usa la terminal:

```powershell
hermes cron list
hermes cron edit jarvis-plan-diario --schedule "15 8 * * *"
hermes cron pause jarvis-competencia-jueves
hermes cron doctor
```

## Seguridad

- Solo responde a los IDs de tu lista de permitidos.
- **No publica nada** y **no gasta dinero**: las campañas solo pueden quedarse en borrador, se crean en pausa cuando tú lo confirmas en el dashboard y el código rechaza cualquier campaña que no esté en pausa.
- Hermes pide permiso antes de ejecutar comandos peligrosos en tu PC. No lo arranques con `--yolo`.
- El token del bot y la API key del modelo viven en el `.env` de Hermes, no en el de JARVIS. El dashboard solo comprueba si existen; nunca lee ni muestra su valor.

## Si algo falla

| Síntoma | Solución |
|---|---|
| `hermes` no se reconoce como comando | Abre una ventana nueva de PowerShell tras instalar |
| Apps dice "Bot parado" | `hermes gateway start` (o `hermes gateway install` para que arranque solo) |
| El bot no ve tus ideas ni métricas | `hermes mcp test jarvis` y vuelve a pulsar **Configurar Hermes** |
| Una tarea programada sale "Falta configurar" | `hermes cron doctor` te dice qué le falta (normalmente la API key del modelo o el `/sethome`) |
| No te llegan las tareas programadas | Envía `/sethome` en el chat con tu bot |
