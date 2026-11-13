"""Login, logout, cadastro do aluno e listas públicas (cursos e disciplinas)."""
import re
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..config import LIMITE_CADASTRO, LIMITE_LOGIN
from ..database import get_db
from ..models import Aluno, Curso, Disciplina, Gestor, SenhaAluno, SenhaGestor
from ..protecao import limiter
from ..security import (checa_bloqueio, confere_senha, exige_login, hash_senha,
                        limpa_falhas, registra_falha, senha_falsa, usuario)

router = APIRouter(prefix="/api", tags=["acesso"])


class LoginIn(BaseModel):
    perfil: Literal["aluno", "coordenador"]
    login: str = Field(min_length=3, max_length=254)   # RA ou e-mail
    senha: str = Field(min_length=1, max_length=128)


@router.post("/login")
@limiter.limit(LIMITE_LOGIN)
def login(dados: LoginIn, request: Request, db: Session = Depends(get_db)):
    ip = request.client.host if request.client else "?"
    chave = f"{ip}:{dados.perfil}:{dados.login.lower()}"
    checa_bloqueio(chave)
    login_ = dados.login.strip()

    if dados.perfil == "aluno":
        pessoa = db.scalar(select(Aluno).where(or_(Aluno.ra == login_, Aluno.email == login_.lower())))
        senha = db.get(SenhaAluno, pessoa.id) if pessoa else None
    else:
        pessoa = db.scalar(select(Gestor).where(Gestor.email == login_.lower()))
        senha = db.get(SenhaGestor, pessoa.id) if pessoa else None

    # Sem usuário, confere contra um hash falso: a resposta demora o mesmo e não revela se o RA existe
    senha_ok = confere_senha(dados.senha, senha.senha_hash if senha else senha_falsa())
    if not pessoa or not senha or not senha_ok:
        registra_falha(chave)
        raise HTTPException(401, "RA/e-mail ou senha incorretos.")

    limpa_falhas(chave)
    request.session.clear()
    request.session["user"] = {"id": pessoa.id, "perfil": dados.perfil, "nome": pessoa.nome}
    return request.session["user"]


@router.post("/logout")
def logout(request: Request):
    request.session.clear()
    return {"ok": True}


@router.get("/me")
def me(u: dict = Depends(exige_login)):
    return u


class CadastroIn(BaseModel):
    nome: str = Field(min_length=3, max_length=100)
    ra: str = Field(min_length=4, max_length=20)
    email: EmailStr
    id_curso: int
    senha: str = Field(min_length=8, max_length=128)
    celular: str | None = Field(default=None, max_length=20)
    aceita_whatsapp: bool = False
    aceite_lgpd: bool

    @field_validator("ra")
    @classmethod
    def so_digitos(cls, v: str) -> str:
        v = re.sub(r"\D", "", v)
        if len(v) < 4:
            raise ValueError("RA inválido")
        return v

    @field_validator("senha")
    @classmethod
    def senha_forte(cls, v: str) -> str:
        if not (re.search(r"[A-Za-z]", v) and re.search(r"\d", v)):
            raise ValueError("A senha precisa ter letras e números")
        if len(v.encode("utf-8")) > 72:   # limite do bcrypt (a versão 5 recusa senhas maiores)
            raise ValueError("A senha pode ter no máximo 72 caracteres")
        return v


@router.post("/alunos", status_code=201)
@limiter.limit(LIMITE_CADASTRO)
def cadastrar(dados: CadastroIn, request: Request, db: Session = Depends(get_db)):
    if not dados.aceite_lgpd:
        raise HTTPException(422, "É preciso aceitar o uso dos dados (LGPD) para criar a conta.")
    if not db.get(Curso, dados.id_curso):
        raise HTTPException(422, "Curso inválido.")
    email = dados.email.lower()
    if db.scalar(select(Aluno).where(or_(Aluno.ra == dados.ra, Aluno.email == email))):
        raise HTTPException(409, "Já existe uma conta com esse RA ou e-mail.")
    celular = re.sub(r"\D", "", dados.celular or "") or None
    aluno = Aluno(nome=dados.nome.strip(), ra=dados.ra, email=email, id_curso=dados.id_curso,
                  celular=celular, aceita_whatsapp=bool(dados.aceita_whatsapp and celular))
    db.add(aluno)
    db.flush()
    db.add(SenhaAluno(id_aluno=aluno.id, senha_hash=hash_senha(dados.senha)))
    db.commit()
    request.session.clear()
    request.session["user"] = {"id": aluno.id, "perfil": "aluno", "nome": aluno.nome}
    return request.session["user"]


@router.get("/cursos")
def cursos(db: Session = Depends(get_db)):
    return [{"id": c.id, "nome": c.nome} for c in db.scalars(select(Curso).order_by(Curso.nome))]


@router.get("/disciplinas")
def disciplinas(request: Request, id_curso: int | None = None, db: Session = Depends(get_db)):
    """Disciplinas do curso do aluno logado (ou do curso informado)."""
    u = usuario(request)
    if id_curso is None and u and u["perfil"] == "aluno":
        id_curso = db.get(Aluno, u["id"]).id_curso
    q = select(Disciplina).order_by(Disciplina.nome)
    if id_curso:
        q = q.where(Disciplina.id_curso == id_curso)
    return [{"id": d.id, "nome": d.nome} for d in db.scalars(q)]
