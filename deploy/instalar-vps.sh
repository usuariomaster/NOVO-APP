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

# 2b) Repositório extra (EPEL), fuso horário e memória swap
log "Preparando o ambiente de produção..."
if [ "$PM" != "apt" ]; then $PM install -y epel-release 2>/dev/null || true; fi
timedatectl set-timezone America/Sao_Paulo 2>/dev/null || true

# Swap: evita o navegador derrubar o servidor por falta de memória (VPS pequeno).
RAM_MB="$(free -m 2>/dev/null | awk '/^Mem:/{print $2}')"
if [ ! -f /swapfile ] && [ "${RAM_MB:-4000}" -lt 3000 ] && ! swapon --show | grep -q .; then
  log "Criando 2GB de swap..."
  fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '/swapfile' /etc/fstab 2>/dev/null || echo '/swapfile none swap sw 0 0' >> /etc/fstab
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

# 5) Bibliotecas do sistema para o Chromium
#    (no RHEL/AlmaLinux o "--with-deps" do Playwright não funciona; instalamos manualmente)
log "Instalando as bibliotecas do navegador..."
if [ "$PM" = "apt" ]; then
  npx --yes playwright install-deps chromium || true
else
  $PM install -y \
    nss nspr atk at-spi2-atk at-spi2-core cups-libs libdrm mesa-libgbm \
    libX11 libXcomposite libXdamage libXext libXfixes libXrandr libXi libXtst \
    libxcb libxkbcommon libxshmfence pango cairo alsa-lib libXScrnSaver gtk3 \
    2>/dev/null || true
  # Fontes (para páginas e PDFs renderizarem sem caixinhas/acentos quebrados)
  $PM install -y \
    dejavu-sans-fonts dejavu-serif-fonts liberation-fonts liberation-narrow-fonts \
    google-noto-sans-fonts google-noto-serif-fonts google-noto-emoji-fonts \
    urw-base35-fonts fontconfig 2>/dev/null || true
fi

log "Baixando o navegador do robô (Chromium)..."
npx --yes playwright install chromium

# 5b) Console web (Cockpit): acessar o servidor pelo navegador, sem PuTTY caindo.
log "Ativando o console web (Cockpit)..."
if [ "$PM" = "apt" ]; then apt-get install -y cockpit || true; else $PM install -y cockpit || true; fi
systemctl enable --now cockpit.socket 2>/dev/null || true

# 5c) Libera as portas no firewall (painel + cockpit + web).
if command -v firewall-cmd >/dev/null 2>&1; then
  log "Liberando portas no firewall..."
  for p in "${PORT}" 80 443 9090; do firewall-cmd --permanent --add-port="${p}/tcp" 2>/dev/null || true; done
  firewall-cmd --reload 2>/dev/null || true
fi

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

# 8) nginx como proxy reverso: acessar na porta 80 (http://IP) e pronto p/ HTTPS.
log "Configurando o nginx (porta 80)..."
if [ "$PM" = "apt" ]; then apt-get install -y nginx || true; else $PM install -y nginx || true; fi
if command -v nginx >/dev/null 2>&1; then
  # tira o "default_server" do nginx.conf de fábrica para o nosso assumir a porta 80
  sed -i 's/ default_server//g' /etc/nginx/nginx.conf 2>/dev/null || true
  cat > /etc/nginx/conf.d/sispericia.conf <<NGINX
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    client_max_body_size 80m;
    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_read_timeout 300s;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX
  if nginx -t 2>/dev/null; then
    systemctl enable nginx 2>/dev/null || true
    systemctl restart nginx 2>/dev/null || true
  else
    echo "   [aviso] nginx não validou; o painel continua na porta $PORT."
    rm -f /etc/nginx/conf.d/sispericia.conf
  fi
fi

# 9) certbot instalado e pronto (para HTTPS quando houver um domínio apontado)
if [ "$PM" != "apt" ]; then $PM install -y certbot python3-certbot-nginx 2>/dev/null || true
else apt-get install -y certbot python3-certbot-nginx 2>/dev/null || true; fi

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
log "PRONTO!"
echo "   Painel web:    http://${IP:-SEU_IP}        (porta 80, via nginx)"
echo "   Painel web:    http://${IP:-SEU_IP}:$PORT     (acesso direto)"
echo "   Login:         admin@pericia.local  /  admin123  (troque a senha)"
echo "   Console web:   https://${IP:-SEU_IP}:9090   (Cockpit — terminal no navegador, não cai)"
echo
echo "   Ver logs:      journalctl -u sispericia -f"
echo "   Reiniciar:     systemctl restart sispericia"
echo "   Atualizar:     bash $APPDIR/deploy/instalar-vps.sh"
echo "   HTTPS (com domínio):  certbot --nginx -d SEU_DOMINIO"
