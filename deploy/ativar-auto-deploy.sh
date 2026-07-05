#!/usr/bin/env bash
# ============================================================
# Ativa o AUTO-DEPLOY (VPS integrada): a VPS passa a puxar sozinha
# a última versão do GitHub e reiniciar o sistema — sem você colar
# comando nenhum. Rode UMA VEZ (como root):
#
#   curl -fsSL https://raw.githubusercontent.com/usuariomaster/NOVO-APP/claude/sei-dispatch-system-7mvzei/deploy/ativar-auto-deploy.sh | sudo bash
#
# A partir daí, toda atualização entra no ar em até ~2 minutos.
# Para DESLIGAR:  sudo systemctl disable --now sispericia-deploy.timer
#
# Variáveis opcionais:
#   APPDIR=/opt/sispericia    pasta da instalação
#   INTERVALO=2min            de quanto em quanto tempo verifica
# ============================================================
set -euo pipefail

BRANCH="claude/sei-dispatch-system-7mvzei"
APPDIR="${APPDIR:-/opt/sispericia}"
INTERVALO="${INTERVALO:-2min}"
SERVICO="sispericia"

log() { echo -e "\n\033[1;36m>> $*\033[0m"; }

if [ "$(id -u)" -ne 0 ]; then
  echo "Rode como root:  sudo bash deploy/ativar-auto-deploy.sh"
  exit 1
fi
if [ ! -d "$APPDIR/.git" ]; then
  echo "Não encontrei a instalação em $APPDIR. Rode com: sudo APPDIR=/sua/pasta bash ..."
  exit 1
fi

# 1) Script que verifica se há versão nova e, se houver, atualiza e reinicia.
log "Criando o verificador de atualização..."
install -d /usr/local/bin
cat > /usr/local/bin/sispericia-deploy.sh <<SCRIPT
#!/usr/bin/env bash
set -euo pipefail
cd "$APPDIR"
git fetch --quiet origin "$BRANCH" || exit 0
LOCAL=\$(git rev-parse HEAD 2>/dev/null || echo x)
REMOTO=\$(git rev-parse "origin/$BRANCH" 2>/dev/null || echo y)
if [ "\$LOCAL" = "\$REMOTO" ]; then exit 0; fi   # já está atualizado
echo "[\$(date '+%F %T')] Nova versão detectada — atualizando..."
git reset --hard "origin/$BRANCH"
npm install --no-audit --no-fund --silent || true
systemctl restart "$SERVICO"
echo "[\$(date '+%F %T')] Atualizado para \$REMOTO."
SCRIPT
chmod +x /usr/local/bin/sispericia-deploy.sh

# 2) Serviço + timer do systemd que roda o verificador periodicamente.
log "Instalando o serviço e o timer (a cada $INTERVALO)..."
cat > /etc/systemd/system/sispericia-deploy.service <<UNIT
[Unit]
Description=SisPericia - verifica e aplica atualizacoes do GitHub
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/sispericia-deploy.sh
UNIT

cat > /etc/systemd/system/sispericia-deploy.timer <<UNIT
[Unit]
Description=SisPericia - auto-deploy periodico

[Timer]
OnBootSec=1min
OnUnitActiveSec=$INTERVALO
Persistent=true

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now sispericia-deploy.timer

log "Rodando uma verificação agora..."
/usr/local/bin/sispericia-deploy.sh || true

echo
echo -e "\033[1;32m✔ Auto-deploy ATIVADO.\033[0m A VPS agora atualiza sozinha a cada $INTERVALO."
echo "   Ver estado:     systemctl status sispericia-deploy.timer"
echo "   Ver histórico:  journalctl -u sispericia-deploy.service -n 30 --no-pager"
echo "   Desligar:       systemctl disable --now sispericia-deploy.timer"
