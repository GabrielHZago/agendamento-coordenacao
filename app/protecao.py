"""Proteções da aplicação: limite de requisições, cabeçalhos de segurança e tamanho do corpo.

Camadas contra abuso (da mais externa para a mais interna):
  1. ufw            — só portas 22 e 80 abertas; SSH com "limit" (anti força bruta)
  2. nginx          — conexões simultâneas por IP, taxa por IP, timeouts curtos, corpo máximo
  3. uvicorn        — --limit-concurrency por worker (503 quando lota, em vez de travar)
  4. esta camada    — limite por rota (slowapi), corpo máximo, cabeçalhos (CSP etc.)
  5. rotas          — validação Pydantic, ORM parametrizado, bloqueio de login após 5 falhas
"""
from urllib.parse import urlsplit

from fastapi import Request
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.util import get_remote_address

from .config import LIMITE_REQUISICOES, UPLOAD_MAX_MB, MAX_ARQUIVOS


def chave_do_cliente(request: Request) -> str:
    """Quem conta como "um cliente" para o limite de requisições.

    Logado: conta por usuário. No Wi-Fi da faculdade centenas de alunos saem pelo mesmo IP (NAT),
    e um aluno abusando não pode bloquear a turma toda.
    Sem login (login, cadastro, telas públicas): conta por IP, que é o que segura força bruta.
    """
    usuario = request.session.get("user") if "session" in request.scope else None
    if usuario:
        return f"usuario:{usuario['perfil']}:{usuario['id']}"
    return f"ip:{get_remote_address(request)}"


limiter = Limiter(key_func=chave_do_cliente, default_limits=[LIMITE_REQUISICOES],
                  headers_enabled=False)

# Corpo máximo: todos os anexos no limite + folga para os campos do formulário
CORPO_MAX_BYTES = (UPLOAD_MAX_MB * MAX_ARQUIVOS + 1) * 1024 * 1024

# CSP: só scripts, estilos, fontes e imagens do próprio servidor (sem CDN, sem inline).
# "data:" em img-src: o Bootstrap usa SVG embutido nos ícones de select, checkbox e botão fechar.
CSP = ("default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
       "font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; "
       "form-action 'self'; frame-ancestors 'none'")

CABECALHOS = {
    "X-Content-Type-Options": "nosniff",           # navegador não "adivinha" o tipo do arquivo
    "X-Frame-Options": "DENY",                     # ninguém embute o sistema num iframe (clickjacking)
    "Referrer-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Cross-Origin-Resource-Policy": "same-origin",
}
# Só vale em HTTPS; em HTTP o navegador ignora e ainda mostra erro no console
CABECALHOS_HTTPS = {"Cross-Origin-Opener-Policy": "same-origin"}

# A documentação (/docs) carrega o Swagger de uma CDN; fica sem CSP e só existe com API_DOCS=1
SEM_CSP = ("/docs", "/redoc", "/openapi.json")


METODOS_QUE_ALTERAM = {"POST", "PUT", "PATCH", "DELETE"}


def origem_estrangeira(request: Request) -> bool:
    """CSRF (2ª camada, além do cookie SameSite=strict): pedido que altera dados
    só vale se vier de uma página deste mesmo site. Sem cabeçalho Origin (curl, testes) passa."""
    origem = request.headers.get("origin")
    if not origem or request.method not in METODOS_QUE_ALTERAM:
        return False
    return urlsplit(origem).netloc != request.headers.get("host", "")


async def cabecalhos_e_tamanho(request: Request, call_next):
    tamanho = request.headers.get("content-length")
    if tamanho and tamanho.isdigit() and int(tamanho) > CORPO_MAX_BYTES:
        return JSONResponse({"detail": "Envio grande demais."}, status_code=413)
    if origem_estrangeira(request):
        return JSONResponse({"detail": "Origem não permitida."}, status_code=403)

    resposta = await call_next(request)
    extras = CABECALHOS_HTTPS if request.url.scheme == "https" else {}
    for nome, valor in {**CABECALHOS, **extras}.items():
        resposta.headers.setdefault(nome, valor)
    caminho = request.url.path
    if caminho == "/" or caminho.startswith(("/js/", "/css/")) or caminho.endswith(".html"):
        resposta.headers["Cache-Control"] = "no-cache"   # telas sempre conferidas: HTML e JS da mesma versão
    if not caminho.startswith(SEM_CSP):
        resposta.headers.setdefault("Content-Security-Policy", CSP)
    if caminho.startswith("/api/"):
        resposta.headers["Cache-Control"] = "no-store"   # dados pessoais não ficam em cache
    return resposta


def limite_estourado(request: Request, exc) -> JSONResponse:
    return JSONResponse({"detail": "Muitas requisições em pouco tempo. Aguarde um minuto e tente de novo."},
                        status_code=429, headers={"Retry-After": "60"})
