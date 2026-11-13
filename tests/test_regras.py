"""Regras de negócio e segurança pedidas no handoff (etapa 2)."""
from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.database import SessionLocal
from app.models import Agendamento, Notificacao

# ids criados pelo seed_demo (mesma ordem do script SQL)
ATESTADO, NOTA, SECRETARIA = 1, 2, 5
DOC_ATESTADO = 1
BANCO_DE_DADOS = 1
PDF = b"%PDF-1.4\n%teste\n"


def primeiro_livre(cliente, id_motivo=NOTA, id_disciplina=BANCO_DE_DADOS):
    r = cliente.get(f"/api/horarios/livres?id_motivo={id_motivo}&id_disciplina={id_disciplina}")
    assert r.status_code == 200, r.text
    assert r.json(), "o seed precisa gerar horários livres"
    return r.json()[0]["horarios"][0]


def marca(cliente, slot, id_motivo=NOTA, id_disciplina=BANCO_DE_DADOS):
    return cliente.post("/api/agendamentos", data={
        "id_motivo": id_motivo, "titulo": "Dúvida sobre nota", "id_disciplina": id_disciplina,
        "inicio": slot["inicio"], "id_gestor": slot["gestor_id"]})


def pedido_online(cliente, id_motivo=ATESTADO, arquivos=None, documentos=None):
    return cliente.post("/api/agendamentos",
                        data={"id_motivo": id_motivo, "titulo": "Atestado da semana",
                              "id_disciplina": BANCO_DE_DADOS, "documentos": documentos or []},
                        files=[("arquivos", a) for a in (arquivos or [])])


def todos_agendamentos():
    with SessionLocal() as db:
        return list(db.scalars(select(Agendamento)).unique())


# ---------------- Login (RNF de segurança) ----------------
def test_login_certo_e_errado(client_anonimo):
    ok = client_anonimo.post("/api/login", json={"perfil": "aluno", "login": "1234567", "senha": "Aluno2026!"})
    assert ok.status_code == 200 and ok.json()["perfil"] == "aluno"
    errado = client_anonimo.post("/api/login", json={"perfil": "aluno", "login": "1234567", "senha": "errada"})
    assert errado.status_code == 401
    # coordenador não entra pela aba de aluno
    trocado = client_anonimo.post("/api/login", json={"perfil": "aluno", "login": "coordenacao@demo.edu",
                                                      "senha": "Coord2026!"})
    assert trocado.status_code == 401


def test_bloqueio_apos_5_falhas(client_anonimo):
    for _ in range(5):
        r = client_anonimo.post("/api/login", json={"perfil": "aluno", "login": "1234567", "senha": "errada"})
        assert r.status_code == 401
    # a 6ª tentativa é barrada mesmo com a senha certa
    r = client_anonimo.post("/api/login", json={"perfil": "aluno", "login": "1234567", "senha": "Aluno2026!"})
    assert r.status_code == 429


# ---------------- Reunião presencial ----------------
def test_presencial_nasce_aprovada(lucas):
    r = marca(lucas, primeiro_livre(lucas))
    assert r.status_code == 201, r.text
    assert r.json()["id_status"] == 2


def test_segunda_reuniao_futura_recusada_rn05(lucas):
    livres = lucas.get(f"/api/horarios/livres?id_motivo={NOTA}&id_disciplina={BANCO_DE_DADOS}").json()
    assert marca(lucas, livres[0]["horarios"][0]).status_code == 201
    r = marca(lucas, livres[0]["horarios"][3])
    assert r.status_code == 422


def test_antecedencia_minima_rn03(lucas):
    daqui_2h = (datetime.now() + timedelta(hours=2)).replace(second=0, microsecond=0)
    r = marca(lucas, {"inicio": daqui_2h.isoformat(), "gestor_id": 1})
    assert r.status_code == 422
    assert "24 h" in r.json()["detail"]


def test_dois_alunos_mesmo_horario_409(lucas, beatriz):
    slot = primeiro_livre(lucas)
    assert marca(lucas, slot).status_code == 201
    assert marca(beatriz, slot).status_code == 409


def test_indice_unico_filtrado_barra_duplicata():
    """Mesmo que a checagem da aplicação falhe (corrida), o índice uq_agendamento_ativo segura."""
    inicio = datetime.combine(date.today() + timedelta(days=30), datetime.min.time()).replace(hour=15)
    base = dict(id_gestor=1, id_motivo=NOTA, id_status=2, inicio=inicio,
                fim=inicio + timedelta(minutes=20), titulo="x")
    with SessionLocal() as db:
        db.add(Agendamento(id_aluno=1, **base))
        db.commit()
        db.add(Agendamento(id_aluno=2, **base))
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()
        # cancelada não conta: pode existir outra no mesmo horário
        db.add(Agendamento(id_aluno=2, **{**base, "id_status": 4}))
        db.commit()


# ---------------- Motivos ----------------
def test_motivo_secretaria_nao_grava_rn13(lucas):
    r = lucas.post("/api/agendamentos", data={"id_motivo": SECRETARIA, "titulo": "Matrícula"})
    assert r.status_code == 422
    assert todos_agendamentos() == []


def test_online_sem_documento_obrigatorio_rn17(lucas):
    r = pedido_online(lucas)
    assert r.status_code == 422
    assert "Atestado" in r.json()["detail"]
    assert todos_agendamentos() == []


def test_online_com_pdf_fica_pendente(lucas):
    r = pedido_online(lucas, arquivos=[("atestado.pdf", PDF, "application/pdf")], documentos=[DOC_ATESTADO])
    assert r.status_code == 201, r.text
    corpo = r.json()
    assert corpo["id_status"] == 1
    assert corpo["anexos"][0]["arquivo"] == "atestado.pdf"


def test_upload_pdf_falso_recusado(lucas):
    falso = b"MZ\x90\x00 isto e um executavel"
    r = pedido_online(lucas, arquivos=[("atestado.pdf", falso, "application/pdf")], documentos=[DOC_ATESTADO])
    assert r.status_code == 415
    assert todos_agendamentos() == []


# ---------------- Reserva do coordenador ----------------
def test_reserva_sobre_reuniao(lucas, coord):
    slot = primeiro_livre(lucas)
    id_ag = marca(lucas, slot).json()["id"]
    reserva = {"inicio": slot["inicio"], "fim": slot["fim"], "motivo": "Emergência médica"}

    r = coord.post("/api/reservas", json=reserva)
    assert r.status_code == 409
    assert [x["id"] for x in r.json()["detail"]["reunioes"]] == [id_ag]

    r = coord.post("/api/reservas", json={**reserva, "confirmar": True})
    assert r.status_code == 201 and r.json()["canceladas"] == 1
    with SessionLocal() as db:
        ag = db.get(Agendamento, id_ag)
        assert ag.id_status == 4 and ag.cancelado_por == "GESTOR" and ag.id_ausencia == r.json()["id"]
        avisos = db.scalars(select(Notificacao).where(Notificacao.id_agendamento == id_ag)).all()
        assert any("cancelada pelo coordenador" in n.mensagem for n in avisos)
    assert any("cancelada" in n["mensagem"] for n in lucas.get("/api/notificacoes").json())


def test_horarios_livres_sem_ocupados_nem_reservas(lucas, coord):
    livres = lucas.get(f"/api/horarios/livres?id_motivo={NOTA}&id_disciplina={BANCO_DE_DADOS}").json()
    ocupado = livres[0]["horarios"][0]
    reservado = livres[1]["horarios"][2]
    assert marca(lucas, ocupado).status_code == 201
    assert coord.post("/api/reservas", json={"inicio": reservado["inicio"], "fim": reservado["fim"]}).status_code == 201

    inicios = {h["inicio"] for d in lucas.get(f"/api/horarios/livres?id_motivo={NOTA}&id_disciplina={BANCO_DE_DADOS}").json()
               for h in d["horarios"]}
    assert ocupado["inicio"] not in inicios
    assert reservado["inicio"] not in inicios


# ---------------- Fila de pendentes (RN14) ----------------
def test_pendentes_ordenados_rn14(lucas, coord):
    hoje = date.today()
    motivos = {  # nome: (data_limite, prioridade)
        "Sem prazo, alta": (None, 1),
        "Prazo longe, baixa": (hoje + timedelta(days=9), 3),
        "Prazo perto, média": (hoje + timedelta(days=2), 2),
        "Sem prazo, baixa": (None, 3),
    }
    ids = {}
    for nome, (limite, prio) in motivos.items():
        r = coord.post("/api/motivos", json={"nome": nome, "atendimento": "ONLINE", "duracao_min": None,
                                             "prioridade": prio,
                                             "data_limite": limite.isoformat() if limite else None})
        assert r.status_code == 201, r.text
        ids[nome] = r.json()["id"]
        assert pedido_online(lucas, id_motivo=ids[nome]).status_code == 201

    ordem = [p["motivo"] for p in coord.get("/api/pendentes").json()]
    assert ordem == ["Prazo perto, média", "Prazo longe, baixa", "Sem prazo, alta", "Sem prazo, baixa"]
