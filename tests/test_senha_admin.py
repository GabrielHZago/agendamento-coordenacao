"""Esqueci a senha (link assinado) e tela de administração (criar coordenador)."""
from urllib.parse import parse_qs, urlsplit

import pytest

from app.routers import admin as rota_admin
from app.routers import senha as rota_senha

ADMIN = {"X-Chave-Admin": "dev"}          # chave padrão no desenvolvimento (SQLite)


def token_do_link(link: str) -> str:
    return parse_qs(urlsplit(link).fragment.split("?", 1)[1])["t"][0]


# ---------------- Esqueci a senha ----------------
def test_redefinir_senha_pelo_link(client_anonimo):
    r = client_anonimo.post("/api/senha/esqueci", json={"perfil": "aluno", "email": "lucas@aluno.demo.edu"})
    assert r.status_code == 200 and "link" in r.json()        # modo apresentação (padrão no SQLite)
    token = token_do_link(r.json()["link"])

    assert client_anonimo.post("/api/senha/redefinir", json={"token": token, "senha": "NovaSenha2026"}).status_code == 200
    entra = {"perfil": "aluno", "login": "1234567"}
    assert client_anonimo.post("/api/login", json={**entra, "senha": "Aluno2026!"}).status_code == 401
    assert client_anonimo.post("/api/login", json={**entra, "senha": "NovaSenha2026"}).status_code == 200
    # o mesmo link não serve duas vezes
    r = client_anonimo.post("/api/senha/redefinir", json={"token": token, "senha": "OutraSenha2026"})
    assert r.status_code == 422 and "já foi usado" in r.json()["detail"]


def test_email_inexistente_tem_a_mesma_resposta(client_anonimo):
    r = client_anonimo.post("/api/senha/esqueci", json={"perfil": "aluno", "email": "ninguem@x.com"})
    assert r.status_code == 200 and "link" not in r.json()
    assert r.json()["mensagem"].startswith("Se o e-mail estiver cadastrado")


def test_sem_modo_apresentacao_o_link_nao_aparece(client_anonimo, monkeypatch):
    monkeypatch.setattr(rota_senha, "RECUPERACAO_MOSTRA_LINK", False)
    r = client_anonimo.post("/api/senha/esqueci", json={"perfil": "aluno", "email": "lucas@aluno.demo.edu"})
    assert r.status_code == 200 and "link" not in r.json()


def test_link_adulterado_ou_senha_fraca(client_anonimo):
    r = client_anonimo.post("/api/senha/esqueci", json={"perfil": "coordenador", "email": "coordenacao@demo.edu"})
    token = token_do_link(r.json()["link"])
    assert client_anonimo.post("/api/senha/redefinir", json={"token": token[:-3] + "abc", "senha": "NovaSenha2026"}).status_code == 422
    assert client_anonimo.post("/api/senha/redefinir", json={"token": token, "senha": "fraca"}).status_code == 422


# ---------------- Administração ----------------
def test_admin_exige_chave(client_anonimo, coord):
    assert client_anonimo.get("/api/admin/dados").status_code == 403
    assert client_anonimo.get("/api/admin/dados", headers={"X-Chave-Admin": "errada"}).status_code == 403
    assert coord.get("/api/admin/dados").status_code == 403          # login de coordenador não basta


def test_admin_desligado_sem_chave(client_anonimo, monkeypatch):
    monkeypatch.setattr(rota_admin, "ADMIN_KEY", "")
    assert client_anonimo.get("/api/admin/dados", headers=ADMIN).status_code == 404


def test_admin_cria_coordenador_com_disciplinas(client_anonimo):
    dados = client_anonimo.get("/api/admin/dados", headers=ADMIN).json()
    curso = dados["cursos"][0]["id"]
    discs = [d["id"] for d in dados["disciplinas"]][:2]
    novo = {"nome": "Prof. Carlos Teste", "email": "carlos@demo.edu", "senha": "Coord2026!",
            "cursos": [curso], "disciplinas": discs, "max_disciplinas": 3}
    r = client_anonimo.post("/api/admin/coordenadores", json=novo, headers=ADMIN)
    assert r.status_code == 201 and r.json()["disciplinas"] == discs
    assert client_anonimo.post("/api/admin/coordenadores", json=novo, headers=ADMIN).status_code == 409

    # entra e vê as disciplinas que a administração definiu, sem poder mudar
    r = client_anonimo.post("/api/login", json={"perfil": "coordenador", "login": "carlos@demo.edu", "senha": "Coord2026!"})
    assert r.status_code == 200
    assert [d["id"] for d in client_anonimo.get("/api/minhas-disciplinas").json()["disciplinas"]] == discs
    assert client_anonimo.put("/api/minhas-disciplinas", json={"ids": []}).status_code == 405


@pytest.mark.parametrize("mudanca,erro", [
    ({"disciplinas": [1, 2, 3], "max_disciplinas": 2}, "acima do limite"),
    ({"disciplinas": [999]}, "inexistente"),
])
def test_admin_valida_vinculos(client_anonimo, mudanca, erro):
    r = client_anonimo.put("/api/admin/coordenadores/1", json={"cursos": [1], **mudanca}, headers=ADMIN)
    assert r.status_code == 422 and erro in r.json()["detail"]
