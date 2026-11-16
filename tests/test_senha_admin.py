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


# ---------------- Visualizar o banco ----------------
def test_admin_lista_tabelas_sem_senhas(client_anonimo):
    tabelas = {t["nome"]: t["linhas"] for t in client_anonimo.get("/api/admin/tabelas", headers=ADMIN).json()}
    assert tabelas["tb_alunos"] == 2 and "tb_agendamentos" in tabelas
    assert "tb_senhas_alunos" not in tabelas and "tb_senhas_gestores" not in tabelas
    assert client_anonimo.get("/api/admin/tabelas/tb_senhas_alunos", headers=ADMIN).status_code == 404
    assert client_anonimo.get("/api/admin/tabelas/tb_alunos; DROP TABLE tb_alunos", headers=ADMIN).status_code == 404
    assert client_anonimo.get("/api/admin/tabelas").status_code == 403


def test_admin_abre_tabela(client_anonimo):
    r = client_anonimo.get("/api/admin/tabelas/tb_escalas?pagina=1", headers=ADMIN).json()
    assert r["total"] == 10 and len(r["linhas"]) == 10 and "hora_inicio" in r["colunas"]
    assert r["linhas"][0]["id"] == 10                       # mais recentes primeiro
    assert client_anonimo.get("/api/admin/tabelas/tb_escalas?pagina=2", headers=ADMIN).json()["linhas"] == []


def test_saude_informa_modo_apresentacao(client_anonimo):
    assert client_anonimo.get("/api/saude").json() == {"ok": True, "apresentacao": True}   # padrão no SQLite


# ---------------- Apagar pelo visualizador ----------------
def apaga(cliente, tabela, **chave):
    return cliente.post(f"/api/admin/tabelas/{tabela}/apagar", json={"chave": chave}, headers=ADMIN)


def test_admin_apaga_registro_sem_uso(client_anonimo):
    assert apaga(client_anonimo, "tb_escalas", id=10).status_code == 200
    assert client_anonimo.get("/api/admin/tabelas/tb_escalas", headers=ADMIN).json()["total"] == 9
    assert apaga(client_anonimo, "tb_escalas", id=10).status_code == 404


def test_admin_nao_apaga_registro_em_uso(lucas, client_anonimo):
    slot = lucas.get("/api/horarios/livres?id_motivo=2&id_disciplina=1").json()[0]["horarios"][0]
    lucas.post("/api/agendamentos", data={"id_motivo": 2, "titulo": "Nota", "id_disciplina": 1,
                                          "inicio": slot["inicio"], "id_gestor": slot["gestor_id"]})
    r = apaga(client_anonimo, "tb_alunos", id=1)
    assert r.status_code == 409 and "tb_agendamentos (1)" in r.json()["detail"]


def test_admin_apaga_aluno_e_senha_juntos(client_anonimo):
    assert apaga(client_anonimo, "tb_alunos", id=2).status_code == 200          # Beatriz, sem pedidos
    r = client_anonimo.post("/api/login", json={"perfil": "aluno", "login": "7654321", "senha": "Aluno2026!"})
    assert r.status_code == 401


def test_admin_apaga_associacao_com_chave_composta(client_anonimo):
    assert apaga(client_anonimo, "tassoc_tb_motivos_tb_documentos", id_motivo=1, id_documento=1).status_code == 200
    assert apaga(client_anonimo, "tassoc_tb_motivos_tb_documentos", id_motivo=1).status_code == 422   # chave incompleta


def test_admin_nao_mexe_em_status_nem_senhas(client_anonimo):
    assert apaga(client_anonimo, "tb_status", id=1).status_code == 422
    assert apaga(client_anonimo, "tb_senhas_alunos", id_aluno=1).status_code == 404
    assert client_anonimo.post("/api/admin/tabelas/tb_escalas/apagar", json={"chave": {"id": 1}}).status_code == 403
