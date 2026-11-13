"""Motivos de contato configuráveis (RF08, RF09)."""
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, true
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Documento, Motivo, MotivoDocumento
from ..security import exige_gestor, exige_login

router = APIRouter(prefix="/api", tags=["motivos"])


def motivo_json(m: Motivo) -> dict:
    return {
        "id": m.id, "nome": m.nome, "destino": m.destino, "atendimento": m.atendimento,
        "duracao_min": m.duracao_min, "prioridade": m.prioridade,
        "data_limite": m.data_limite.isoformat() if m.data_limite else None,
        "exige_disciplina": bool(m.exige_disciplina), "orientacao": m.orientacao, "ativo": bool(m.ativo),
        "documentos": [{"id": d.id_documento, "nome": d.documento.nome, "obrigatorio": bool(d.obrigatorio)}
                       for d in m.documentos],
    }


@router.get("/motivos")
def listar(todos: bool = False, u: dict = Depends(exige_login), db: Session = Depends(get_db)):
    q = select(Motivo).order_by(Motivo.destino, Motivo.nome)
    if not (todos and u["perfil"] == "coordenador"):
        q = q.where(Motivo.ativo == true())
    return [motivo_json(m) for m in db.scalars(q)]


@router.get("/documentos")
def documentos(u: dict = Depends(exige_login), db: Session = Depends(get_db)):
    return [{"id": d.id, "nome": d.nome} for d in db.scalars(select(Documento).order_by(Documento.nome))]


class DocumentoIn(BaseModel):
    nome: str = Field(min_length=3, max_length=100)


def _nome_documento(dados: DocumentoIn, db: Session, ignorar_id: int | None = None) -> str:
    nome = " ".join(dados.nome.split())          # tira espaços duplicados
    if len(nome) < 3:
        raise HTTPException(422, "O nome do documento precisa de pelo menos 3 letras.")
    existente = db.scalar(select(Documento).where(Documento.nome == nome))
    if existente and existente.id != ignorar_id:
        raise HTTPException(409, f"Já existe o documento \"{nome}\".")
    return nome


@router.post("/documentos", status_code=201)
def criar_documento(dados: DocumentoIn, u: dict = Depends(exige_gestor), db: Session = Depends(get_db)):
    """A coordenação cria tipos de documento (ex.: "Declaração de trabalho")."""
    d = Documento(nome=_nome_documento(dados, db))
    db.add(d)
    db.commit()
    return {"id": d.id, "nome": d.nome}


@router.put("/documentos/{id_documento}")
def renomear_documento(id_documento: int, dados: DocumentoIn, u: dict = Depends(exige_gestor),
                       db: Session = Depends(get_db)):
    """Renomeia o documento; o nome novo vale em todos os motivos que o pedem."""
    d = db.get(Documento, id_documento)
    if not d:
        raise HTTPException(404, "Documento não encontrado.")
    d.nome = _nome_documento(dados, db, ignorar_id=d.id)
    db.commit()
    return {"id": d.id, "nome": d.nome}


class DocIn(BaseModel):
    id: int
    obrigatorio: bool = False


class MotivoIn(BaseModel):
    nome: str = Field(min_length=3, max_length=100)
    destino: Literal["COORDENACAO", "SECRETARIA"] = "COORDENACAO"
    atendimento: Literal["PRESENCIAL", "ONLINE"] = "PRESENCIAL"
    duracao_min: int | None = Field(default=30, ge=5, le=240)
    prioridade: int = Field(default=2, ge=1, le=3)
    data_limite: date | None = None
    exige_disciplina: bool = False
    orientacao: str | None = Field(default=None, max_length=300)
    ativo: bool = True
    documentos: list[DocIn] = []


def _aplica(m: Motivo, dados: MotivoIn, db: Session) -> None:
    if dados.atendimento == "PRESENCIAL" and not dados.duracao_min:
        raise HTTPException(422, "Motivo presencial precisa de duração.")
    for campo in ("nome", "destino", "atendimento", "duracao_min", "prioridade",
                  "data_limite", "exige_disciplina", "orientacao", "ativo"):
        setattr(m, campo, getattr(dados, campo))
    m.documentos.clear()
    db.flush()
    for d in dados.documentos:
        if not db.get(Documento, d.id):
            raise HTTPException(422, f"Documento {d.id} não existe.")
        m.documentos.append(MotivoDocumento(id_documento=d.id, obrigatorio=d.obrigatorio))


@router.post("/motivos", status_code=201)
def criar(dados: MotivoIn, u: dict = Depends(exige_gestor), db: Session = Depends(get_db)):
    if db.scalar(select(Motivo).where(Motivo.nome == dados.nome)):
        raise HTTPException(409, "Já existe um motivo com esse nome.")
    m = Motivo()
    db.add(m)
    _aplica(m, dados, db)
    db.commit()
    return motivo_json(m)


@router.put("/motivos/{id_motivo}")
def editar(id_motivo: int, dados: MotivoIn, u: dict = Depends(exige_gestor), db: Session = Depends(get_db)):
    m = db.get(Motivo, id_motivo)
    if not m:
        raise HTTPException(404, "Motivo não encontrado.")
    _aplica(m, dados, db)
    db.commit()
    return motivo_json(m)
