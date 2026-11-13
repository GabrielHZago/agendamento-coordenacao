"""Senhas (bcrypt), sessão por perfil e bloqueio de tentativas de login (RNF05, RNF06, RNF13)."""
import time

import bcrypt
from fastapi import HTTPException, Request

from .config import LOGIN_BLOQUEIO_MIN, LOGIN_MAX_TENTATIVAS


def hash_senha(senha: str) -> str:
    return bcrypt.hashpw(senha.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def confere_senha(senha: str, senha_hash: str) -> bool:
    try:
        return bcrypt.checkpw(senha.encode("utf-8"), senha_hash.encode("utf-8"))
    except ValueError:
        return False


# Tentativas de login por "IP + login" (em memória; reinicia com o serviço)
_falhas: dict[str, list[float]] = {}


def _recentes(chave: str) -> list[float]:
    limite = time.time() - LOGIN_BLOQUEIO_MIN * 60
    _falhas[chave] = [t for t in _falhas.get(chave, []) if t > limite]
    return _falhas[chave]


def checa_bloqueio(chave: str) -> None:
    if len(_recentes(chave)) >= LOGIN_MAX_TENTATIVAS:
        raise HTTPException(429, f"Muitas tentativas. Tente de novo em {LOGIN_BLOQUEIO_MIN} minutos.")


def registra_falha(chave: str) -> None:
    _recentes(chave).append(time.time())


def limpa_falhas(chave: str) -> None:
    _falhas.pop(chave, None)


# ---------- Sessão ----------
def usuario(request: Request) -> dict | None:
    return request.session.get("user")


def exige_login(request: Request) -> dict:
    u = usuario(request)
    if not u:
        raise HTTPException(401, "Faça login para continuar.")
    return u


def exige_aluno(request: Request) -> dict:
    u = exige_login(request)
    if u["perfil"] != "aluno":
        raise HTTPException(403, "Área exclusiva do aluno.")
    return u


def exige_gestor(request: Request) -> dict:
    u = exige_login(request)
    if u["perfil"] != "coordenador":
        raise HTTPException(403, "Área exclusiva do coordenador.")
    return u
