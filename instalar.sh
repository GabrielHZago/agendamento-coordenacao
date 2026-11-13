#!/usr/bin/env bash
# =============================================================================
# Sistema de Agendamento da Coordenação — Tech Titans
# Instalação e configuração em uma VM Ubuntu Server 24.04 (ou 22.04)
#
# ATENÇÃO: a equipe não tem acesso à infraestrutura real da faculdade.
# Este script é uma SUPOSIÇÃO de ambiente: uma máquina virtual na rede local,
# acessada pelo navegador de celulares e computadores da mesma rede.
#
# Uso (na VM, dentro da pasta do projeto):
#     sudo bash instalar.sh
#
# O que ele faz:
#   1. Instala SQL Server 2025 Express, ODBC Driver 18 e sqlcmd
#   2. Cria o banco "agendamento" e roda o script das tabelas
#   3. Cria um usuário do banco só com as permissões que o sistema precisa
#   4. Instala Python, cria o ambiente virtual e as dependências
#   5. Cria o serviço "agendamento" (inicia sozinho quando a VM liga)
#   6. Libera no firewall só o SSH e a porta do sistema
# =============================================================================
set -euo pipefail

# ---------- Configuração (pode mudar aqui ou passar como variável) ----------
APP_DIR="${APP_DIR:-/opt/agendamento}"        # onde o sistema fica instalado
APP_USER="${APP_USER:-agendamento}"           # usuário Linux que roda o sistema
APP_PORT="${APP_PORT:-8000}"                  # porta acessada pelo navegador
DB_NAME="${DB_NAME:-agendamento}"
DB_APP_USER="${DB_APP_USER:-app_agendamento}" # usuário do banco usado pelo sistema
SQL_SCRIPT="${SQL_SCRIPT:-script_banco_agendamento.sql}"
ORIGEM="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # pasta do projeto

verde()   { printf '\033[1;32m%s\033[0m\n' "$*"; }
amarelo() { printf '\033[1;33m%s\033[0m\n' "$*"; }
erro()    { printf '\033[1;31mERRO: %s\033[0m\n' "$*" >&2; exit 1; }

# ---------- Verificações ----------
[[ $EUID -eq 0 ]] || erro "rode com sudo: sudo bash instalar.sh"
. /etc/os-release
[[ "$ID" == "ubuntu" ]] || erro "este script foi feito para Ubuntu (encontrado: $ID)"
case "$VERSION_ID" in
  24.04|22.04) ;;
  *) erro "use Ubuntu 24.04 ou 22.04 (encontrado: $VERSION_ID)" ;;
esac
MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
(( MEM_MB >= 1900 )) || erro "o SQL Server precisa de pelo menos 2 GB de RAM (a VM tem ${MEM_MB} MB)"
[[ -f "$ORIGEM/$SQL_SCRIPT" ]] || erro "não achei $SQL_SCRIPT em $ORIGEM"
[[ -f "$ORIGEM/requirements.txt" ]] || erro "não achei requirements.txt em $ORIGEM"

# ---------- Senhas (pedidas uma vez, nunca gravadas em texto no script) ----------
gerar_senha() { printf '%sAa1!' "$(openssl rand -hex 12)"; }   # cumpre a política de senha do SQL Server
if [[ -z "${SA_PASSWORD:-}" ]]; then
  read -rsp "Senha do administrador do SQL Server (sa) — mín. 8 caracteres com maiúscula, minúscula, número e símbolo: " SA_PASSWORD; echo
fi
DB_APP_PASSWORD="${DB_APP_PASSWORD:-$(gerar_senha)}"
SECRET_KEY="$(openssl rand -hex 32)"

# ---------- 1. Pacotes básicos ----------
verde "[1/6] Atualizando o sistema e instalando pacotes básicos..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl gnupg ca-certificates software-properties-common \
                   python3 python3-venv python3-pip ufw
timedatectl set-timezone America/Sao_Paulo || true   # horários das reuniões em Brasília (RNF09)

# ---------- 2. SQL Server 2025 Express ----------
verde "[2/6] Instalando o SQL Server 2025 (edição Express, gratuita)..."
curl -fsSL https://packages.microsoft.com/keys/microsoft.asc \
  | tee /etc/apt/trusted.gpg.d/microsoft.asc >/dev/null
curl -fsSL "https://packages.microsoft.com/config/ubuntu/${VERSION_ID}/mssql-server-2025.list" \
  -o /etc/apt/sources.list.d/mssql-server-2025.list
curl -fsSL "https://packages.microsoft.com/config/ubuntu/${VERSION_ID}/prod.list" \
  -o /etc/apt/sources.list.d/mssql-release.list
apt-get update -y
apt-get install -y mssql-server

if ! systemctl is-active --quiet mssql-server || [[ ! -f /var/opt/mssql/mssql.conf ]]; then
  MSSQL_SA_PASSWORD="$SA_PASSWORD" MSSQL_PID="Express" \
    /opt/mssql/bin/mssql-conf -n setup accept-eula
fi
systemctl enable --now mssql-server

# Ferramentas: ODBC Driver 18 (usado pelo Python) e sqlcmd
ACCEPT_EULA=Y apt-get install -y msodbcsql18 mssql-tools18 unixodbc-dev
SQLCMD=/opt/mssql-tools18/bin/sqlcmd
grep -q mssql-tools18 /etc/profile.d/mssql.sh 2>/dev/null \
  || echo 'export PATH="$PATH:/opt/mssql-tools18/bin"' > /etc/profile.d/mssql.sh

# Espera o banco aceitar conexões (até ~60 s)
for i in $(seq 1 30); do
  "$SQLCMD" -C -S localhost -U sa -P "$SA_PASSWORD" -Q "SELECT 1" &>/dev/null && break
  sleep 2
  (( i == 30 )) && erro "o SQL Server não respondeu. Veja: journalctl -u mssql-server"
done

# ---------- 3. Banco, tabelas e usuário com permissão mínima ----------
verde "[3/6] Criando o banco '$DB_NAME' e as tabelas..."
EXISTE=$("$SQLCMD" -C -S localhost -U sa -P "$SA_PASSWORD" -h -1 -W \
          -Q "SET NOCOUNT ON; SELECT COUNT(*) FROM sys.databases WHERE name = '$DB_NAME'")
if [[ "${EXISTE//[[:space:]]/}" == "0" ]]; then
  "$SQLCMD" -C -S localhost -U sa -P "$SA_PASSWORD" -b -Q "CREATE DATABASE [$DB_NAME]"
  "$SQLCMD" -C -S localhost -U sa -P "$SA_PASSWORD" -b -d "$DB_NAME" -i "$ORIGEM/$SQL_SCRIPT"
else
  amarelo "O banco '$DB_NAME' já existe; as tabelas não foram recriadas."
fi

# Usuário do sistema: lê e grava dados, mas não altera a estrutura do banco (RNF14)
"$SQLCMD" -C -S localhost -U sa -P "$SA_PASSWORD" -b -Q "
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = '$DB_APP_USER')
    CREATE LOGIN [$DB_APP_USER] WITH PASSWORD = '$DB_APP_PASSWORD', CHECK_POLICY = ON;
ELSE
    ALTER LOGIN [$DB_APP_USER] WITH PASSWORD = '$DB_APP_PASSWORD';"
"$SQLCMD" -C -S localhost -U sa -P "$SA_PASSWORD" -b -d "$DB_NAME" -Q "
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = '$DB_APP_USER')
    CREATE USER [$DB_APP_USER] FOR LOGIN [$DB_APP_USER];
ALTER ROLE db_datareader ADD MEMBER [$DB_APP_USER];
ALTER ROLE db_datawriter ADD MEMBER [$DB_APP_USER];"

# ---------- 4. Aplicação Python ----------
verde "[4/6] Instalando o sistema em $APP_DIR..."
id -u "$APP_USER" &>/dev/null || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR" "$APP_DIR/uploads"
# Copia o projeto (app/, frontend/, requirements.txt...) sem levar .git nem ambientes locais
tar -C "$ORIGEM" --exclude=.git --exclude=.venv --exclude=__pycache__ --exclude=uploads -cf - . \
  | tar -C "$APP_DIR" -xf -
python3 -m venv "$APP_DIR/.venv"
"$APP_DIR/.venv/bin/pip" install --upgrade pip
"$APP_DIR/.venv/bin/pip" install -r "$APP_DIR/requirements.txt"

cat > "$APP_DIR/.env" <<EOF
# Gerado por instalar.sh em $(date '+%d/%m/%Y %H:%M')
DATABASE_URL=mssql+pyodbc://${DB_APP_USER}:${DB_APP_PASSWORD}@localhost:1433/${DB_NAME}?driver=ODBC+Driver+18+for+SQL+Server&TrustServerCertificate=yes
SECRET_KEY=${SECRET_KEY}
UPLOAD_DIR=${APP_DIR}/uploads
UPLOAD_MAX_MB=5
EOF
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
chmod 600 "$APP_DIR/.env"
chmod 750 "$APP_DIR/uploads"

# Dados de demonstração (curso, coordenador, alunos, escala). Para pular: SEED_DEMO=0 sudo -E bash instalar.sh
if [[ "${SEED_DEMO:-1}" == "1" ]]; then
  (cd "$APP_DIR" && sudo -u "$APP_USER" "$APP_DIR/.venv/bin/python" -m app.seed_demo)
fi

# ---------- 5. Serviço (sobe sozinho com a VM) ----------
verde "[5/6] Criando o serviço 'agendamento'..."
WORKERS=$(( $(nproc) > 1 ? $(nproc) : 2 ))
cat > /etc/systemd/system/agendamento.service <<EOF
[Unit]
Description=Sistema de Agendamento da Coordenacao (FastAPI)
After=network-online.target mssql-server.service
Wants=network-online.target
Requires=mssql-server.service

[Service]
User=${APP_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
ExecStart=${APP_DIR}/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port ${APP_PORT} --workers ${WORKERS} --proxy-headers --timeout-keep-alive 5 --limit-concurrency 500
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now agendamento

# ---------- 6. Firewall: só SSH e a porta do sistema (banco fica fechado) ----------
verde "[6/6] Configurando o firewall..."
ufw allow OpenSSH
ufw allow "${APP_PORT}/tcp"
ufw --force enable

IP=$(hostname -I | awk '{print $1}')
echo
verde "Pronto!"
echo "  Acesse pelo navegador (celular ou PC na mesma rede):  http://${IP}:${APP_PORT}"
echo "  Documentação da API:                                  http://${IP}:${APP_PORT}/docs"
echo "  Ver se está rodando:   sudo systemctl status agendamento"
echo "  Ver os logs:           sudo journalctl -u agendamento -f"
echo "  Logins de teste:       coordenacao@demo.edu / Coord2026!   |   aluno RA 1234567 / Aluno2026!"
echo
amarelo "Guarde a senha do sa. A senha do usuário do sistema está em ${APP_DIR}/.env"
