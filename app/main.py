"""Ponto de entrada: uvicorn app.main:app"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from starlette.middleware.sessions import SessionMiddleware

from .config import API_DOCS, FRONTEND_DIR, SECRET_KEY
from .database import IS_SQLITE, Base, SessionLocal, engine
from .protecao import cabecalhos_e_tamanho, limite_estourado, limiter
from .routers import admin, agenda, agendamentos, auth, motivos, senha


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
    docs_url="/docs" if API_DOCS else None,
    redoc_url=None,
    openapi_url="/openapi.json" if API_DOCS else None,
)

# RNF13: limite de requisições por cliente (padrão em todas as rotas + limites próprios nas sensíveis)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, limite_estourado)
app.add_middleware(SlowAPIMiddleware)

# Cabeçalhos de segurança (CSP, nosniff, anti-iframe) e corpo máximo da requisição
app.middleware("http")(cabecalhos_e_tamanho)

# RNF16: cookie de sessão HttpOnly e SameSite. Com HTTPS (publicação), troque https_only para True.
app.add_middleware(SessionMiddleware, secret_key=SECRET_KEY, session_cookie="agendamento_sessao",
                   max_age=8 * 3600, same_site="strict", https_only=False)

for r in (auth.router, senha.router, motivos.router, agenda.router, agendamentos.router, admin.router):
    app.include_router(r)


@app.get("/api/saude", tags=["sistema"])
def saude():
    return {"ok": True}


# As telas (frontend/) são servidas pelo próprio FastAPI, na raiz do site
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="telas")
