#!/usr/bin/env bash
# Instala (o actualiza) OTRO JARVIS en este mismo VPS, para otra persona (p. ej. tu pareja): con su propio usuario de
# Linux, su copia de JARVIS y sus datos, su sesión de Claude, su Instagram, su contraseña y su propia dirección
# de Tailscale (https://jarvis-NOMBRE.<tu-red>.ts.net). No toca tu JARVIS.
#
#   bash ~/JARVIS/scripts/otro-jarvis.sh andrea                     instalarlo (o repasarlo: se puede repetir)
#   bash ~/JARVIS/scripts/otro-jarvis.sh andrea --solo-actualizar   ponerlo al día (lo hace solo instalar-vps.sh)
#
# Antes hay que tener instalado el JARVIS principal con instalar-vps.sh (Node, Chromium, Tailscale…).
set -euo pipefail

NOMBRE="${1:-}"
MODO="${2:-}"
paso() { printf '\n\033[1;34m==>\033[0m %s\n' "$1"; }
ok() { printf '    \033[32m✓\033[0m %s\n' "$1"; }
aviso() { printf '    \033[33m!\033[0m %s\n' "$1"; }
[[ "$NOMBRE" =~ ^[a-z][a-z0-9-]{1,20}$ ]] || { echo "Uso: bash otro-jarvis.sh NOMBRE   (en minúsculas, sin espacios ni tildes; p. ej. andrea)"; exit 1; }

SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"
PRINCIPAL="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
REPO="${JARVIS_REPO:-$(git -C "$PRINCIPAL" remote get-url origin 2>/dev/null || echo https://github.com/holaautomatiapro-hub/jarvis-contenido.git)}"
CUENTA="jarvis-$NOMBRE"            # usuario de Linux (y nombre del servicio y de su dirección)
CASA="/home/$CUENTA"
DIR="$CASA/JARVIS"
UNIDAD="/etc/systemd/system/$CUENTA.service"
TS="tailscale-$NOMBRE"
TS_SOCK="/run/$TS/tailscaled.sock"
TITULO="$(printf '%s' "${NOMBRE:0:1}" | tr '[:lower:]' '[:upper:]')${NOMBRE:1}"
NODE_BIN="$(command -v node || true)"
[ -n "$NODE_BIN" ] && command -v git >/dev/null && command -v tailscale >/dev/null || { echo "Primero instala tu JARVIS con  bash ~/instalar-vps.sh  (deja listos Node, Git y Tailscale)."; exit 1; }

# Todo lo de su JARVIS se hace con su usuario (así su Claude no puede ver tus datos ni tú los suyos sin querer)
if command -v sudo >/dev/null; then COMO=(sudo -u "$CUENTA"); else COMO=(runuser -u "$CUENTA" --); fi
como() { "${COMO[@]}" env HOME="$CASA" PATH="$PATH" bash -c "$1"; }

# Su puerto: el que ya tenía o el primero libre desde el 3334
if [ -f "$UNIDAD" ]; then PUERTO="$(sed -n 's/^Environment=PORT=//p' "$UNIDAD")"
else
  PUERTO=3334
  while ss -ltn 2>/dev/null | grep -q ":$PUERTO " || grep -qs "^Environment=PORT=$PUERTO$" /etc/systemd/system/jarvis*.service; do PUERTO=$((PUERTO + 1)); done
fi

# Tus claves y tus datos, solo para ti (el otro JARVIS corre con otro usuario y no debe poder leerlos)
chmod o-rwx "$PRINCIPAL/.env" "$PRINCIPAL/data" 2>/dev/null || $SUDO chmod o-rwx "$PRINCIPAL/.env" "$PRINCIPAL/data" 2>/dev/null || true

paso "JARVIS de $TITULO en $DIR"
id "$CUENTA" >/dev/null 2>&1 || { $SUDO useradd -m -s /bin/bash "$CUENTA"; ok "usuario $CUENTA creado"; }
$SUDO chmod 750 "$CASA"
if [ -d "$DIR/.git" ]; then como "git -C '$DIR' pull --ff-only -q"; ok "actualizado"
else como "git clone -q '$REPO' '$DIR'"; ok "descargado"; fi
como "cd '$DIR' && npm ci --no-audit --no-fund --loglevel=error && npm run build --silent >/dev/null && node --disable-warning=ExperimentalWarning scripts/preparar.js --documentos '$CASA' >/dev/null"
# Su nombre (sale al entrar) y que se actualiza junto con el JARVIS principal
como "cd '$DIR' && node --disable-warning=ExperimentalWarning -e \"import('./server/env-archivo.js').then(m=>m.guardarEnv({JARVIS_NOMBRE:'$TITULO',JARVIS_SECUNDARIO:'1'}))\""
ok "dependencias, interfaz, vault en $CASA/JARVIS-Vault y base de datos"
como "cd '$DIR' && npx --yes playwright-core install chromium >/dev/null 2>&1" && ok "Chromium (Diseño)" || aviso "No se ha podido preparar Chromium para Diseño (repite este comando más tarde)"
if como "bash '$DIR/scripts/preparar-laboratorio.sh' >/dev/null 2>&1"; then ok "Laboratorio (testimonios y reels)"
else aviso "No se ha podido preparar el Laboratorio. Repite:  sudo -u $CUENTA -H bash $DIR/scripts/preparar-laboratorio.sh"; fi

if [ "$MODO" != "--solo-actualizar" ]; then
  paso "Contraseña del JARVIS de $TITULO"
  if como "grep -q '^JARVIS_CLAVE=scrypt:' '$DIR/.env'"; then ok "ya tiene contraseña (para cambiarla:  sudo -u $CUENTA -H bash -c 'cd $DIR && npm run clave')"
  else
    echo "    Ponle una contraseña (la que usará $TITULO para entrar). No se ve al escribirla."
    until como "cd '$DIR' && node --disable-warning=ExperimentalWarning scripts/clave.js"; do echo "    Vuelve a probar."; done
  fi
fi

paso "Servicio $CUENTA (arranca solo)"
PATH_SERVICIO="$(dirname "$NODE_BIN"):$(npm prefix -g)/bin:/usr/local/bin:/usr/bin:/bin"
$SUDO tee "$UNIDAD" >/dev/null <<EOF
# JARVIS extra: lo creó otro-jarvis.sh ($NOMBRE) y se actualiza con instalar-vps.sh
[Unit]
Description=JARVIS de $TITULO
After=network-online.target
Wants=network-online.target

[Service]
User=$CUENTA
WorkingDirectory=$DIR
Environment=HOME=$CASA
Environment=PATH=$PATH_SERVICIO
Environment=PORT=$PUERTO
ExecStart=$NODE_BIN --disable-warning=ExperimentalWarning server/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
$SUDO systemctl daemon-reload
$SUDO systemctl enable -q "$CUENTA"
$SUDO systemctl restart "$CUENTA"
sleep 2
if curl -fsS "http://127.0.0.1:$PUERTO/api/health" >/dev/null; then ok "responde en el VPS (puerto $PUERTO, solo local)"
else aviso "No responde todavía. Mira el error con:  journalctl -u $CUENTA -n 50"; fi
[ "$MODO" = "--solo-actualizar" ] && exit 0

paso "Su dirección de Tailscale: jarvis-$NOMBRE"
# Un segundo Tailscale en el VPS, solo para su JARVIS: así tiene su propio nombre (y lo puedes compartir solo a ella)
TAILSCALED="$(command -v tailscaled || echo /usr/sbin/tailscaled)"
$SUDO tee "/etc/systemd/system/$TS.service" >/dev/null <<EOF
[Unit]
Description=Tailscale del JARVIS de $TITULO
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=$TAILSCALED --tun=userspace-networking --port=0 --statedir=/var/lib/$TS --socket=$TS_SOCK
RuntimeDirectory=$TS
StateDirectory=$TS
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF
$SUDO systemctl daemon-reload
$SUDO systemctl enable -q "$TS"
$SUDO systemctl restart "$TS"
sleep 3
ts() { $SUDO tailscale --socket="$TS_SOCK" "$@"; }
estado() { ts status --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(j.BackendState==="Running"?(j.Self?.DNSName||"").replace(/\.$/,""):"")}catch{}})' || true; }
NOMBRE_TS="$(estado)"
if [ -z "$NOMBRE_TS" ]; then
  echo "    Abre el enlace que sale ahora y entra con TU cuenta de Tailscale (la misma de tu JARVIS):"
  ts up --hostname="jarvis-$NOMBRE"
  NOMBRE_TS="$(estado)"
fi
if [ -n "$NOMBRE_TS" ]; then
  ts serve --bg "$PUERTO" >/dev/null 2>&1 || aviso "Activa HTTPS en tu red (login.tailscale.com/admin/dns → HTTPS Certificates) y repite."
  como "cd '$DIR' && node --disable-warning=ExperimentalWarning -e \"import('./server/env-archivo.js').then(m=>m.guardarEnv({JARVIS_HOSTS:'$NOMBRE_TS'}))\""
  $SUDO systemctl restart "$CUENTA"
  ok "El JARVIS de $TITULO: https://$NOMBRE_TS"
else aviso "Tailscale no se ha conectado. Repite este comando."; fi

paso "Falta"
$SUDO test -f "$CASA/.claude/.credentials.json" || echo "    · Que $TITULO inicie sesión en Claude con SU cuenta (Pro o Max):  sudo -iu $CUENTA claude   (y escribe /login si no lo pide)"
echo "    · Dar acceso a $TITULO: en login.tailscale.com/admin/machines, en «jarvis-$NOMBRE» → ⋯ → Share, y le mandas la invitación."
echo "      Ella instala Tailscale en su móvil y su ordenador, acepta la invitación y abre https://${NOMBRE_TS:-jarvis-$NOMBRE.<tu-red>.ts.net}"
if ! grep -qs '^JARVIS_CLAVE=scrypt:' "$PRINCIPAL/.env"; then
  echo "    · Ponle contraseña también a TU JARVIS (ahora estáis los dos en el mismo VPS):  cd $PRINCIPAL && npm run clave"
fi
echo "    · Sus claves (Meta, Supabase para publicar en Instagram, ElevenLabs…), las suyas o las tuyas si las compartís:"
echo "      sudo -u $CUENTA -H bash -c 'cd $DIR && npm run claves'"
echo "    · Su Instagram: ella entra en su JARVIS → Instagram → Conectar con Facebook (en la app de Meta añade también"
echo "      https://${NOMBRE_TS:-jarvis-$NOMBRE.<tu-red>.ts.net}/api/instagram/callback, o que pegue su token)."
echo "    Ver qué hace:  journalctl -u $CUENTA -f      Se actualiza solo cuando actualizas tu JARVIS."
