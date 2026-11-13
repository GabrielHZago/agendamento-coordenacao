"""Cada teste roda num banco SQLite novo (arquivo temporário), com os dados do seed_demo."""
import os
import sys
import tempfile
from pathlib import Path

import pytest

# Precisa vir ANTES de importar o app: config.py lê as variáveis na importação.
_TMP = Path(tempfile.mkdtemp(prefix="agendamento_testes_"))
os.environ["DATABASE_URL"] = f"sqlite:///{_TMP / 'teste.db'}"
os.environ["UPLOAD_DIR"] = str(_TMP / "uploads")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

from app import security, seed_demo  # noqa: E402
from app.database import Base, engine  # noqa: E402
from app.main import app  # noqa: E402

app.state.limiter.enabled = False   # o limite de 120/min atrapalharia a bateria de testes


@pytest.fixture(autouse=True)
def banco_limpo():
    Base.metadata.drop_all(engine)
    seed_demo.main()                 # cria tabelas, status, curso, motivos, coordenador e 2 alunos
    security._falhas.clear()
    yield


def _cliente(perfil: str, login: str, senha: str) -> TestClient:
    c = TestClient(app)
    r = c.post("/api/login", json={"perfil": perfil, "login": login, "senha": senha})
    assert r.status_code == 200, r.text
    return c


@pytest.fixture
def client_anonimo():
    return TestClient(app)


@pytest.fixture
def lucas():
    return _cliente("aluno", "1234567", "Aluno2026!")


@pytest.fixture
def beatriz():
    return _cliente("aluno", "7654321", "Aluno2026!")


@pytest.fixture
def coord():
    return _cliente("coordenador", "coordenacao@demo.edu", "Coord2026!")
