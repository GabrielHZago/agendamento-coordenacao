"""Tela escondida #admin: criar coordenador e definir os cursos e as disciplinas que ele atende.

Protegida por uma chave (ADMIN_KEY no .env, gerada pelo instalar.sh), enviada no cabeçalho X-Chave-Admin.
Sem chave configurada, as rotas respondem 404 (a tela não existe).
"""
import hmac

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import ADMIN_KEY, LIMITE_ADMIN
from ..database import get_db
from ..models import Curso, Disciplina, Gestor, SenhaGestor
from ..protecao import limiter
from ..security import hash_senha, valida_senha

router = APIRouter(prefix="/api/admin", tags=["administração"])


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
