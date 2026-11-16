#!/usr/bin/env bash
# =============================================================================
# Configurações do Sistema de Agendamento pelo terminal (instalado pelo instalar.sh)
#
#   sudo agendamento-config          menu
#   sudo agendamento-config ver      só mostra a configuração (senhas escondidas)
#
# Altera o /opt/agendamento/.env sem precisar abrir o arquivo e reinicia o sistema no fim.
# =============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/agendamento}"
ENV_FILE="$APP_DIR/.env"
SQLCMD=/opt/mssql-tools18/bin/sqlcmd
MUDOU=0

verde()   { printf '\033[1;32m%s\033[0m\n' "$*"; }
amarelo() { printf '\033[1;33m%s\033[0m\n' "$*"; }
erro()    { printf '\033[1;31m%s\033[0m\n' "$*" >&2; }

[[ $EUID -eq 0 ]] || { erro "Use com sudo: sudo agendamento-config"; exit 1; }
[[ -f "$ENV_FILE" ]] || { erro "Não achei $ENV_FILE. Rode o instalar.sh antes."; exit 1; }

# ---------- Ler e gravar no .env ----------
le() { grep -s "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | sed 's/^"//; s/"$//' || true; }

grava() {   # grava CHAVE VALOR (troca a linha se existir, senão acrescenta). Mantém dono e permissão do arquivo.
  local novo="$ENV_FILE.novo"
  K="$1" V="$2" awk 'BEGIN { k = ENVIRON["K"]; v = ENVIRON["V"]; achou = 0 }
    index($0, k "=") == 1 { print k "=" v; achou = 1; next } { print }
    END { if (!achou) print k "=" v }' "$ENV_FILE" > "$novo"
  cat "$novo" > "$ENV_FILE" && rm -f "$novo"
  MUDOU=1
}

esconde() { local v="$1"; [[ -z "$v" ]] && echo "(vazio)" || echo "${v:0:3}••• (${#v} caracteres)"; }
pergunta() { local r; read -rp "$1" r; echo "$r"; }
pergunta_oculta() { local r; read -rsp "$1" r; echo >&2; echo "$r"; }
gera() { openssl rand -hex "${1:-16}"; }

# ---------- Ações ----------
ver() {
  local url modo
  url="$(le DATABASE_URL)"
  modo="$(le MODO_APRESENTACAO)"; [[ -n "$modo" ]] || modo="$(le RECUPERACAO_MOSTRA_LINK)"
  echo
  verde "Configuração atual ($ENV_FILE)"
  printf '  %-26s %s\n' "Banco (usuário)" "$(sed -E 's#^[^:]+://([^:]+):.*#\1#' <<<"$url")"
  printf '  %-26s %s\n' "Banco (senha)" "$(esconde "$(sed -E 's#^[^:]+://[^:]+:([^@]*)@.*#\1#' <<<"$url")")"
  printf '  %-26s %s\n' "Chave secreta (sessões)" "$(esconde "$(le SECRET_KEY)")"
  printf '  %-26s %s\n' "Chave da administração" "$(le ADMIN_KEY)"
  printf '  %-26s %s\n' "E-mail: servidor" "$(le SMTP_HOST):$(le SMTP_PORT)"
  printf '  %-26s %s\n' "E-mail: usuário" "$(le SMTP_USER)"
  printf '  %-26s %s\n' "E-mail: senha" "$(esconde "$(le SMTP_PASSWORD)")"
  printf '  %-26s %s\n' "E-mail: remetente" "$(le SMTP_FROM)"
  printf '  %-26s %s\n' "Modo apresentação" "$([[ "$modo" == "1" ]] && echo "LIGADO" || echo "desligado")"
  echo
}

chave_admin() {
  echo "Chave atual: $(le ADMIN_KEY)"
  local op; op="$(pergunta "[g] gerar uma nova  [d] digitar  [Enter] voltar: ")"
  case "$op" in
    g) grava ADMIN_KEY "$(gera 8)"; verde "Nova chave: $(le ADMIN_KEY)" ;;
    d) local c; c="$(pergunta "Nova chave (mín. 8 caracteres, sem espaços): ")"
       if [[ ${#c} -ge 8 && "$c" =~ ^[^[:space:]\"]+$ ]]; then grava ADMIN_KEY "$c"; verde "Chave alterada."; else erro "Chave inválida."; fi ;;
  esac
}

email() {
  echo "Deixe em branco para manter o valor atual. Gmail: smtp.gmail.com, porta 587 e uma \"senha de app\"."
  local v
  v="$(pergunta "Servidor [$(le SMTP_HOST)]: ")";        [[ -n "$v" ]] && grava SMTP_HOST "$v"
  v="$(pergunta "Porta [$(le SMTP_PORT)]: ")";           [[ "$v" =~ ^[0-9]+$ ]] && grava SMTP_PORT "$v"
  v="$(pergunta "Usuário [$(le SMTP_USER)]: ")";         [[ -n "$v" ]] && grava SMTP_USER "$v"
  v="$(pergunta_oculta "Senha (não aparece ao digitar): ")"
  if [[ -n "$v" ]]; then
    if [[ "$v" == *\"* ]]; then erro "A senha não pode ter aspas (\")."; else grava SMTP_PASSWORD "\"$v\""; fi
  fi
  v="$(pergunta "Remetente [$(le SMTP_FROM)]: ")";       [[ -n "$v" ]] && grava SMTP_FROM "$v"
  v="$(pergunta "Enviar um e-mail de teste para (Enter pula): ")"
  if [[ -n "$v" ]]; then
    if (cd "$APP_DIR" && sudo -u agendamento PARA="$v" "$APP_DIR/.venv/bin/python" -c \
        'import os; from app import correio; raise SystemExit(0 if correio.envia(os.environ["PARA"], "Teste - Agenda da Coordenação", "E-mail de teste: a configuração funciona.") else 1)'); then
      verde "E-mail de teste enviado para $v."
    else
      erro "Não foi possível enviar. Confira os dados; a rede pode estar bloqueando a porta $(le SMTP_PORT)."
    fi
  fi
}

apresentacao() {
  local atual; atual="$(le MODO_APRESENTACAO)"; [[ -n "$atual" ]] || atual="$(le RECUPERACAO_MOSTRA_LINK)"
  if [[ "$atual" == "1" ]]; then
    grava MODO_APRESENTACAO 0; grava RECUPERACAO_MOSTRA_LINK 0; verde "Modo apresentação DESLIGADO."
  else
    amarelo "Liga o atalho para a administração e mostra o link de \"Esqueci a senha\" na tela."
    amarelo "Use só durante a apresentação: qualquer pessoa poderia redefinir a senha de qualquer e-mail."
    [[ "$(pergunta "Ligar? [s/N]: ")" == "s" ]] && { grava MODO_APRESENTACAO 1; grava RECUPERACAO_MOSTRA_LINK 1; verde "Modo apresentação LIGADO."; }
  fi
}

senha_banco() {
  local url usuario nova sa
  url="$(le DATABASE_URL)"
  usuario="$(sed -E 's#^[^:]+://([^:]+):.*#\1#' <<<"$url")"
  [[ "$usuario" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || { erro "Não entendi o usuário do banco no .env."; return; }
  echo "Gera uma senha nova para o usuário '$usuario' do banco e atualiza o .env."
  sa="$(pergunta_oculta "Senha do administrador do SQL Server (sa): ")"
  nova="$(gera 16)Aa1"                                   # só letras e números: entra na URL sem escape
  if "$SQLCMD" -C -I -S localhost -U sa -P "$sa" -b -Q "ALTER LOGIN [$usuario] WITH PASSWORD = '$nova';" >/dev/null; then
    grava DATABASE_URL "$(sed -E "s#^([^:]+://[^:]+:)[^@]*(@.*)#\1${nova}\2#" <<<"$url")"
    verde "Senha do banco trocada."
  else
    erro "O SQL Server recusou (senha do sa errada?). Nada foi alterado."
  fi
}

senha_sa() {
  amarelo "O SQL Server será parado por alguns segundos (o sistema fica fora do ar nesse tempo)."
  [[ "$(pergunta "Continuar? [s/N]: ")" == "s" ]] || return
  systemctl stop agendamento mssql-server
  /opt/mssql/bin/mssql-conf set-sa-password || erro "A senha não foi trocada."
  systemctl start mssql-server agendamento
}

chave_secreta() {
  amarelo "Uma chave secreta nova desconecta todo mundo e invalida links de \"Esqueci a senha\" já enviados."
  [[ "$(pergunta "Gerar? [s/N]: ")" == "s" ]] && { grava SECRET_KEY "$(gera 32)"; verde "Chave secreta trocada."; }
}

reinicia() {
  [[ $MUDOU -eq 1 ]] || return 0
  echo "Reiniciando o sistema para aplicar..."
  systemctl restart agendamento
  for _ in $(seq 1 20); do
    curl -fsS http://127.0.0.1/api/saude &>/dev/null && { verde "Pronto: o sistema voltou com a configuração nova."; return 0; }
    sleep 1
  done
  erro "O sistema não respondeu. Veja: sudo journalctl -u agendamento -n 40"
}
trap reinicia EXIT

# ---------- Menu ----------
if [[ "${1:-}" == "ver" ]]; then ver; exit 0; fi
while true; do
  ver
  echo "  1) Chave da administração (#admin)"
  echo "  2) E-mail do \"Esqueci a senha\" (SMTP)"
  echo "  3) Modo apresentação (ligar/desligar)"
  echo "  4) Trocar a senha do usuário do banco"
  echo "  5) Trocar a senha do sa (administrador do SQL Server)"
  echo "  6) Gerar nova chave secreta"
  echo "  0) Sair"
  case "$(pergunta "Escolha: ")" in
    1) chave_admin || true ;; 2) email || true ;; 3) apresentacao || true ;;
    4) senha_banco || true ;; 5) senha_sa || true ;; 6) chave_secreta || true ;;
    0|"") break ;;
    *) erro "Opção inválida." ;;
  esac
done
