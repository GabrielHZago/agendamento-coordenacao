"""Horários livres (aluno), escala semanal e reservas do coordenador (RF04–RF07, RF10, RN11)."""
from datetime import datetime, time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import APROVADA, CANCELADA
from ..database import get_db
from ..models import Agendamento, Aluno, Ausencia, Disciplina, Escala, Gestor, Motivo
from ..security import exige_aluno, exige_gestor
from ..servicos import avisa, gestores_do_aluno, horarios_livres, quando

router = APIRouter(prefix="/api", tags=["agenda"])


@router.get("/horarios/livres")
def livres(id_motivo: int, id_disciplina: int | None = None,
           u: dict = Depends(exige_aluno), db: Session = Depends(get_db)):
    motivo = db.get(Motivo, id_motivo)
    if not motivo or not motivo.ativo:
        raise HTTPException(404, "Motivo não encontrado.")
    if motivo.destino != "COORDENACAO" or motivo.atendimento != "PRESENCIAL":
        return []
    aluno = db.get(Aluno, u["id"])
    if id_disciplina:
        disc = db.get(Disciplina, id_disciplina)
        if not disc or disc.id_curso != aluno.id_curso:
            raise HTTPException(422, "Disciplina inválida para o seu curso.")
    gestores = gestores_do_aluno(db, aluno, id_disciplina)
    return horarios_livres(db, gestores, motivo.duracao_min or 30)


# ---------- Escala semanal ----------
class EscalaIn(BaseModel):
    dia_semana: int = Field(ge=1, le=7)
    hora_inicio: time
    hora_fim: time
    local: str = Field(min_length=2, max_length=100)

    @model_validator(mode="after")
    def ordem(self):
        if self.hora_fim <= self.hora_inicio:
            raise ValueError("O fim precisa ser depois do início.")
        return self


def escala_json(e: Escala) -> dict:
    return {"id": e.id, "dia_semana": e.dia_semana, "hora_inicio": e.hora_inicio.strftime("%H:%M"),
            "hora_fim": e.hora_fim.strftime("%H:%M"), "local": e.local}


@router.get("/escalas")
def minhas_escalas(u: dict = Depends(exige_gestor), db: Session = Depends(get_db)):
    q = select(Escala).where(Escala.id_gestor == u["id"]).order_by(Escala.dia_semana, Escala.hora_inicio)
    return [escala_json(e) for e in db.scalars(q)]


@router.post("/escalas", status_code=201)
def nova_escala(dados: EscalaIn, u: dict = Depends(exige_gestor), db: Session = Depends(get_db)):
    for e in db.scalars(select(Escala).where(Escala.id_gestor == u["id"], Escala.dia_semana == dados.dia_semana)):
        if dados.hora_inicio < e.hora_fim and e.hora_inicio < dados.hora_fim:
            raise HTTPException(409, "Esse bloco se sobrepõe a outro do mesmo dia.")
    e = Escala(id_gestor=u["id"], **dados.model_dump())
    db.add(e)
    db.commit()
    return escala_json(e)


@router.delete("/escalas/{id_escala}")
def remove_escala(id_escala: int, u: dict = Depends(exige_gestor), db: Session = Depends(get_db)):
    e = db.get(Escala, id_escala)
    if not e or e.id_gestor != u["id"]:
        raise HTTPException(404, "Bloco não encontrado.")
    db.delete(e)
    db.commit()
    return {"ok": True}


# ---------- Disciplinas atendidas (RF07, RN16) ----------
class DisciplinasIn(BaseModel):
    ids: list[int]


@router.get("/minhas-disciplinas")
def minhas_disciplinas(u: dict = Depends(exige_gestor), db: Session = Depends(get_db)):
    g = db.get(Gestor, u["id"])
    return {"max": g.max_disciplinas, "disciplinas": [{"id": d.id, "nome": d.nome} for d in g.disciplinas]}


@router.put("/minhas-disciplinas")
def define_disciplinas(dados: DisciplinasIn, u: dict = Depends(exige_gestor), db: Session = Depends(get_db)):
    g = db.get(Gestor, u["id"])
    if g.max_disciplinas and len(dados.ids) > g.max_disciplinas:
        raise HTTPException(422, f"Você pode atender no máximo {g.max_disciplinas} disciplinas.")
    g.disciplinas = list(db.scalars(select(Disciplina).where(Disciplina.id.in_(dados.ids))))
    db.commit()
    return {"ok": True}


# ---------- Reservas do coordenador (almoço, compromisso, emergência) ----------
class ReservaIn(BaseModel):
    inicio: datetime
    fim: datetime
    motivo: str = Field(default="Compromisso", max_length=100)
    confirmar: bool = False   # True = cancelar as reuniões que caírem no período

    @model_validator(mode="after")
    def ordem(self):
        if self.fim <= self.inicio:
            raise ValueError("O fim precisa ser depois do início.")
        return self


@router.get("/reservas")
def minhas_reservas(u: dict = Depends(exige_gestor), db: Session = Depends(get_db)):
    q = (select(Ausencia).where(Ausencia.id_gestor == u["id"], Ausencia.fim >= datetime.now())
         .order_by(Ausencia.inicio))
    return [{"id": a.id, "inicio": a.inicio.isoformat(timespec="minutes"),
             "fim": a.fim.isoformat(timespec="minutes"), "motivo": a.motivo} for a in db.scalars(q)]


@router.post("/reservas", status_code=201)
def reservar(dados: ReservaIn, u: dict = Depends(exige_gestor), db: Session = Depends(get_db)):
    afetadas = list(db.scalars(select(Agendamento).where(
        Agendamento.id_gestor == u["id"], Agendamento.id_status == APROVADA,
        Agendamento.inicio < dados.fim, Agendamento.fim > dados.inicio)))
    if afetadas and not dados.confirmar:
        # A tela mostra a lista e pergunta se o coordenador quer cancelar (UC04)
        raise HTTPException(409, {"mensagem": f"{len(afetadas)} reunião(ões) marcada(s) nesse período.",
                                  "reunioes": [{"id": a.id, "aluno": a.aluno.nome, "inicio": a.inicio.isoformat(timespec="minutes")}
                                               for a in afetadas]})
    reserva = Ausencia(id_gestor=u["id"], inicio=dados.inicio, fim=dados.fim, motivo=dados.motivo)
    db.add(reserva)
    db.flush()
    for a in afetadas:
        a.id_status = CANCELADA
        a.cancelado_por = "GESTOR"
        a.id_ausencia = reserva.id
        a.observacao = f"Cancelada pelo coordenador: {dados.motivo}"[:300]
        avisa(db, a, f"Sua reunião de {quando(a.inicio)} foi cancelada pelo coordenador "
                     f"({dados.motivo}). Escolha outro horário em Nova solicitação.")
    db.commit()
    return {"id": reserva.id, "canceladas": len(afetadas)}


@router.delete("/reservas/{id_reserva}")
def remove_reserva(id_reserva: int, u: dict = Depends(exige_gestor), db: Session = Depends(get_db)):
    r = db.get(Ausencia, id_reserva)
    if not r or r.id_gestor != u["id"]:
        raise HTTPException(404, "Reserva não encontrada.")
    # Reuniões canceladas por ela continuam canceladas; só tira a referência
    for a in db.scalars(select(Agendamento).where(Agendamento.id_ausencia == r.id)):
        a.id_ausencia = None
    db.delete(r)
    db.commit()
    return {"ok": True}
