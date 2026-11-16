"""Configurações lidas do arquivo .env (gerado pelo instalar.sh)."""
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent

# Sem .env, usa SQLite local: dá para rodar no próprio notebook para testar as telas.
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{BASE_DIR / 'dev.db'}")
SECRET_KEY = os.getenv("SECRET_KEY", "troque-esta-chave-em-producao")
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", str(BASE_DIR / "uploads")))
UPLOAD_MAX_MB = int(os.getenv("UPLOAD_MAX_MB", "5"))
FRONTEND_DIR = BASE_DIR / "frontend"

# Regras de negócio (documento de requisitos)
ANTECEDENCIA_MIN_HORAS = 24      # RN03
CANCELAMENTO_MIN_HORAS = 2       # RN04
DIAS_AGENDA = 21                 # quantos dias à frente o aluno enxerga
LIMITE_REQUISICOES = "120/minute"  # RNF13: padrão de todas as rotas, por cliente
LIMITE_LOGIN = "10/minute"         # tentativas de login por cliente (além do bloqueio por conta)
LIMITE_CADASTRO = "5/hour"         # contas novas por cliente
LIMITE_AGENDAMENTO = "10/minute"   # pedidos com upload são as rotas mais caras
LOGIN_MAX_TENTATIVAS = 5         # RNF13
LOGIN_BLOQUEIO_MIN = 15
MAX_ARQUIVOS = 5                 # anexos por pedido

# Documentação interativa da API (/docs): ligada no desenvolvimento, desligada na VM
DESENVOLVIMENTO = DATABASE_URL.startswith("sqlite")
API_DOCS = os.getenv("API_DOCS", "1" if DESENVOLVIMENTO else "0") == "1"

# Tela escondida #admin (criar coordenador). Na VM o instalar.sh gera a chave; vazia = tela desligada.
ADMIN_KEY = os.getenv("ADMIN_KEY", "dev" if DESENVOLVIMENTO else "")
LIMITE_ADMIN = "120/minute"        # navegação na tela #admin (chave errada: bloqueio após 5 erros)

# "Esqueci a senha": link assinado enviado por e-mail (SMTP). Sem SMTP, o link vai só para o log.
SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))       # 587 = STARTTLS; 465 = SSL direto
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("SMTP_FROM", SMTP_USER)
RECUPERACAO_VALIDADE_MIN = 30
LIMITE_RECUPERACAO = "5/hour"
# Modo apresentação: atalho para #admin no topo da tela e link de "Esqueci a senha" na própria tela
# (a rede da faculdade pode bloquear o e-mail). NUNCA ligue em produção: qualquer um redefiniria
# a senha de qualquer e-mail. RECUPERACAO_MOSTRA_LINK é o nome antigo, ainda aceito.
MODO_APRESENTACAO = os.getenv("MODO_APRESENTACAO", os.getenv("RECUPERACAO_MOSTRA_LINK",
                                                             "1" if DESENVOLVIMENTO else "0")) == "1"
RECUPERACAO_MOSTRA_LINK = MODO_APRESENTACAO

# Status (tb_status)
PENDENTE, APROVADA, RECUSADA, CANCELADA, REALIZADA = 1, 2, 3, 4, 5
NOMES_STATUS = {1: "Pendente", 2: "Aprovada", 3: "Recusada", 4: "Cancelada", 5: "Realizada"}
