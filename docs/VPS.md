# JARVIS en un VPS (24 h, también con el PC apagado)

En un VPS JARVIS está siempre encendido: publica en Instagram a su hora, sincroniza métricas y Hermes te contesta por Telegram aunque tu PC esté apagado. Lo abres igual que ahora, en el navegador de tu PC o de tu móvil.

**Seguridad:** JARVIS no se abre a internet. Escucha solo dentro del VPS y llegas a él por **Tailscale**, una red privada y gratuita que solo ven tus dispositivos.

Necesitas:
- un VPS Linux con **Ubuntu** (en Hostinger: hPanel → VPS → Sistema operativo → Ubuntu 22.04 o 24.04) con al menos 2 GB de RAM;
- una cuenta gratuita de **Tailscale** (tailscale.com, puedes entrar con Google).

---

## 1. Entra en el VPS

- **Desde el navegador:** hPanel → VPS → **Terminal del navegador**.
- **Desde tu PC (PowerShell):** `ssh root@IP_DE_TU_VPS`. La IP y la contraseña de root están en hPanel → VPS → Resumen.

## 2. Instala JARVIS

```bash
curl -fsSL https://raw.githubusercontent.com/holaautomatiapro-hub/jarvis-contenido/main/scripts/instalar-vps.sh -o instalar-vps.sh
bash instalar-vps.sh
```

El script instala Node 22, JARVIS (en `~/JARVIS`), Chromium (para dibujar los diseños de Laboratorio → Diseño), lo que necesita el Laboratorio para testimonios y reels (ffmpeg, Python con sus librerías y el modelo de transcripción, ver [LABORATORIO.md](LABORATORIO.md)), Claude Code y Tailscale, y deja JARVIS como servicio: arranca solo y se reinicia si se cae.

## 3. Conecta Tailscale

1. En el VPS:
   ```bash
   tailscale up --hostname=jarvis
   ```
   Abre el enlace que te da y entra con tu cuenta de Tailscale.
2. En [login.tailscale.com/admin/dns](https://login.tailscale.com/admin/dns), activa **MagicDNS** y **HTTPS Certificates**. Son dos botones.
3. Vuelve a ejecutar el instalador: `bash instalar-vps.sh`. Al final te dice la dirección de JARVIS, del tipo **`https://jarvis.tu-red.ts.net`**.
4. Instala Tailscale en tu **PC** (tailscale.com/download) y en tu **móvil** (App Store o Google Play) y entra con la misma cuenta.

Desde entonces, `https://jarvis.tu-red.ts.net` abre JARVIS en cualquiera de tus dispositivos.

## 4. Inicia sesión en Claude Code (una vez)

```bash
claude
```

Elige iniciar sesión con tu cuenta (Pro/Max), abre el enlace en tu PC, pega el código y sal con `/exit`.

## 5. Pasa tus datos del PC al VPS

1. **En el PC** (PowerShell, en la carpeta de JARVIS):
   ```powershell
   git pull
   npm run exportar
   scp JARVIS-copia.tar.gz root@IP_DE_TU_VPS:~/
   ```
   La copia lleva la base de datos (tareas, piezas, métricas, la conexión con Instagram y Meta Ads), tus vídeos, el vault y tus claves. **No la compartas.**
2. **En el VPS:**
   ```bash
   cd ~/JARVIS
   npm run importar-copia -- ~/JARVIS-copia.tar.gz
   sudo systemctl restart jarvis
   rm ~/JARVIS-copia.tar.gz
   ```
3. Borra también la copia del PC.

## 6. Apaga JARVIS en el PC

Así no publican dos JARVIS a la vez. En el PC:

```powershell
powershell -ExecutionPolicy Bypass -File instalar.ps1 -Desinstalar
```

Esto quita el arranque automático y el acceso directo, pero tus datos del PC se quedan. Crea un marcador en el navegador con `https://jarvis.tu-red.ts.net`.

## 7. Hermes (Telegram) en el VPS

Para hablar con JARVIS por Telegram aunque tu PC esté apagado, instala Hermes en el VPS. El paso a paso, con lo que hay que elegir en cada pregunta, está en [HERMES.md → En un VPS](HERMES.md#en-un-vps-linux-paso-a-paso). Lo esencial: no uses las credenciales de Claude Code de JARVIS (una API key propia para Hermes), pon tu ID en los usuarios permitidos, `loginctl enable-linger` para que no se apague al cerrar la sesión y Groq para las notas de voz. Si tenías Hermes en el PC, páralo (`hermes gateway stop`) para que no respondan dos.

---

## Día a día

| Quiero… | En el VPS |
|---|---|
| Ver qué está haciendo | `journalctl -u jarvis -f` |
| Reiniciarlo | `sudo systemctl restart jarvis` |
| Actualizarlo | `bash instalar-vps.sh` (también lo actualiza) |
| Cambiar claves | `cd ~/JARVIS && npm run claves` y reinicia |

## Lo que cambia respecto al PC

- **Obsidian:** el vault vive en el VPS (`~/JARVIS-Vault`). Puedes ver y buscar tus notas en la pestaña **Notas**. Si quieres seguir editándolas con Obsidian en el PC, hay que sincronizar las dos carpetas, por ejemplo con Syncthing (gratis).
- **«Conectar con Facebook»:** desde el VPS la vuelta de Meta va a `https://jarvis.tu-red.ts.net/api/instagram/callback`. Añádela en tu app de Meta, en *URI de redireccionamiento de OAuth válidos*. Pegar un token sigue funcionando igual.
- **Voz:** el micrófono funciona porque Tailscale da HTTPS.

## Contraseña

Con Tailscale solo tus dispositivos llegan a JARVIS. Si además quieres contraseña (imprescindible si en el VPS hay otro JARVIS, el de otra persona):

```bash
cd ~/JARVIS && npm run clave              # ponerla o cambiarla
cd ~/JARVIS && npm run clave -- --quitar  # quitarla
```

Se usa al momento. Al abrir JARVIS te la pide y la sesión dura 180 días en ese navegador; para cerrarla, pulsa tu inicial arriba a la derecha. Cambiarla cierra todas las sesiones y anula el conector de Claude Code: vuelve a instalarlo desde Inicio. El MCP y los scripts del propio VPS siguen funcionando sin hacer nada.

## Otro JARVIS para otra persona (p. ej. tu pareja)

Cada uno con lo suyo: su Instagram, su contenido, su estrategia, su voz, su Claude (su propia suscripción) y su contraseña, en el mismo VPS y sin tocar el tuyo.

```bash
bash ~/JARVIS/scripts/otro-jarvis.sh andrea
```

El script:

1. Crea un usuario de Linux `jarvis-andrea` y su copia de JARVIS en `/home/jarvis-andrea/JARVIS` (con su vault y sus datos).
2. Te pide su contraseña.
3. Lo deja como servicio `jarvis-andrea` en otro puerto (3334, 3335…).
4. Le da su propia dirección de Tailscale: `https://jarvis-andrea.tu-red.ts.net`. Para ello te pide entrar con tu cuenta de Tailscale una vez.

Después:

- **Su Claude:** `sudo -iu jarvis-andrea claude` y que entre con su cuenta (Pro o Max).
- **Su acceso:** en login.tailscale.com/admin/machines, busca `jarvis-andrea` → ⋯ → **Share** y mándale la invitación. Ella instala Tailscale en su móvil y su ordenador, acepta y abre su dirección. Solo verá su JARVIS.
- **Sus claves** (Meta, Supabase, ElevenLabs…): `sudo -u jarvis-andrea -H bash -c 'cd ~/JARVIS && npm run claves'`.
- **Su Instagram:** desde su JARVIS → Instagram. Si usáis la misma app de Meta, añade también `https://jarvis-andrea.tu-red.ts.net/api/instagram/callback`.
- **Tu contraseña:** ponle también contraseña a tu JARVIS (`npm run clave`), porque ahora el VPS es compartido.

Se actualiza solo cuando actualizas el tuyo (desde Inicio o con `instalar-vps.sh`). Para ver qué hace: `journalctl -u jarvis-andrea -f`. Ocupa unos 3 GB más de disco (Laboratorio y Chromium propios), y si los dos exportáis vídeos a la vez el VPS trabaja el doble.
