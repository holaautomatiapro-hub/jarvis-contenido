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

## En un VPS (Linux), paso a paso

Si JARVIS vive en un VPS (ver [VPS.md](VPS.md)), instala Hermes ahí: así te contesta aunque tu PC esté apagado. Es lo mismo que en Windows, con estas diferencias, comprobadas en un VPS real:

**Antes de empezar** ten a mano tres cosas (ninguna se pega en un chat ni sale en una captura): el **token del bot** (de @BotFather), tu **ID de Telegram** (en Telegram Web, abre *Mensajes guardados*: es el número que sale tras `#` en la barra de direcciones) y una **API key de Anthropic solo para Hermes** (console.anthropic.com → API Keys; una key por uso, así puedes cambiar una sin tocar las demás).

1. **Entra al VPS** con el usuario de JARVIS (el que tiene `~/JARVIS`; si lo instalaste como root, `root`). Con Tailscale vale el nombre de tu JARVIS:
   ```bash
   ssh root@jarvis.tu-red.ts.net
   ```
2. **Instala Hermes:**
   ```bash
   curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
   ```
   Cierra la sesión, vuelve a entrar y comprueba `hermes --version`. Al acabar abre un asistente:
   - *Import your setup from Claude Code?* → **No** (lo de JARVIS lo pone `npm run hermes`).
   - *How would you like to set up Hermes?* → **Full setup** (Quick Setup usa una cuenta de Nous Portal).
   - *Anthropic credentials* → **Cancel**. «Use existing credentials» es la sesión de Claude Code de JARVIS: si Hermes la usa, puede dejar a JARVIS sin sesión al renovarla y, con Max, se cobra como uso extra. La key va en el paso 3.
   - *Terminal backend* → **Keep current (local)**. *Messaging platforms*: déjalo para el paso 4.
   - *Tools*: desmarca **Computer Use** (el VPS no tiene pantalla) e **Image Generation** (las imágenes las hace JARVIS). *Browser* → **Local Browser**. *TTS* → **Microsoft Edge TTS**. *Search* → **Exa · Free (keyless)** (o DuckDuckGo). Lo que pida una clave de otro servicio, en blanco. Telemetría: **No thanks**.
3. **La API key, y solo ella:**
   ```bash
   hermes auth add anthropic --type api-key --priority 0
   hermes auth list anthropic
   ```
   Si en la lista sale también `claude_code`, quítalo con `hermes auth remove anthropic <número>` (no vuelve a añadirse solo). Luego `hermes model` → Anthropic → *Use existing credentials* (ya solo queda tu key) → **Sonnet**.
4. **El bot de Telegram:** `hermes gateway setup` → marca **Telegram** con la barra espaciadora (si solo pulsas Enter no se marca) → **2 (Manual)** → pega el token → tu ID en *Allowed user IDs* (**nunca vacío**: vacío, cualquiera que encuentre el bot podría usar tu JARVIS) → *home channel* con tu ID: **y** (así no hace falta `/sethome`) → reiniciar: **y**.
5. **Únelo a JARVIS:**
   ```bash
   cd ~/JARVIS && npm run hermes
   ```
   Tarda un par de minutos; acaba con «Listo.» y todos los pasos con ✓.
6. **Que no se apague al cerrar la sesión:**
   ```bash
   loginctl enable-linger root   # o el usuario de JARVIS
   hermes gateway restart
   ```
   Prueba: cierra la terminal, espera un minuto y escríbele al bot.
7. **Notas de voz con Groq** (en el VPS la transcripción local no viene lista; Groq es gratis para este uso y rápido). Crea una clave en console.groq.com → API Keys y guárdala sin que se vea ni quede en el historial (pega la clave cuando se quede esperando y pulsa Enter):
   ```bash
   read -rs CLAVE && echo "GROQ_API_KEY=$CLAVE" >> ~/.hermes/.env && unset CLAVE && echo "✓ guardada"
   hermes config set stt.enabled true
   hermes config set stt.provider groq --force
   hermes config set stt.groq.language es
   hermes gateway restart
   ```

Si ya tenías un bot de Hermes en el PC, páralo (`hermes gateway stop`) para que no respondan dos, o crea otro bot. Si tienes otro bot para otra cosa (por ejemplo, para tus clientes), no lo toques y no uses su token aquí: un token solo puede usarlo un programa, y tus clientes estarían hablando con tu JARVIS.

### El JARVIS de otra persona en el mismo VPS

Si montaste un segundo JARVIS con `otro-jarvis.sh` (p. ej. `jarvis-andrea`), su Hermes es aparte, con **su propio bot, su ID y su key**. Haz los mismos pasos como su usuario:

```bash
sudo -iu jarvis-andrea     # entra como ella; desde aquí, pasos 2 a 5 y 7
exit
sudo loginctl enable-linger jarvis-andrea
```

## Prueba final

Manda a tu bot: **idea: test desde Telegram**. En unos segundos debería aparecer en **Inicio** (actividad), en **Apps → Últimos mensajes por Telegram**, en el pipeline de **Contenido** y como nota en `01-Ideas`.

## Voz

- **Notas de voz que le mandas**: en Windows, Hermes las transcribe en tu PC con `faster-whisper` (sin clave ni coste). En el VPS, con Groq (paso 7 de arriba).
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
- Antes de mandar una captura a alguien (o a un chat de IA), mira que no se vea un token ni una clave. Si se ha visto: el token del bot se cambia en @BotFather con `/revoke` (y luego `hermes gateway setup`); la key de Anthropic, creando otra y borrando la vieja en la consola.

## Si algo falla

| Síntoma | Solución |
|---|---|
| `hermes` no se reconoce como comando | Abre una ventana nueva de PowerShell tras instalar |
| Apps dice "Bot parado" | `hermes gateway start` (o `hermes gateway install` para que arranque solo) |
| El bot no ve tus ideas ni métricas | `hermes mcp test jarvis` y vuelve a pulsar **Configurar Hermes** |
| Una tarea programada sale "Falta configurar" | `hermes cron doctor` te dice qué le falta (normalmente la API key del modelo o el `/sethome`) |
| No te llegan las tareas programadas | Envía `/sethome` en el chat con tu bot |
| En el VPS deja de contestar al cerrar la sesión | `loginctl enable-linger root` (o el usuario de JARVIS) y `hermes gateway restart` |
| «No puedo transcribir la nota de voz» | Paso 7 (Groq) de «En un VPS» y `hermes gateway restart` |
| El chat de JARVIS dice que no tiene sesión de Claude después de instalar Hermes | Hermes está usando la sesión de Claude Code: `hermes auth list anthropic`, quita `claude_code` y vuelve a entrar en Claude en el VPS (`claude`, `/login`) |
| `hermes` no se reconoce en el VPS | Cierra la sesión y vuelve a entrar (o `source ~/.bashrc`) |
