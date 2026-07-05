#!/usr/bin/env bash
# ============================================================
# SisPerícia — publica o painel num DOMÍNIO com HTTPS (Let's Encrypt)
#
# Deixa o sistema acessível em https://pericia.juntamedicani.com.br
# (nginx como proxy reverso -> Node na porta interna + certificado TLS).
#
# PRÉ-REQUISITO (uma vez, no painel de DNS do domínio):
#   criar um registro  A   pericia.juntamedicani.com.br  ->  69.6.251.217
#   (propaga em minutos; o script confere isso antes de pedir o certificado)
#
# Uso (como root, no VPS):
#   sudo bash deploy/publicar-dominio.sh
# ou com outro domínio:
#   sudo DOMINIO=meu.dominio.com.br bash deploy/publicar-dominio.sh
#
# Variáveis opcionais:
#   DOMINIO   domínio a publicar   (padrão pericia.juntamedicani.com.br)
#   EMAIL     e-mail do Let's Encrypt (avisos de expiração)
#   APPDIR    pasta do sistema     (padrão /opt/sispericia)
#   PORT      porta interna do Node (padrão lida do .env, senão 3000)
# ============================================================
set -euo pipefail

DOMINIO="${DOMINIO:-${1:-pericia.juntamedicani.com.br}}"
EMAIL="${EMAIL:-cpfinf@gmail.com}"
APPDIR="${APPDIR:-/opt/sispericia}"
IPESPERADO="69.6.251.217"

log()  { echo -e "\n\033[1;36m>> $*\033[0m"; }
erro() { echo -e "\033[1;31m✖ $*\033[0m"; }
ok()   { echo -e "\033[1;32m✔ $*\033[0m"; }

if [ "$(id -u)" -ne 0 ]; then
  echo "Rode como root:  sudo bash deploy/publicar-dominio.sh"
  exit 1
fi

# Porta interna: lê do .env se existir; senão 3000.
PORT="${PORT:-$(grep -oP '^PORT=\K[0-9]+' "$APPDIR/.env" 2>/dev/null || echo 3000)}"

# 1) Gerenciador de pacotes + nginx/certbot instalados.
if command -v apt-get >/dev/null 2>&1; then PM=apt
elif command -v dnf >/dev/null 2>&1; then PM=dnf
else PM=yum; fi

log "Garantindo nginx e certbot instalados..."
if [ "$PM" = "apt" ]; then
  apt-get install -y nginx certbot python3-certbot-nginx >/dev/null 2>&1 || true
else
  $PM install -y nginx certbot python3-certbot-nginx >/dev/null 2>&1 || true
fi
systemctl enable nginx >/dev/null 2>&1 || true

# 2) Firewall: libera 80 e 443.
if command -v firewall-cmd >/dev/null 2>&1; then
  for p in 80 443; do firewall-cmd --permanent --add-port="${p}/tcp" >/dev/null 2>&1 || true; done
  firewall-cmd --reload >/dev/null 2>&1 || true
fi

# 3) Confere se o DNS do domínio já aponta para este servidor.
log "Conferindo o DNS de $DOMINIO ..."
RESOLVIDO="$(getent hosts "$DOMINIO" 2>/dev/null | awk '{print $1}' | head -n1)"
if [ -z "$RESOLVIDO" ]; then RESOLVIDO="$(command -v dig >/dev/null 2>&1 && dig +short "$DOMINIO" A | tail -n1 || true)"; fi
if [ "$RESOLVIDO" != "$IPESPERADO" ]; then
  erro "O domínio ainda NÃO aponta para $IPESPERADO (resolveu para: ${RESOLVIDO:-nada})."
  echo "   Crie no DNS:  A   $DOMINIO   ->   $IPESPERADO"
  echo "   Depois que propagar (alguns minutos), rode este script de novo."
  echo "   Vou configurar o nginx mesmo assim; só o HTTPS fica pendente até o DNS propagar."
  DNS_OK=0
else
  ok "DNS certo: $DOMINIO -> $RESOLVIDO"
  DNS_OK=1
fi

# 4) Bloco nginx dedicado ao domínio (proxy para o Node).
log "Configurando o nginx para $DOMINIO ..."
cat > /etc/nginx/conf.d/sispericia-dominio.conf <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMINIO};
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

# O bloco padrão (server_name _) pode estar como default_server na porta 80 —
# isso é ok: o nginx roteia pelo Host, então nosso domínio tem prioridade.
if nginx -t 2>/dev/null; then
  systemctl restart nginx
  ok "nginx no ar (http://$DOMINIO)"
else
  erro "nginx não validou a configuração. Verifique com: nginx -t"
  exit 1
fi

# 5) HTTPS com Let's Encrypt (só se o DNS já estiver apontando).
if [ "$DNS_OK" = "1" ]; then
  log "Emitindo o certificado HTTPS (Let's Encrypt)..."
  if certbot --nginx -d "$DOMINIO" --non-interactive --agree-tos -m "$EMAIL" --redirect; then
    systemctl reload nginx || true
    ok "HTTPS ativo!"
    echo
    ok "PRONTO — abra:  https://$DOMINIO"
    echo "   Login:  admin@pericia.local  /  admin123  (troque a senha)"
    echo "   Renovação do certificado: automática (certbot.timer)."
  else
    erro "Falha ao emitir o certificado. O site segue em http://$DOMINIO."
    echo "   Cheque se as portas 80/443 estão liberadas no provedor e tente de novo:"
    echo "   sudo certbot --nginx -d $DOMINIO"
  fi
else
  echo
  echo "   Site já responde em:  http://$DOMINIO"
  echo "   Assim que o DNS apontar para $IPESPERADO, rode de novo para ligar o HTTPS."
fi
