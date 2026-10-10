# Instalar JARVIS en Windows (a mano)

La forma más cómoda es el prompt de [INSTALAR-JARVIS.md](../INSTALAR-JARVIS.md): Claude Code hace estos pasos por ti. Si prefieres hacerlo tú, son estos.

## Lo que necesitas

| Qué | Para qué | ¿Obligatorio? |
|---|---|---|
| Windows 10 u 11 con Chrome o Edge | El dashboard y el micrófono | Sí |
| [Claude Code](https://claude.ai/code) con tu cuenta Pro o Max | El motor de JARVIS | Sí |
| Node.js 22.5 o superior | Ejecutar JARVIS (el instalador lo pone si falta) | Sí |
| Git | Descargar JARVIS y actualizarlo | Sí |
| [Obsidian](https://obsidian.md) | Ver y editar tus notas | Recomendado |
| Cuenta de ElevenLabs | Voz de JARVIS y transcripción de tus reels | Opcional |
| App de Meta for Developers | Métricas de Instagram, competencia y Meta Ads | Opcional |
| Bot de Telegram y API key para Hermes | Usar JARVIS desde el móvil | Opcional |

## 1. Claude Code

En PowerShell:

```powershell
irm https://claude.ai/install.ps1 | iex
```

Abre una ventana nueva, escribe `claude` y entra con tu cuenta. Con hacerlo una vez basta.

## 2. Descargar JARVIS

```powershell
winget install -e --id Git.Git        # solo si no tienes Git
cd $HOME
git clone https://github.com/holaautomatiapro-hub/jarvis-contenido.git JARVIS
cd JARVIS
```

## 3. Instalar

```powershell
powershell -ExecutionPolicy Bypass -File instalar.ps1 -InstalarObsidian
```

(Quita `-InstalarObsidian` si ya lo tienes o no lo quieres.) El instalador:

- instala Node.js LTS con winget si falta o es antiguo (Windows te pedirá permiso);
- comprueba que tienes Claude Code (si no, te dice cómo instalarlo; no descarga ni ejecuta nada por su cuenta);
- instala las dependencias y prepara la interfaz;
- crea `.env`, tu vault en `Documentos\JARVIS-Vault` (también si Documentos está en OneDrive) y la base de datos;
- deja JARVIS arrancando al iniciar sesión (una ventana **JARVIS** minimizada en la barra de tareas: si la cierras, se para) y crea el acceso directo **JARVIS** en el escritorio;
- arranca JARVIS, lo revisa (`npm run doctor`) y lo abre en el navegador.

Puedes repetirlo cuando quieras (por ejemplo, después de un `git pull` para actualizar): nunca borra tus notas, datos ni claves.

## 4. Claves

```powershell
npm run claves
```

Te las pide una a una (Enter deja la que hay; las secretas no se ven al escribirlas) y las guarda en `.env`, en tu PC:

| Clave | Dónde se consigue |
|---|---|
| `ELEVENLABS_API_KEY` | [elevenlabs.io](https://elevenlabs.io) → Developers → API Keys |
| `ELEVENLABS_VOICE_ID` | Con la clave puesta, te enseña tus voces y eliges por número |
| `META_APP_ID` y `META_APP_SECRET` | developers.facebook.com → tu app → Configuración → Básica ([docs/INSTAGRAM.md](INSTAGRAM.md)) |
| `META_AD_ACCOUNT_ID` | Administrador de anuncios → número de la cuenta ([docs/META-ADS.md](META-ADS.md)) |
| `COMPETIDORES` | Usuarios de Instagram separados por comas |

Después, reinicia JARVIS para que las use:

```powershell
powershell -ExecutionPolicy Bypass -File instalar.ps1 -Reiniciar
```

## 5. Conectar Instagram, Meta Ads y Telegram

- **Instagram**: pestaña Instagram → **Conectar con Facebook** ([docs/INSTAGRAM.md](INSTAGRAM.md)).
- **Meta Ads**: pestaña Meta Ads → elige la cuenta publicitaria ([docs/META-ADS.md](META-ADS.md)).
- **Telegram**: [docs/HERMES.md](HERMES.md).

## Día a día

| Quiero… | Cómo |
|---|---|
| Abrir JARVIS | Acceso directo **JARVIS** del escritorio, o http://localhost:3333 |
| Reiniciarlo | `powershell -ExecutionPolicy Bypass -File instalar.ps1 -Reiniciar` |
| Pararlo | `... instalar.ps1 -Parar` |
| Abrirlo con la ventana visible (para ver errores) | Doble clic en `iniciar-jarvis.bat` |
| Ver qué falta | `npm run doctor` |
| Actualizarlo | `git pull` y vuelve a ejecutar `instalar.ps1` |
| Que no arranque con Windows | `... instalar.ps1 -SinAutoarranque` |
| Quitarlo del arranque y el escritorio | `... instalar.ps1 -Desinstalar` (tus datos se quedan) |

## Si algo falla

| Síntoma | Solución |
|---|---|
| "No se puede cargar el archivo instalar.ps1 porque la ejecución de scripts está deshabilitada" | Usa siempre `powershell -ExecutionPolicy Bypass -File instalar.ps1` (solo afecta a esa ejecución) |
| `node`, `claude` o `git` "no se reconoce" justo después de instalarlos | Cierra y abre PowerShell |
| "El puerto 3333 ya está en uso" | JARVIS ya está abierto. Si es otro programa, cambia `PORT` en `.env` y ejecuta `instalar.ps1` |
| El dashboard abre pero JARVIS no contesta | Ejecuta `claude` en una terminal y comprueba que tienes la sesión iniciada |
| No arranca al iniciar Windows | Abre la ventana JARVIS de la barra de tareas para ver el error y ejecuta `npm run doctor` |
| El antivirus bloquea `instalar.ps1` | Descarga la última versión (`git pull`): ya no descarga ni ejecuta nada de internet ni crea scripts ocultos. Si aun así lo bloquea, avísanos y no lo permitas a ciegas |
| Obsidian no encuentra el vault | Obsidian → "Abrir carpeta como vault" → `Documentos\JARVIS-Vault` |
