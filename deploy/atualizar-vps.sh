#!/usr/bin/env bash
# ============================================================
# Atualiza o SisPerícia no VPS (pega a última versão e reinicia).
#
# Uso (um comando só, como root):
#   sudo bash deploy/atualizar-vps.sh
# ou, sem ter o projeto à mão, o comando de uma linha:
#   curl -fsSL https://raw.githubusercontent.com/usuariomaster/NOVO-APP/claude/sei-dispatch-system-7mvzei/deploy/atualizar-vps.sh | sudo bash
#
# Variáveis opcionais:
#   APPDIR=/opt/sispericia   pasta onde o sistema foi instalado
# ============================================================
set -euo pipefail

BRANCH="claude/sei-dispatch-system-7mvzei"
APPDIR="${APPDIR:-/opt/sispericia}"
SERVICO="sispericia"

log() { echo -e "\n\033[1;36m>> $*\033[0m"; }

if [ "$(id -u)" -ne 0 ]; then
  echo "Rode como root:  sudo bash deploy/atualizar-vps.sh"
  exit 1
fi

if [ ! -d "$APPDIR/.git" ]; then
  echo "Não encontrei a instalação em $APPDIR."
  echo "Se instalou em outra pasta, rode:  sudo APPDIR=/sua/pasta bash deploy/atualizar-vps.sh"
  exit 1
fi

cd "$APPDIR"

log "Baixando a última versão do GitHub..."
git fetch origin "$BRANCH"
# Atualiza forçando para a versão do GitHub (descarta edições locais no código,
# mas NÃO toca no banco de dados nem nos arquivos em data/, que ficam de fora).
git reset --hard "origin/$BRANCH"

log "Atualizando as bibliotecas (se mudou algo)..."
npm install --no-audit --no-fund

log "Reiniciando o sistema..."
systemctl restart "$SERVICO"
sleep 2

log "Pronto! Situação do serviço:"
systemctl --no-pager --full status "$SERVICO" | head -n 8 || true

echo
echo -e "\033[1;32m✔ Atualizado.\033[0m Abra o painel no navegador e recarregue a página (Ctrl+F5)."
echo "   Ver logs em tempo real:  journalctl -u $SERVICO -f"
