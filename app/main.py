"""Ponto de entrada: uvicorn app.main:app"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address
from starlette.middleware.sessions import SessionMiddleware

from .config import FRONTEND_DIR, LIMITE_REQUISICOES, SECRET_KEY
from .database import IS_SQLITE, Base, SessionLocal, engine
from .routers import agenda, agendamentos, auth, motivos

@asynccontextmanager
async def ciclo_de_vida(_app: FastAPI):
    preparar_sqlite()
    yield


def preparar_sqlite():
    """Teste local sem SQL Server: cria as tabelas e os status no SQLite."""
    if not IS_SQLITE:
        return
    from .models import Status
    from .config import NOMES_STATUS
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        if not db.get(Status, 1):
            db.add_all(Status(id=i, nome=n) for i, n in NOMES_STATUS.items())
            db.commit()


app = FastAPI(
    title="Agendamento da Coordenação — Tech Titans",
    description="API do sistema de agendamento entre alunos e coordenação.",
    version="1.0",
    lifespan=ciclo_de_vida,
)

# RNF13: limite de requisições por endereço
limiter = Limiter(key_func=get_remote_address, default_limits=[LIMITE_REQUISICOES])
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# RNF16: cookie de sessão HttpOnly e SameSite. Com HTTPS (publicação), troque https_only para True.
app.add_middleware(SessionMiddleware, secret_key=SECRET_KEY, session_cookie="agendamento_sessao",
                   max_age=8 * 3600, same_site="strict", https_only=False)

for r in (auth.router, motivos.router, agenda.router, agendamentos.router):
    app.include_router(r)


@app.get("/api/saude", tags=["sistema"])
def saude():
    return {"ok": True}


# As telas (frontend/) são servidas pelo próprio FastAPI, na raiz do site
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="telas")
