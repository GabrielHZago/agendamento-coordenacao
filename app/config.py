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
LIMITE_REQUISICOES = "120/minute"  # RNF13
LOGIN_MAX_TENTATIVAS = 5         # RNF13
LOGIN_BLOQUEIO_MIN = 15

# Status (tb_status)
PENDENTE, APROVADA, RECUSADA, CANCELADA, REALIZADA = 1, 2, 3, 4, 5
NOMES_STATUS = {1: "Pendente", 2: "Aprovada", 3: "Recusada", 4: "Cancelada", 5: "Realizada"}
