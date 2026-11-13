"""Tipos de documento personalizáveis pela coordenação."""


def test_coordenacao_cria_e_renomeia_documento(coord, lucas):
    r = coord.post("/api/documentos", json={"nome": "  Declaração   de trabalho "})
    assert r.status_code == 201
    doc = r.json()
    assert doc["nome"] == "Declaração de trabalho"            # espaços extras removidos

    r = coord.put(f"/api/documentos/{doc['id']}", json={"nome": "Declaração do empregador"})
    assert r.status_code == 200 and r.json()["nome"] == "Declaração do empregador"

    # o nome novo aparece no motivo que pede o documento
    r = coord.post("/api/motivos", json={"nome": "Abono por trabalho", "atendimento": "ONLINE", "duracao_min": None,
                                         "documentos": [{"id": doc["id"], "obrigatorio": True}]})
    assert r.json()["documentos"][0]["nome"] == "Declaração do empregador"
    assert any(d["nome"] == "Declaração do empregador" for d in lucas.get("/api/documentos").json())


def test_documento_repetido_ou_curto_recusado(coord):
    assert coord.post("/api/documentos", json={"nome": "Atestado médico"}).status_code == 409
    assert coord.put("/api/documentos/2", json={"nome": "Atestado médico"}).status_code == 409
    assert coord.put("/api/documentos/1", json={"nome": "Atestado médico"}).status_code == 200   # o próprio nome
    assert coord.post("/api/documentos", json={"nome": "ab"}).status_code == 422
    assert coord.put("/api/documentos/999", json={"nome": "Qualquer"}).status_code == 404


def test_aluno_nao_cria_documento(lucas):
    assert lucas.post("/api/documentos", json={"nome": "Documento falso"}).status_code == 403
    assert lucas.put("/api/documentos/1", json={"nome": "Renomeado"}).status_code == 403
