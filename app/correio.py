"""Envio de e-mail por SMTP (configurado no .env). Usado no "Esqueci a senha"."""
import logging
import smtplib
import ssl
from email.message import EmailMessage

from .config import SMTP_FROM, SMTP_HOST, SMTP_PASSWORD, SMTP_PORT, SMTP_USER

log = logging.getLogger("uvicorn.error")


def configurado() -> bool:
    return bool(SMTP_HOST and SMTP_FROM)


def envia(para: str, assunto: str, texto: str) -> bool:
    """Envia um e-mail de texto. Roda em segundo plano: uma falha vai para o log, não para o usuário."""
    if not configurado():
        return False
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = SMTP_FROM, para, assunto
    msg.set_content(texto)
    contexto = ssl.create_default_context()
    try:
        if SMTP_PORT == 465:
            servidor = smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=contexto, timeout=15)
        else:
            servidor = smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15)
            servidor.starttls(context=contexto)
        with servidor:
            if SMTP_USER:
                servidor.login(SMTP_USER, SMTP_PASSWORD)
            servidor.send_message(msg)
        return True
    except (OSError, smtplib.SMTPException):
        log.exception("Falha ao enviar e-mail para %s", para)
        return False
