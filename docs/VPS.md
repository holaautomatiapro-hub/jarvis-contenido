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

El script instala Node 22, JARVIS (en `~/JARVIS`), Chromium (para dibujar los diseños de Contenido → Diseño), Claude Code y Tailscale, y deja JARVIS como servicio: arranca solo y se reinicia si se cae.

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

1. Instala Hermes en el VPS con el instalador de Nous Research para Linux.
2. Configura su modelo como hiciste en el PC (`hermes model`).
3. En `~/JARVIS`, ejecuta `npm run hermes`. Le pone la personalidad, el MCP, las skills y las tareas programadas.
4. Para el bot de Telegram en el PC (`hermes gateway stop`) y arráncalo en el VPS (`hermes gateway`). Así no responden dos.

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
