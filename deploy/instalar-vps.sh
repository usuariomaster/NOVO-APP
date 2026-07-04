#!/usr/bin/env bash
# ============================================================
# SisPerícia — instalador para VPS (Linux)
#
# Instala e coloca o sistema no ar como serviço permanente:
#   - Node.js 20 + ferramentas de build
#   - o código (deste repositório)
#   - o navegador do robô (Chromium do Playwright) + dependências
#   - um serviço systemd que sobe sozinho e reinicia se cair
#
# Uso (como root):
#   sudo bash instalar-vps.sh
#
# Variáveis opcionais:
#   PORT=3000          porta do painel web (padrão 3000)
#   APPDIR=/opt/sispericia   pasta de instalação
# ============================================================
set -euo pipefail

REPO="https://github.com/usuariomaster/NOVO-APP.git"
BRANCH="claude/sei-dispatch-system-7mvzei"
APPDIR="${APPDIR:-/opt/sispericia}"
PORT="${PORT:-3000}"

log() { echo -e "\n\033[1;36m>> $*\033[0m"; }

if [ "$(id -u)" -ne 0 ]; then
  echo "Rode como root:  sudo bash instalar-vps.sh"
  exit 1
fi

# 1) Gerenciador de pacotes
if command -v apt-get >/dev/null 2>&1; then PM=apt
elif command -v dnf >/dev/null 2>&1; then PM=dnf
elif command -v yum >/dev/null 2>&1; then PM=yum
else echo "Distribuição não suportada automaticamente."; exit 1; fi
log "Gerenciador de pacotes: $PM"

# 2) Node.js 20 + git + ferramentas de build
log "Instalando Node.js 20, git e ferramentas de build..."
if [ "$PM" = "apt" ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs git build-essential python3 ca-certificates
else
  curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
  $PM install -y nodejs git gcc gcc-c++ make python3 ca-certificates
fi

# 3) Código do sistema
log "Baixando/atualizando o código em $APPDIR..."
if [ -d "$APPDIR/.git" ]; then
  git -C "$APPDIR" fetch origin "$BRANCH"
  git -C "$APPDIR" reset --hard "origin/$BRANCH"
else
  git clone -b "$BRANCH" "$REPO" "$APPDIR"
fi
cd "$APPDIR"

# 4) Dependências do Node
log "Instalando dependências do sistema..."
npm install

# 5) Navegador do robô (Chromium) + libs do sistema
log "Instalando o navegador do robô (Chromium)..."
npx --yes playwright install --with-deps chromium || npx --yes playwright install chromium

# 6) Configuração (.env) com chave secreta forte
if [ ! -f "$APPDIR/.env" ]; then
  log "Gerando configuração (.env)..."
  SECRET="$(openssl rand -hex 32 2>/dev/null || head -c32 /dev/urandom | base64)"
  cat > "$APPDIR/.env" <<ENV
PORT=$PORT
APP_SECRET=$SECRET
SEI_BASE_URL=https://sei.novaiguacu.rj.gov.br/sei
SEI_HEADFUL=false
ENV
fi

# 7) Serviço systemd (sobe sozinho, reinicia se cair)
log "Configurando o serviço permanente (systemd)..."
NODE_BIN="$(command -v node)"
cat > /etc/systemd/system/sispericia.service <<UNIT
[Unit]
Description=SisPericia - Despachos da Pericia
After=network.target

[Service]
Type=simple
WorkingDirectory=$APPDIR
EnvironmentFile=$APPDIR/.env
ExecStart=$NODE_BIN $APPDIR/server/index.js
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable sispericia
systemctl restart sispericia
sleep 2
systemctl --no-pager --full status sispericia | head -n 12 || true

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
log "PRONTO!"
echo "   Painel:  http://${IP:-SEU_IP}:$PORT"
echo "   Login:   admin@pericia.local  /  admin123  (troque a senha)"
echo
echo "   Ver logs:      journalctl -u sispericia -f"
echo "   Reiniciar:     systemctl restart sispericia"
echo "   Atualizar:     bash $APPDIR/deploy/instalar-vps.sh"
