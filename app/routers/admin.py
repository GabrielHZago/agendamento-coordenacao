"""Tela escondida #admin: criar coordenador e definir os cursos e as disciplinas que ele atende.

Protegida por uma chave (ADMIN_KEY no .env, gerada pelo instalar.sh), enviada no cabeçalho X-Chave-Admin.
Sem chave configurada, as rotas respondem 404 (a tela não existe).
"""
import hmac
import logging
from datetime import date, datetime, time
from decimal import Decimal
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import ADMIN_KEY, LIMITE_ADMIN, UPLOAD_DIR
from ..database import Base, get_db
from ..models import Curso, Disciplina, Gestor, SenhaAluno, SenhaGestor
from ..protecao import limiter
from ..security import hash_senha, valida_senha

router = APIRouter(prefix="/api/admin", tags=["administração"])
log = logging.getLogger("uvicorn.error")


def exige_admin(request: Request) -> None:
    if not ADMIN_KEY:
        raise HTTPException(404, "Não encontrado.")
    chave = request.headers.get("x-chave-admin", "")
    if not hmac.compare_digest(chave.encode(), ADMIN_KEY.encode()):   # comparação em tempo constante
        raise HTTPException(403, "Chave de administração incorreta.")


def coordenador_json(g: Gestor) -> dict:
    return {"id": g.id, "nome": g.nome, "email": g.email, "max_disciplinas": g.max_disciplinas,
            "cursos": [c.id for c in g.cursos], "disciplinas": [d.id for d in g.disciplinas]}


@router.get("/dados")
@limiter.limit(LIMITE_ADMIN)
def dados(request: Request, _: None = Depends(exige_admin), db: Session = Depends(get_db)):
    return {
        "cursos": [{"id": c.id, "nome": c.nome} for c in db.scalars(select(Curso).order_by(Curso.nome))],
        "disciplinas": [{"id": d.id, "nome": d.nome, "id_curso": d.id_curso}
                        for d in db.scalars(select(Disciplina).order_by(Disciplina.nome))],
        "coordenadores": [coordenador_json(g) for g in db.scalars(select(Gestor).order_by(Gestor.nome))],
    }


class VinculosIn(BaseModel):
    cursos: list[int] = Field(min_length=1)
    disciplinas: list[int] = []
    max_disciplinas: int | None = Field(default=None, ge=1, le=255)


class CoordenadorIn(VinculosIn):
    nome: str = Field(min_length=3, max_length=100)
    email: EmailStr
    senha: str = Field(max_length=128)

    @field_validator("senha")
    @classmethod
    def senha_forte(cls, v: str) -> str:
        return valida_senha(v)


def _aplica_vinculos(g: Gestor, dados: VinculosIn, db: Session) -> None:
    if dados.max_disciplinas and len(dados.disciplinas) > dados.max_disciplinas:
        raise HTTPException(422, f"Foram marcadas {len(dados.disciplinas)} disciplinas, acima do limite de {dados.max_disciplinas}.")
    cursos = list(db.scalars(select(Curso).where(Curso.id.in_(dados.cursos))))
    disciplinas = list(db.scalars(select(Disciplina).where(Disciplina.id.in_(dados.disciplinas))))
    if len(cursos) != len(set(dados.cursos)) or len(disciplinas) != len(set(dados.disciplinas)):
        raise HTTPException(422, "Curso ou disciplina inexistente.")
    if any(d.id_curso not in {c.id for c in cursos} for d in disciplinas):
        raise HTTPException(422, "Há disciplina de um curso que não foi marcado.")
    g.cursos, g.disciplinas, g.max_disciplinas = cursos, disciplinas, dados.max_disciplinas


@router.post("/coordenadores", status_code=201)
@limiter.limit(LIMITE_ADMIN)
def criar(dados: CoordenadorIn, request: Request, _: None = Depends(exige_admin), db: Session = Depends(get_db)):
    email = dados.email.lower()
    if db.scalar(select(Gestor).where(Gestor.email == email)):
        raise HTTPException(409, "Já existe um coordenador com esse e-mail.")
    g = Gestor(nome=dados.nome.strip(), email=email)
    _aplica_vinculos(g, dados, db)
    db.add(g)
    db.flush()
    db.add(SenhaGestor(id_gestor=g.id, senha_hash=hash_senha(dados.senha)))
    db.commit()
    return coordenador_json(g)


# ---------- Visualizar o banco (somente leitura) ----------
OCULTAS = {"tb_senhas_alunos", "tb_senhas_gestores"}       # hashes de senha nunca saem do servidor
POR_PAGINA = 50


def _tabelas() -> dict:
    """Só tabelas conhecidas pelo sistema: o nome vindo da URL nunca vira SQL."""
    return {nome: t for nome, t in Base.metadata.tables.items() if nome not in OCULTAS}


def _valor(v):
    if isinstance(v, (datetime, date, time)):
        return v.isoformat(sep=" ", timespec="minutes") if isinstance(v, datetime) else v.isoformat()
    if isinstance(v, Decimal):
        return str(v)
    return v


@router.get("/tabelas")
@limiter.limit(LIMITE_ADMIN)
def tabelas(request: Request, _: None = Depends(exige_admin), db: Session = Depends(get_db)):
    return [{"nome": nome, "linhas": db.scalar(select(func.count()).select_from(t))}
            for nome, t in sorted(_tabelas().items())]


@router.get("/tabelas/{nome}")
@limiter.limit("60/minute")
def tabela(nome: str, request: Request, pagina: int = Query(1, ge=1, le=100000),
           _: None = Depends(exige_admin), db: Session = Depends(get_db)):
    t = _tabelas().get(nome)
    if t is None:
        raise HTTPException(404, "Tabela não encontrada.")
    total = db.scalar(select(func.count()).select_from(t))
    ordem = [c.desc() for c in t.primary_key.columns]              # mais recentes primeiro
    linhas = db.execute(select(t).order_by(*ordem).limit(POR_PAGINA).offset((pagina - 1) * POR_PAGINA)).mappings()
    return {"tabela": nome, "colunas": [c.name for c in t.columns], "chave": [c.name for c in t.primary_key.columns],
            "pode_apagar": nome not in PROTEGIDAS, "total": total,
            "pagina": pagina, "por_pagina": POR_PAGINA,
            "linhas": [{k: _valor(v) for k, v in linha.items()} for linha in linhas]}


PROTEGIDAS = {"tb_status"}                                  # ids fixos usados no código
SENHA_DO_DONO = {"tb_alunos": SenhaAluno, "tb_gestores": SenhaGestor}


class ApagarIn(BaseModel):
    chave: dict[str, int | str]                             # valor da chave primária, coluna por coluna


@router.post("/tabelas/{nome}/apagar")
@limiter.limit("60/minute")
def apagar(nome: str, dados: ApagarIn, request: Request, _: None = Depends(exige_admin),
           db: Session = Depends(get_db)):
    """Apaga um registro. Se outro registro ainda depende dele, recusa e diz onde (não apaga em cascata)."""
    t = _tabelas().get(nome)
    if t is None:
        raise HTTPException(404, "Tabela não encontrada.")
    if nome in PROTEGIDAS:
        raise HTTPException(422, "Esta tabela é usada pelo sistema e não pode ser alterada.")
    pk = list(t.primary_key.columns)
    if set(dados.chave) != {c.name for c in pk}:
        raise HTTPException(422, "Chave do registro incompleta.")
    filtro = [c == dados.chave[c.name] for c in pk]
    linha = db.execute(select(t).where(*filtro)).mappings().first()
    if not linha:
        raise HTTPException(404, "Registro não encontrado.")

    # Quem ainda aponta para este registro? (as senhas, ocultas, vão junto com o dono)
    usos = []
    for outra in Base.metadata.tables.values():
        if outra.name in OCULTAS:
            continue
        for fk in outra.foreign_keys:
            if fk.column.table is t:
                n = db.scalar(select(func.count()).select_from(outra).where(fk.parent == linha[fk.column.name]))
                if n:
                    usos.append(f"{outra.name} ({n})")
    if usos:
        raise HTTPException(409, "Este registro ainda é usado em: " + ", ".join(usos) + ". Apague esses registros antes.")

    try:
        if nome in SENHA_DO_DONO:
            senha = SENHA_DO_DONO[nome]
            db.execute(delete(senha).where(list(senha.__table__.primary_key.columns)[0] == linha["id"]))
        db.execute(delete(t).where(*filtro))
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "O banco recusou: o registro ainda é usado em outra tabela.")
    if nome == "tb_anexos":                                    # o arquivo some junto com o registro
        (UPLOAD_DIR / Path(linha["caminho"]).name).unlink(missing_ok=True)
    log.warning("Administração apagou %s %s", nome, dados.chave)
    return {"ok": True}


@router.put("/coordenadores/{id_gestor}")
@limiter.limit(LIMITE_ADMIN)
def editar(id_gestor: int, dados: VinculosIn, request: Request, _: None = Depends(exige_admin),
           db: Session = Depends(get_db)):
    g = db.get(Gestor, id_gestor)
    if not g:
        raise HTTPException(404, "Coordenador não encontrado.")
    _aplica_vinculos(g, dados, db)
    db.commit()
    return coordenador_json(g)
