"""Proteções contra abuso: SQL injection, cabeçalhos, limites e uploads."""
from app.protecao import limiter

PDF = b"%PDF-1.4\n%teste\n"


def test_sql_injection_no_login_nao_entra(client_anonimo):
    for payload in ("' OR '1'='1", "1234567' --", "admin'; DROP TABLE tb_alunos; --"):
        r = client_anonimo.post("/api/login", json={"perfil": "aluno", "login": payload, "senha": "' OR '1'='1"})
        assert r.status_code == 401
    # a tabela continua lá: o login normal funciona
    r = client_anonimo.post("/api/login", json={"perfil": "aluno", "login": "7654321", "senha": "Aluno2026!"})
    assert r.status_code == 200


def test_busca_trata_curingas_e_aspas_como_texto(lucas):
    lucas.post("/api/agendamentos", data={"id_motivo": 1, "titulo": "Atestado 100% ok", "id_disciplina": 1,
                                          "documentos": [1]}, files=[("arquivos", ("a.pdf", PDF, "application/pdf"))])
    assert len(lucas.get("/api/agendamentos/meus?q=%").json()) == 1          # acha o "%" literal
    assert lucas.get("/api/agendamentos/meus?q=_").json() == []              # "_" não vira curinga
    assert lucas.get("/api/agendamentos/meus?q=' OR 1=1 --").json() == []


def test_cabecalhos_de_seguranca(client_anonimo):
    r = client_anonimo.get("/")
    assert "script-src 'self'" in r.headers["content-security-policy"]
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["x-content-type-options"] == "nosniff"
    api = client_anonimo.get("/api/saude")
    assert api.headers["cache-control"] == "no-store"


def test_html_sem_script_inline(client_anonimo):
    html = client_anonimo.get("/").text
    assert "<script>" not in html and "onclick=" not in html and "<style>" not in html


def test_corpo_grande_demais_413(lucas):
    r = lucas.post("/api/agendamentos", content=b"x", headers={"Content-Length": str(500 * 1024 * 1024),
                                                              "Content-Type": "application/octet-stream"})
    assert r.status_code == 413


def test_documento_de_outro_motivo_recusado(lucas):
    # "Histórico escolar" (id 2) não é pedido pelo motivo "Entrega de atestado"
    r = lucas.post("/api/agendamentos", data={"id_motivo": 1, "titulo": "Atestado", "id_disciplina": 1, "documentos": [1, 2]},
                   files=[("arquivos", ("a.pdf", PDF, "application/pdf")), ("arquivos", ("b.pdf", PDF, "application/pdf"))])
    assert r.status_code == 422


def test_limite_por_rota_no_login(client_anonimo):
    limiter.enabled = True
    limiter.reset()
    try:
        codigos = [client_anonimo.post("/api/login", json={"perfil": "coordenador", "login": f"x{i}@x.com", "senha": "x"}).status_code
                   for i in range(12)]
        assert codigos[:10] == [401] * 10      # LIMITE_LOGIN = 10/minute
        assert codigos[10] == 429
    finally:
        limiter.enabled = False
        limiter.reset()
