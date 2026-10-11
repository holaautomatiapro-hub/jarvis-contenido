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
cd "$DIR"
npm ci --no-audit --no-fund --loglevel=error
npm run build --silent >/dev/null
node --disable-warning=ExperimentalWarning scripts/preparar.js --documentos "$HOME" >/dev/null
ok "dependencias, interfaz, vault en $HOME/JARVIS-Vault y base de datos"

paso "Navegador para la sección Diseño"
# Dibuja los carruseles y stories (imágenes y vídeo). Instala Chromium y las librerías y fuentes que necesita.
if npx --yes playwright-core install --with-deps chromium >/dev/null 2>&1; then ok "Chromium listo"
else aviso "No se ha podido instalar Chromium: Contenido → Diseño no podrá dibujar. Prueba:  cd $DIR && npx playwright-core install --with-deps chromium"; fi

paso "Claude Code"
if ! command -v claude >/dev/null; then $SUDO npm install -g @anthropic-ai/claude-code --loglevel=error >/dev/null; fi
ok "claude $(claude --version 2>/dev/null | head -1)"
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
