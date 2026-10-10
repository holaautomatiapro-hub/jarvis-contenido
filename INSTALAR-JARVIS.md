# Instalar JARVIS con un solo prompt

1. Abre **Claude Code** en tu PC con Windows: la app de escritorio, o una terminal escribiendo `claude`. Si aún no lo tienes, instálalo desde PowerShell con `irm https://claude.ai/install.ps1 | iex` y entra con tu cuenta Pro o Max.
2. Copia el prompt de abajo entero, pégalo y pulsa Enter.
3. Ve aceptando lo que te pida. Tarda unos 5-10 minutos y al final se abre JARVIS en tu navegador.

Las claves (ElevenLabs, Meta, Telegram) **no se pegan en el chat**: el prompt te pedirá que las escribas en una ventana de PowerShell aparte, donde se guardan solo en tu PC.

¿Prefieres hacerlo a mano? Sigue [docs/INSTALACION-WINDOWS.md](docs/INSTALACION-WINDOWS.md).

---

```text
Instala JARVIS (mi sistema operativo de contenido) en este PC con Windows. Ve paso a paso, dime en una frase qué haces antes de cada paso y, si algo falla, para y explícame cómo arreglarlo antes de seguir.

1. Comprueba que tengo Git (git --version). Si no, instálalo con: winget install -e --id Git.Git
2. Clona https://github.com/holaautomatiapro-hub/jarvis-contenido.git en la carpeta JARVIS dentro de mi carpeta de usuario (C:\Users\<yo>\JARVIS). Si ya existe, entra y haz git pull. Si GitHub pide iniciar sesión, avísame para que lo haga en la ventana que se abre.
3. Pregúntame si quiero que instale también Obsidian (para ver mis notas). Después, desde esa carpeta, ejecuta:
   powershell -NoProfile -ExecutionPolicy Bypass -File instalar.ps1
   (añade -InstalarObsidian si te he dicho que sí). Instala Node.js si falta, las dependencias, crea mi vault en Documentos\JARVIS-Vault, deja JARVIS arrancando con Windows y revisa que todo funciona. Resúmeme lo que diga la revisión final.
4. Claves: NO me las pidas por el chat. Dime que abra una ventana nueva de PowerShell, que entre en la carpeta JARVIS y ejecute: npm run claves
   Explícame en dos líneas de dónde sale cada clave (ElevenLabs: API key y voice ID; Meta: App ID y clave secreta, guía en docs/INSTAGRAM.md; cuenta publicitaria act_…) y que puedo saltarme las que aún no tenga con Enter. Espera a que te diga "listo" y entonces ejecuta:
   powershell -NoProfile -ExecutionPolicy Bypass -File instalar.ps1 -Reiniciar
5. Instagram: léete docs/INSTAGRAM.md y guíame, paso a paso y esperando mi confirmación en cada uno, para crear la app de Meta (si aún no la tengo) y conectar mi cuenta desde la pestaña Instagram del dashboard (http://localhost:3333/#instagram). Si prefiero dejarlo para más tarde, sáltalo.
6. Telegram (Hermes): pregúntame si quiero usar JARVIS desde el móvil ahora. Si digo que sí, sigue docs/HERMES.md: instala Hermes, avísame de que necesita su propia API key (coste aparte de mi suscripción) y dime que ejecute yo, en mi ventana de PowerShell, hermes model y hermes gateway setup (son interactivos). Cuando te diga "listo", ejecuta npm run hermes y después hermes gateway install, y pídeme que mande "idea: test desde Telegram" a mi bot para comprobar que aparece en el dashboard.
7. Al final ejecuta npm run doctor y dame un resumen corto: qué está listo, qué falta y el siguiente paso para cada cosa que falte.

Reglas: no instales nada que no esté en estos pasos sin preguntarme; no uses permisos de administrador (si al instalar Git o Node.js Windows me pide permiso, avísame para que lo acepte yo); no borres ni sobrescribas mis archivos, y no me pidas contraseñas ni claves por el chat.
```
