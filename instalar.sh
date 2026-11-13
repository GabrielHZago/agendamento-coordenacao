#!/usr/bin/env bash
# =============================================================================
# Sistema de Agendamento da Coordenação — Tech Titans
# Instalação e configuração completa numa VM Ubuntu Server 24.04 (ou 22.04)
#
# ATENÇÃO: a equipe não tem acesso à infraestrutura real da faculdade.
# Este script é uma SUPOSIÇÃO de ambiente: uma máquina virtual na rede local,
# acessada pelo navegador de celulares e computadores da mesma rede.
#
# Uso — qualquer uma das formas:
#   a) Numa VM limpa, sem baixar nada antes (o script baixa o projeto do GitHub):
#        curl -fsSL https://raw.githubusercontent.com/GabrielHZago/agendamento-coordenacao/main/instalar.sh | sudo bash
#   b) Dentro da pasta do projeto já clonada/copiada:
#        sudo bash instalar.sh
#
# Variáveis opcionais (ex.: curl ... | sudo SA_PASSWORD='Senha#Forte1' SEED_DEMO=0 bash):
#   SA_PASSWORD  senha do administrador do SQL Server (se faltar, é perguntada)
#   SEED_DEMO    1 = cria dados de demonstração (padrão), 0 = não cria
#   REPO_URL / REPO_BRANCH   de onde baixar o projeto na forma (a)
#   APP_DIR, APP_PORT, DB_NAME, DB_APP_USER
#
# O que ele faz:
#   0. Baixa o projeto (git clone), se ainda não estiver na pasta
#   1. Atualiza o Ubuntu, instala Python, git, SSH e ajusta o fuso horário
#   2. Instala SQL Server 2025 Express, ODBC Driver 18 e sqlcmd
#   3. Cria o banco "agendamento", roda o script das tabelas e cria um usuário
#      do banco só com as permissões que o sistema precisa
#   4. Instala o sistema em /opt/agendamento com ambiente virtual Python
#   5. Cria o serviço "agendamento" (inicia sozinho quando a VM liga), com o sistema isolado
#   6. Coloca o nginx na frente (limites contra DDoS) e libera no firewall só SSH e HTTP
#   7. Confere se o sistema respondeu e mostra o endereço de acesso
#
# Pode rodar de novo (para atualizar o código): o banco existente é mantido.
# =============================================================================
set -euo pipefail

# ---------- Configuração ----------
REPO_URL="${REPO_URL:-https://github.com/GabrielHZago/agendamento-coordenacao.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/agendamento}"        # onde o sistema fica instalado
APP_USER="${APP_USER:-agendamento}"           # usuário Linux que roda o sistema
HTTP_PORT="${HTTP_PORT:-80}"                  # porta acessada pelo navegador (nginx)
APP_PORT="${APP_PORT:-8000}"                  # porta interna do uvicorn (só 127.0.0.1)
DB_NAME="${DB_NAME:-agendamento}"
DB_APP_USER="${DB_APP_USER:-app_agendamento}" # usuário do banco usado pelo sistema

# Nomes que entram em comandos SQL e de sistema: só letras, números e _ (nada de injeção via variável)
for v in DB_NAME DB_APP_USER APP_USER; do
  [[ "${!v}" =~ ^[A-Za-z_][A-Za-z0-9_]{0,63}$ ]] || { echo "Valor inválido em $v" >&2; exit 1; }
done
[[ "$HTTP_PORT$APP_PORT" =~ ^[0-9]+$ ]] || { echo "Porta inválida" >&2; exit 1; }
SQL_SCRIPT="database/script_banco_agendamento.sql"
SQLCMD=/opt/mssql-tools18/bin/sqlcmd

verde()   { printf '\033[1;32m%s\033[0m\n' "$*"; }
amarelo() { printf '\033[1;33m%s\033[0m\n' "$*"; }
erro()    { printf '\033[1;31mERRO: %s\033[0m\n' "$*" >&2; exit 1; }
trap 'erro "falhou na linha $LINENO. Corrija e rode de novo (o script pode ser repetido)."' ERR

# ---------- Verificações ----------
[[ $EUID -eq 0 ]] || erro "rode com sudo (ex.: sudo bash instalar.sh)"
. /etc/os-release
[[ "$ID" == "ubuntu" ]] || erro "este script foi feito para Ubuntu (encontrado: $ID)"
case "$VERSION_ID" in
  24.04|22.04) ;;
  *) erro "use Ubuntu 24.04 ou 22.04 (encontrado: $VERSION_ID)" ;;
esac
[[ "$(uname -m)" == "x86_64" ]] || erro "o SQL Server para Linux precisa de processador x86_64 (encontrado: $(uname -m))"
MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
(( MEM_MB >= 1900 )) || erro "o SQL Server precisa de pelo menos 2 GB de RAM (a VM tem ${MEM_MB} MB); recomendado 4 GB"

# ---------- apt ocupado ----------
# Logo depois que a VM liga, o Ubuntu roda a atualização automática (unattended-upgrades),
# que segura o apt. Em vez de falhar com "Could not get lock", cada apt-get espera até 15 min.
echo 'DPkg::Lock::Timeout "900";' > /etc/apt/apt.conf.d/99agendamento-espera
espera_apt() {
  local i
  for i in $(seq 1 180); do
    fuser /var/lib/dpkg/lock-frontend /var/lib/dpkg/lock &>/dev/null || return 0
    (( i == 1 )) && amarelo "O Ubuntu está atualizando sozinho (unattended-upgrades). Esperando terminar..."
    sleep 5
  done
  erro "o apt continua ocupado depois de 15 min. Veja: ps aux | grep -i apt"
}
espera_apt

# ---------- Espaço em disco (antes de baixar qualquer coisa) ----------
# O SQL Server, as atualizações e o Python ocupam ~4 GB. Sem espaço, o apt e o SQL Server
# falham com mensagens confusas ("signature failed", "No space left on device").
ESPACO_MIN_GB="${ESPACO_MIN_GB:-6}"
livre_gb() { df -BG --output=avail / | tail -1 | tr -dc '0-9'; }
gb() { lsblk -bdno SIZE "$1" 2>/dev/null | awk '{printf "%.1f", $1/1073741824}'; }

# Aumentar o disco no VirtualBox não aumenta o "/": o espaço novo fica sobrando no fim do disco.
# Esta função estica, em ordem, cada camada até o "/" usar o disco inteiro:
#   partição (growpart) -> [LVM: volume físico (pvresize) -> volume lógico (lvextend)] -> sistema de arquivos
amplia_raiz() {
  local raiz part vg="" disco num
  raiz=$(findmnt -n -o SOURCE /)
  if command -v lvs &>/dev/null && lvs "$raiz" &>/dev/null; then
    vg=$(lvs --noheadings -o vg_name "$raiz" | tr -d ' ')
    part=$(pvs --noheadings -o pv_name --select "vg_name=$vg" | head -1 | tr -d ' ')
  else
    part="$raiz"                                    # "/" direto numa partição, sem LVM
  fi
  part=$(readlink -f "$part")
  disco=$(lsblk -no PKNAME "$part" | head -1)
  num=$(cat "/sys/class/block/$(basename "$part")/partition" 2>/dev/null || true)
  echo "  / está em $raiz (partição $part, disco /dev/$disco de $(gb "/dev/$disco") GB${vg:+, LVM $vg})"

  if [[ -n "$disco" && -n "$num" ]]; then
    command -v growpart &>/dev/null || apt-get install -y cloud-guest-utils || true
    if command -v growpart &>/dev/null; then
      if growpart "/dev/$disco" "$num"; then echo "  partição $part ampliada"; else echo "  partição já ocupa o disco todo"; fi
    else
      amarelo "  sem o comando growpart: a partição não foi ampliada"
    fi
  fi

  if [[ -n "$vg" ]]; then
    pvresize "$part" || true
    if (( $(vgs --noheadings -o vg_free_count "$vg" | tr -d ' ') > 0 )); then
      lvextend -r -l +100%FREE "$raiz"
    fi
  else
    case "$(findmnt -n -o FSTYPE /)" in
      ext2|ext3|ext4) resize2fs "$raiz" || true ;;
      xfs) xfs_growfs / || true ;;
    esac
  fi
}

if (( $(livre_gb) < ESPACO_MIN_GB )); then
  amarelo "Pouco espaço em / ($(livre_gb) GB livres). Tentando liberar e usar o disco inteiro..."
  apt-get clean || true
  amplia_raiz
  verde "Agora há $(livre_gb) GB livres em /."
  if (( $(livre_gb) < ESPACO_MIN_GB )); then
    lsblk -o NAME,SIZE,TYPE,MOUNTPOINTS || true
    erro "só há $(livre_gb) GB livres em / (precisa de ${ESPACO_MIN_GB} GB).
  O disco da VM é pequeno demais (veja SIZE acima). Desligue a VM e, no PowerShell do Windows:
    VBoxManage.exe modifymedium disk \"CAMINHO\\do\\disco.vdi\" --resize 25600
  Ligue a VM e rode este instalador de novo: ele usa o espaço novo sozinho."
  fi
fi

# Senha do sa: variável, ou pergunta no terminal (funciona também com "curl | sudo bash")
if [[ -z "${SA_PASSWORD:-}" ]]; then
  [[ -r /dev/tty ]] || erro "sem terminal para perguntar a senha; passe SA_PASSWORD=... na linha de comando"
  while true; do
    read -rsp "Senha do administrador do SQL Server (sa) — mín. 8 caracteres com maiúscula, minúscula, número e símbolo: " SA_PASSWORD </dev/tty; echo
    read -rsp "Repita a senha: " SA_CONFIRMA </dev/tty; echo
    [[ "$SA_PASSWORD" == "$SA_CONFIRMA" ]] && break
    amarelo "As senhas não conferem. Tente de novo."
  done
fi
(( ${#SA_PASSWORD} >= 8 )) || erro "a senha do sa precisa ter pelo menos 8 caracteres"

export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a   # apt sem perguntas
APT_OPTS=(-y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)

# ---------- 0. Projeto: usa a pasta atual ou baixa do GitHub ----------
ORIGEM=""
if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
  ORIGEM="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi
if [[ -z "$ORIGEM" || ! -d "$ORIGEM/app" ]]; then
  verde "[0/7] Baixando o projeto de $REPO_URL ($REPO_BRANCH)..."
  apt-get update -y
  apt-get install -y git ca-certificates
  ORIGEM="/opt/agendamento-src"
  if [[ -d "$ORIGEM/.git" ]]; then
    git -C "$ORIGEM" fetch --depth 1 origin "$REPO_BRANCH"
    git -C "$ORIGEM" reset --hard "origin/$REPO_BRANCH"
  else
    rm -rf "$ORIGEM"
    git clone --depth 1 --branch "$REPO_BRANCH" "$REPO_URL" "$ORIGEM"
  fi
fi
[[ -f "$ORIGEM/$SQL_SCRIPT" ]] || erro "não achei $SQL_SCRIPT em $ORIGEM"
[[ -f "$ORIGEM/requirements.txt" ]] || erro "não achei requirements.txt em $ORIGEM"

# ---------- 1. Sistema operacional ----------
verde "[1/7] Atualizando o Ubuntu e instalando pacotes básicos..."
# Termina instalações interrompidas (ex.: rodada anterior com o disco cheio)
espera_apt
dpkg --configure -a || true
apt-get install -f -y || true
apt-get update -y
apt-get upgrade "${APT_OPTS[@]}"
apt-get install "${APT_OPTS[@]}" curl gnupg openssl ca-certificates git openssh-server ufw nginx \
                   python3 python3-venv python3-pip
systemctl enable --now ssh || true
timedatectl set-timezone America/Sao_Paulo || true   # horários das reuniões em Brasília (RNF09)

# ---------- 2. SQL Server 2025 Express + ferramentas ----------
verde "[2/7] Instalando o SQL Server 2025 (edição Express, gratuita)..."
# Os arquivos .list da Microsoft apontam para esta chave (signed-by=/usr/share/keyrings/microsoft-prod.gpg)
curl -fsSL https://packages.microsoft.com/keys/microsoft.asc \
  | gpg --dearmor --yes -o /usr/share/keyrings/microsoft-prod.gpg
curl -fsSL "https://packages.microsoft.com/config/ubuntu/${VERSION_ID}/mssql-server-2025.list" \
  -o /etc/apt/sources.list.d/mssql-server-2025.list
curl -fsSL "https://packages.microsoft.com/config/ubuntu/${VERSION_ID}/prod.list" \
  -o /etc/apt/sources.list.d/mssql-release.list
apt-get update -y
apt-get install -y mssql-server
# Pacote registrado como instalado, mas sem os arquivos (instalação interrompida): reinstala
[[ -x /opt/mssql/bin/mssql-conf ]] || apt-get install --reinstall -y mssql-server

if ! systemctl is-active --quiet mssql-server; then
  # Configuração que nunca terminou (sem master.mdf = nenhum banco existe): limpa as sobras e refaz
  if [[ ! -f /var/opt/mssql/data/master.mdf && -d /var/opt/mssql/.system ]]; then
    amarelo "Limpando sobras de uma configuração do SQL Server que não terminou..."
    rm -rf /var/opt/mssql/.system
  fi
  if ! MSSQL_SA_PASSWORD="$SA_PASSWORD" MSSQL_PID="Express" \
       /opt/mssql/bin/mssql-conf -n setup accept-eula; then
    tail -n 25 /var/opt/mssql/log/errorlog 2>/dev/null || true
    erro "a configuração do SQL Server falhou (veja o log acima). Senha do sa fraca? Precisa de 8+ caracteres com maiúscula, minúscula, número e símbolo."
  fi
  # Deixa ~40% da memória para o sistema operacional e o Python
  /opt/mssql/bin/mssql-conf set memory.memorylimitmb $(( MEM_MB * 6 / 10 )) || true
  systemctl restart mssql-server
fi
systemctl enable --now mssql-server

# ODBC Driver 18 (usado pelo Python) e sqlcmd
ACCEPT_EULA=Y apt-get install -y msodbcsql18 mssql-tools18 unixodbc-dev
[[ -x "$SQLCMD" ]] || ACCEPT_EULA=Y apt-get install --reinstall -y mssql-tools18
odbcinst -q -d -n "ODBC Driver 18 for SQL Server" &>/dev/null || ACCEPT_EULA=Y apt-get install --reinstall -y msodbcsql18
echo 'export PATH="$PATH:/opt/mssql-tools18/bin"' > /etc/profile.d/mssql.sh

# sqlcmd como sa. -f 65001: o script SQL está em UTF-8 (acentos).
# -I: liga QUOTED_IDENTIFIER (o sqlcmd vem com OFF, e aí o SQL Server recusa criar o índice filtrado)
sa_sql() { "$SQLCMD" -C -I -S localhost -U sa -P "$SA_PASSWORD" -f 65001 "$@"; }

# Espera o banco aceitar conexões (até ~90 s)
for i in $(seq 1 45); do
  sa_sql -Q "SELECT 1" &>/dev/null && break
  (( i == 45 )) && erro "o SQL Server não respondeu (senha do sa errada?). Veja: journalctl -u mssql-server"
  sleep 2
done

# ---------- 3. Banco, tabelas e usuário com permissão mínima ----------
verde "[3/7] Criando o banco '$DB_NAME' e as tabelas..."
EXISTE=$(sa_sql -h -1 -W -Q "SET NOCOUNT ON; SELECT COUNT(*) FROM sys.databases WHERE name = '$DB_NAME'")
if [[ "${EXISTE//[[:space:]]/}" == "0" ]]; then
  sa_sql -b -Q "CREATE DATABASE [$DB_NAME]"
  sa_sql -b -d "$DB_NAME" -i "$ORIGEM/$SQL_SCRIPT"
else
  amarelo "O banco '$DB_NAME' já existe; as tabelas foram mantidas."
fi

# Senha do usuário do banco: só letras e números (entra numa URL no .env sem precisar de escape)
DB_APP_PASSWORD="$(openssl rand -hex 16)Aa1"
SECRET_KEY="$(openssl rand -hex 32)"

# Usuário do sistema: lê e grava dados, mas não altera a estrutura do banco (RNF14)
sa_sql -b -Q "
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = '$DB_APP_USER')
    CREATE LOGIN [$DB_APP_USER] WITH PASSWORD = '$DB_APP_PASSWORD', CHECK_POLICY = ON;
ELSE
    ALTER LOGIN [$DB_APP_USER] WITH PASSWORD = '$DB_APP_PASSWORD';"
sa_sql -b -d "$DB_NAME" -Q "
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = '$DB_APP_USER')
    CREATE USER [$DB_APP_USER] FOR LOGIN [$DB_APP_USER];
ALTER ROLE db_datareader ADD MEMBER [$DB_APP_USER];
ALTER ROLE db_datawriter ADD MEMBER [$DB_APP_USER];"

# ---------- 4. Aplicação Python ----------
verde "[4/7] Instalando o sistema em $APP_DIR..."
id -u "$APP_USER" &>/dev/null || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR" "$APP_DIR/uploads"
# Copia o projeto (app/, frontend/, requirements.txt...) sem .git, ambientes locais nem dados de teste
tar -C "$ORIGEM" --exclude=.git --exclude=.venv --exclude=__pycache__ --exclude=uploads \
    --exclude=.env --exclude='*.db' --exclude=tests -cf - . | tar -C "$APP_DIR" -xf -
[[ -x "$APP_DIR/.venv/bin/python" ]] || python3 -m venv "$APP_DIR/.venv"
"$APP_DIR/.venv/bin/pip" install --quiet --upgrade pip
"$APP_DIR/.venv/bin/pip" install --quiet -r "$APP_DIR/requirements.txt"

cat > "$APP_DIR/.env" <<EOF
# Gerado por instalar.sh em $(date '+%d/%m/%Y %H:%M')
DATABASE_URL=mssql+pyodbc://${DB_APP_USER}:${DB_APP_PASSWORD}@localhost:1433/${DB_NAME}?driver=ODBC+Driver+18+for+SQL+Server&TrustServerCertificate=yes
SECRET_KEY=${SECRET_KEY}
UPLOAD_DIR=${APP_DIR}/uploads
UPLOAD_MAX_MB=5
API_DOCS=0
EOF
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
chmod 600 "$APP_DIR/.env"
chmod 750 "$APP_DIR/uploads"

# Dados de demonstração (curso, coordenador, alunos, escala). Para pular: SEED_DEMO=0
if [[ "${SEED_DEMO:-1}" == "1" ]]; then
  (cd "$APP_DIR" && sudo -u "$APP_USER" "$APP_DIR/.venv/bin/python" -m app.seed_demo)
fi

# ---------- 5. Serviço (sobe sozinho com a VM, isolado do resto do sistema) ----------
verde "[5/7] Criando o serviço 'agendamento'..."
WORKERS=$(( $(nproc) > 1 ? $(nproc) : 2 ))
cat > /etc/systemd/system/agendamento.service <<EOF
[Unit]
Description=Sistema de Agendamento da Coordenacao (FastAPI)
After=network-online.target mssql-server.service
Wants=network-online.target
Requires=mssql-server.service

[Service]
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
# Só escuta em 127.0.0.1: quem fala com a rede é o nginx.
# --limit-concurrency: acima disso o worker responde 503 na hora, em vez de enfileirar até travar.
ExecStart=${APP_DIR}/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port ${APP_PORT} --workers ${WORKERS} --proxy-headers --forwarded-allow-ips 127.0.0.1 --timeout-keep-alive 5 --limit-concurrency 200 --backlog 1024 --no-server-header
Restart=on-failure
RestartSec=3
LimitNOFILE=65536
# Isolamento: se alguém explorar uma falha no Python, fica preso nesta caixa
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${APP_DIR}/uploads
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
RestrictSUIDSGID=true
LockPersonality=true
CapabilityBoundingSet=
UMask=0027

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable agendamento
systemctl restart agendamento

# ---------- 6. nginx na frente + firewall ----------
verde "[6/7] Configurando o nginx (limites contra DDoS) e o firewall..."
# Limites por IP, somando todos os workers (o bloqueio de login do Python é por worker):
#   geral 20 req/s com rajada de 40 · login 10/min · 30 conexões simultâneas por IP
cat > /etc/nginx/sites-available/agendamento <<EOF
limit_req_zone \$binary_remote_addr zone=geral:10m rate=20r/s;
limit_req_zone \$binary_remote_addr zone=login:10m rate=10r/m;
limit_conn_zone \$binary_remote_addr zone=conexoes:10m;

upstream agendamento_app {
    server 127.0.0.1:${APP_PORT};
    keepalive 32;
}

server {
    listen ${HTTP_PORT} default_server;   # só IPv4: se a VM não tiver IPv6, "[::]" impediria o nginx de subir
    server_name _;
    server_tokens off;

    # Corpo máximo: 5 anexos de 5 MB + formulário. Timeouts curtos derrubam conexões lentas (slowloris).
    client_max_body_size 27m;
    client_body_timeout 15s;
    client_header_timeout 10s;
    keepalive_timeout 15s;
    send_timeout 15s;

    limit_conn conexoes 30;
    limit_req_status 429;
    limit_conn_status 429;

    # Arquivos fixos (Bootstrap, JS, CSS) saem direto do disco, sem passar pelo Python
    location ~ ^/(vendor|js|css)/ {
        root ${APP_DIR}/frontend;
        limit_req zone=geral burst=80 nodelay;
        add_header X-Content-Type-Options nosniff always;
        expires 1h;
        access_log off;
        try_files \$uri =404;
    }

    location = /api/login {
        limit_req zone=login burst=5 nodelay;
        proxy_pass http://agendamento_app;
        include /etc/nginx/agendamento_proxy.conf;
    }

    location / {
        limit_req zone=geral burst=40 nodelay;
        proxy_pass http://agendamento_app;
        include /etc/nginx/agendamento_proxy.conf;
    }
}
EOF
cat > /etc/nginx/agendamento_proxy.conf <<'EOF'
proxy_http_version 1.1;
proxy_set_header Connection "";
proxy_set_header Host $host;
# Substitui (não acrescenta) o IP: o cliente não consegue forjar outro IP para fugir do limite
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_connect_timeout 5s;
proxy_read_timeout 30s;
proxy_send_timeout 30s;
EOF
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/agendamento /etc/nginx/sites-enabled/agendamento
nginx -t
systemctl enable nginx
systemctl reload nginx || systemctl restart nginx

# Rede do kernel: SYN cookies contra SYN flood, fila maior, sem redirecionamentos ICMP
cat > /etc/sysctl.d/90-agendamento.conf <<'EOF'
net.ipv4.tcp_syncookies = 1
net.ipv4.tcp_max_syn_backlog = 4096
net.core.somaxconn = 4096
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.all.rp_filter = 1
net.ipv4.icmp_echo_ignore_broadcasts = 1
EOF
sysctl --system >/dev/null

# Firewall: SSH com "limit" (bloqueia quem abre 6+ conexões em 30 s) e só a porta HTTP.
# A porta do uvicorn e a do banco (1433) ficam fechadas para a rede.
ufw default deny incoming
ufw default allow outgoing
ufw limit 22/tcp
ufw allow "${HTTP_PORT}/tcp"
ufw delete allow "${APP_PORT}/tcp" &>/dev/null || true   # regra de instalações antigas
ufw --force enable

# fail2ban: bane por 10 min quem estoura o limite do nginx 20 vezes em 1 min,
# e por 1 h quem erra a senha do SSH 5 vezes. Se falhar, a instalação segue (é uma camada extra).
apt-get install "${APT_OPTS[@]}" fail2ban
cat > /etc/fail2ban/jail.d/agendamento.local <<'EOF'
[sshd]
enabled  = true
maxretry = 5
findtime = 10m
bantime  = 1h

[nginx-limit-req]
enabled  = true
backend  = auto
port     = http,https
logpath  = /var/log/nginx/error.log
maxretry = 20
findtime = 1m
bantime  = 10m
EOF
systemctl enable fail2ban && systemctl restart fail2ban || amarelo "fail2ban não subiu; o resto da proteção continua valendo."

# ---------- 7. Conferência final ----------
verde "[7/7] Conferindo se o sistema respondeu..."
for i in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:${HTTP_PORT}/api/saude" &>/dev/null && break
  (( i == 30 )) && erro "o sistema não respondeu. Veja: journalctl -u agendamento -n 50 e /var/log/nginx/error.log"
  sleep 1
done

trap - ERR
IP=$(hostname -I | awk '{print $1}')
echo
verde "Pronto! Sistema instalado e rodando."
URL="http://${IP}"; [[ "$HTTP_PORT" == "80" ]] || URL="${URL}:${HTTP_PORT}"
echo "  Acesse pelo navegador (celular ou PC na mesma rede):  ${URL}"
if [[ "$IP" == 10.0.2.* ]]; then
  amarelo "  ATENÇÃO: ${IP} é o endereço do modo NAT do VirtualBox; o PC e os celulares não alcançam a VM."
  amarelo "  No VirtualBox: Dispositivos > Rede > Adaptador 1 > 'Placa em modo Bridge'. Depois: sudo reboot e hostname -I"
fi
echo "  Ver se está rodando:   sudo systemctl status agendamento"
echo "  Ver os logs:           sudo journalctl -u agendamento -f"
echo "  Atualizar o código:    rode este mesmo comando de novo"
[[ "${SEED_DEMO:-1}" == "1" ]] && \
echo "  Logins de teste:       coordenacao@demo.edu / Coord2026!   |   aluno RA 1234567 / Aluno2026!"
echo
amarelo "Guarde a senha do sa. A senha do usuário do sistema está em ${APP_DIR}/.env"
