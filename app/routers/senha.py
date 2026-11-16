"""Esqueci a senha: link por e-mail, assinado, que vale 30 minutos e só pode ser usado uma vez.

Não precisa de tabela no banco: o link carrega (perfil, id, impressão da senha atual) assinados com a
SECRET_KEY. Quando a senha muda, a impressão muda e o link antigo deixa de valer.
"""
import hashlib
import logging
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import correio
from ..config import (LIMITE_LOGIN, LIMITE_RECUPERACAO, RECUPERACAO_MOSTRA_LINK,
                      RECUPERACAO_VALIDADE_MIN, SECRET_KEY)
from ..database import get_db
from ..models import Aluno, Gestor, SenhaAluno, SenhaGestor, agora
from ..protecao import limiter
from ..security import hash_senha, valida_senha

router = APIRouter(prefix="/api/senha", tags=["acesso"])
log = logging.getLogger("uvicorn.error")
_assinador = URLSafeTimedSerializer(SECRET_KEY, salt="redefinir-senha")
TABELAS = {"aluno": (Aluno, SenhaAluno), "coordenador": (Gestor, SenhaGestor)}


def _impressao(senha_hash: str) -> str:
    return hashlib.sha256(senha_hash.encode()).hexdigest()[:16]


class EsqueciIn(BaseModel):
    perfil: Literal["aluno", "coordenador"] = "aluno"
    email: EmailStr


@router.post("/esqueci")
@limiter.limit(LIMITE_RECUPERACAO)
def esqueci(dados: EsqueciIn, request: Request, tarefas: BackgroundTasks, db: Session = Depends(get_db)):
    Pessoa, Senha = TABELAS[dados.perfil]
    pessoa = db.scalar(select(Pessoa).where(Pessoa.email == dados.email.lower()))
    senha = db.get(Senha, pessoa.id) if pessoa else None
    # A resposta é a mesma exista ou não o e-mail: ninguém descobre quem tem conta
    resposta = {"mensagem": f"Se o e-mail estiver cadastrado, enviamos um link para criar uma senha nova. "
                            f"Ele vale por {RECUPERACAO_VALIDADE_MIN} minutos."}
    if pessoa and senha:
        token = _assinador.dumps({"p": dados.perfil, "id": pessoa.id, "h": _impressao(senha.senha_hash)})
        link = f"{str(request.base_url).rstrip('/')}/#redefinir?t={token}"
        texto = (f"Olá, {pessoa.nome.split()[0]}.\n\n"
                 f"Recebemos um pedido para redefinir a sua senha na Agenda da Coordenação.\n"
                 f"Para criar uma senha nova, abra o link abaixo (vale por {RECUPERACAO_VALIDADE_MIN} minutos):\n\n"
                 f"{link}\n\nSe não foi você, ignore este e-mail: a sua senha atual continua valendo.\n")
        if correio.configurado():
            tarefas.add_task(correio.envia, pessoa.email, "Redefinição de senha - Agenda da Coordenação", texto)
        else:
            log.warning("SMTP não configurado. Link de redefinição para %s: %s", pessoa.email, link)
        if RECUPERACAO_MOSTRA_LINK:
            resposta["link"] = link
    return resposta


class RedefinirIn(BaseModel):
    token: str = Field(min_length=10, max_length=500)
    senha: str = Field(max_length=128)

    @field_validator("senha")
    @classmethod
    def senha_forte(cls, v: str) -> str:
        return valida_senha(v)


@router.post("/redefinir")
@limiter.limit(LIMITE_LOGIN)
def redefinir(dados: RedefinirIn, request: Request, db: Session = Depends(get_db)):
    try:
        conteudo = _assinador.loads(dados.token, max_age=RECUPERACAO_VALIDADE_MIN * 60)
    except SignatureExpired:
        raise HTTPException(422, "Este link expirou. Peça um novo em \"Esqueci minha senha\".")
    except BadSignature:
        raise HTTPException(422, "Link inválido. Peça um novo em \"Esqueci minha senha\".")
    _, Senha = TABELAS.get(conteudo.get("p"), (None, None))
    senha = db.get(Senha, conteudo.get("id")) if Senha else None
    if not senha or _impressao(senha.senha_hash) != conteudo.get("h"):
        raise HTTPException(422, "Este link já foi usado. Peça um novo em \"Esqueci minha senha\".")
    senha.senha_hash = hash_senha(dados.senha)
    senha.atualizada_em = agora()
    db.commit()
    return {"ok": True}
