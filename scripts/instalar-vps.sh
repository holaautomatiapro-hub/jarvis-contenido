#!/usr/bin/env bash
# Instala (o actualiza) JARVIS en un VPS Linux (Ubuntu o Debian) para que funcione 24 h, también con tu PC apagado.
# Se puede repetir sin miedo: no borra tus datos.
#
#   curl -fsSL https://raw.githubusercontent.com/holaautomatiapro-hub/jarvis-contenido/main/scripts/instalar-vps.sh -o instalar-vps.sh
#   bash instalar-vps.sh
#
# Deja JARVIS como servicio (arranca solo y se reinicia si se cae) escuchando SOLO en el propio VPS.
# Para abrirlo desde tu PC o tu móvil usa Tailscale: una red privada que solo ven tus dispositivos.
set -euo pipefail

REPO="${JARVIS_REPO:-https://github.com/holaautomatiapro-hub/jarvis-contenido.git}"
DIR="${JARVIS_DIR:-$HOME/JARVIS}"
PUERTO="${JARVIS_PUERTO:-3333}"
USUARIO="$(id -un)"
SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"

paso() { printf '\n\033[1;34m==>\033[0m %s\n' "$1"; }
ok() { printf '    \033[32m✓\033[0m %s\n' "$1"; }
aviso() { printf '    \033[33m!\033[0m %s\n' "$1"; }

command -v apt-get >/dev/null || { echo "Este instalador es para Ubuntu o Debian (Hostinger: plantilla Ubuntu 22.04/24.04)."; exit 1; }

paso "Paquetes del sistema"
$SUDO apt-get update -qq
$SUDO apt-get install -y -qq git curl ca-certificates tar >/dev/null
ok "git, curl y tar"

paso "Node.js 22"
version_ok() { command -v node >/dev/null && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=5)?0:1)'; }
if ! version_ok; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO bash - >/dev/null
  $SUDO apt-get install -y -qq nodejs >/dev/null
fi
version_ok || { echo "No se ha podido instalar Node 22.5 o superior."; exit 1; }
ok "Node $(node -v)"

paso "JARVIS en $DIR"
if [ -d "$DIR/.git" ]; then git -C "$DIR" pull --ff-only -q; ok "actualizado"
else git clone -q "$REPO" "$DIR"; ok "descargado"; fi

# Si este instalador es una copia antigua (la que se descargó el primer día), se actualiza y vuelve a empezar
NUEVO="$DIR/scripts/instalar-vps.sh"
if [ -z "${JARVIS_INSTALADOR_ACTUALIZADO:-}" ] && [ -f "$0" ] && [ -f "$NUEVO" ] && ! cmp -s "$0" "$NUEVO"; then
  [ "$(readlink -f "$0")" != "$(readlink -f "$NUEVO")" ] && cp "$NUEVO" "$0" 2>/dev/null || true
  ok "instalador actualizado: sigo con la versión nueva"
  JARVIS_INSTALADOR_ACTUALIZADO=1 exec bash "$NUEVO" "$@"
fi
cd "$DIR"
npm ci --no-audit --no-fund --loglevel=error
npm run build --silent >/dev/null
node --disable-warning=ExperimentalWarning scripts/preparar.js --documentos "$HOME" >/dev/null
ok "dependencias, interfaz, vault en $HOME/JARVIS-Vault y base de datos"

paso "Navegador para la sección Diseño"
# Dibuja los carruseles y stories (imágenes y vídeo). Instala Chromium y las librerías y fuentes que necesita.
LOG_CHROMIUM="$(mktemp)"
if npx --yes playwright-core install --with-deps chromium >"$LOG_CHROMIUM" 2>&1; then ok "Chromium listo"
else
  aviso "No se ha podido instalar Chromium: Laboratorio → Diseño no podrá dibujar. Esto es lo que ha fallado:"
  tail -n 8 "$LOG_CHROMIUM" | sed 's/^/      /'
  aviso "Vuelve a probar con:  cd $DIR && npx playwright-core install --with-deps chromium"
fi
rm -f "$LOG_CHROMIUM"

paso "Laboratorio (testimonios y reels)"
# Python con las librerías del plugin de testimonios y el modelo de transcripción (~2 GB la primera vez)
LOG_LAB="$(mktemp)"
if bash "$DIR/scripts/preparar-laboratorio.sh" >"$LOG_LAB" 2>&1; then sed 's/^/  /' "$LOG_LAB" | grep -F '✓' || true; ok "Laboratorio listo en $HOME/JARVIS-Laboratorio"
else
  aviso "No se ha podido preparar el Laboratorio (testimonios y reels). Esto es lo que ha fallado:"
  tail -n 8 "$LOG_LAB" | sed 's/^/      /'
  aviso "Vuelve a probar con:  bash $DIR/scripts/preparar-laboratorio.sh"
fi
rm -f "$LOG_LAB"

paso "Claude Code"
if ! command -v claude >/dev/null; then $SUDO npm install -g @anthropic-ai/claude-code --loglevel=error >/dev/null; fi
# Al día: las versiones nuevas traen lo que usa JARVIS (p. ej. iniciar sesión en conectores sin navegador)
timeout 180 claude update >/dev/null 2>&1 || true
ok "claude $(claude --version 2>/dev/null | head -1)"
# Conector de Higgsfield (Laboratorio → Imágenes) con tu cuenta: se añade una vez; la sesión se inicia a mano
if ! claude mcp get higgsfield 2>/dev/null | grep -q '^higgsfield:'; then
  claude mcp add --transport http --scope user higgsfield https://mcp.higgsfield.ai/mcp >/dev/null 2>&1 && ok "Conector de Higgsfield añadido"
fi
if claude mcp get higgsfield 2>/dev/null | grep -qi 'needs auth'; then
  aviso "Higgsfield: falta iniciar sesión con tu cuenta. Ejecuta  claude mcp login higgsfield --no-browser  (guía en Laboratorio → Imágenes)"
fi
[ -f "$HOME/.claude/.credentials.json" ] || [ -f "$HOME/.claude.json" ] || aviso "Falta iniciar sesión: ejecuta  claude  una vez y entra con tu cuenta Pro/Max"

paso "Servicio jarvis (arranca solo)"
NODE_BIN="$(command -v node)"
PATH_SERVICIO="$(dirname "$NODE_BIN"):$(npm prefix -g)/bin:/usr/local/bin:/usr/bin:/bin"
$SUDO tee /etc/systemd/system/jarvis.service >/dev/null <<EOF
[Unit]
Description=JARVIS · Sistema Operativo de IA
After=network-online.target
Wants=network-online.target

[Service]
User=$USUARIO
WorkingDirectory=$DIR
Environment=HOME=$HOME
Environment=PATH=$PATH_SERVICIO
Environment=PORT=$PUERTO
ExecStart=$NODE_BIN --disable-warning=ExperimentalWarning server/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
$SUDO systemctl daemon-reload
$SUDO systemctl enable -q jarvis
$SUDO systemctl restart jarvis
sleep 2
if curl -fsS "http://127.0.0.1:$PUERTO/api/health" >/dev/null; then ok "JARVIS responde en el VPS (puerto $PUERTO, solo local)"
else aviso "JARVIS no responde todavía. Mira el error con:  journalctl -u jarvis -n 50"; fi

paso "Tailscale (acceso privado desde tu PC y tu móvil)"
if ! command -v tailscale >/dev/null; then curl -fsSL https://tailscale.com/install.sh | $SUDO sh >/dev/null; fi
NOMBRE="$(tailscale status --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(j.BackendState==="Running"?(j.Self?.DNSName||"").replace(/\.$/,""):"")}catch{}})' || true)"
if [ -z "$NOMBRE" ]; then
  aviso "Tailscale aún no está conectado. Ejecuta:  $SUDO tailscale up --hostname=jarvis"
  aviso "abre el enlace que te da, entra con tu cuenta de Tailscale y vuelve a ejecutar este instalador."
else
  # HTTPS dentro de la red privada (el micrófono del navegador solo funciona con HTTPS)
  $SUDO tailscale serve --bg "$PUERTO" >/dev/null 2>&1 || aviso "Activa HTTPS en tu red: login.tailscale.com/admin/dns → HTTPS Certificates → Enable, y repite."
  node --disable-warning=ExperimentalWarning -e "import('./server/env-archivo.js').then(m=>m.guardarEnv({JARVIS_HOSTS:'$NOMBRE'}))"
  $SUDO systemctl restart jarvis
  ok "JARVIS en https://$NOMBRE (solo desde tus dispositivos con Tailscale)"
fi

paso "Siguiente"
echo "    1. Si no lo has hecho: inicia sesión en Claude Code con  claude"
echo "    2. Trae tus datos del PC:  npm run importar-copia -- ~/JARVIS-copia.tar.gz  y  $SUDO systemctl restart jarvis"
echo "    3. Apaga JARVIS en el PC para que no publique dos veces (guía: docs/VPS.md)"
echo "    Ver qué hace:  journalctl -u jarvis -f      Reiniciar:  $SUDO systemctl restart jarvis"
