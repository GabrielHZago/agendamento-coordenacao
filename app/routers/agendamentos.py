"""Pedidos de reunião: marcar (confirmação automática), pedidos online, cancelar, concluir e avaliar."""
import uuid
from pathlib import Path
from datetime import date, datetime, timedelta
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import case, func, select
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.orm import Session

from ..config import (ANTECEDENCIA_MIN_HORAS, APROVADA, CANCELADA, CANCELAMENTO_MIN_HORAS,
                      LIMITE_AGENDAMENTO, MAX_ARQUIVOS, PENDENTE, REALIZADA, RECUSADA,
                      UPLOAD_DIR, UPLOAD_MAX_MB)
from ..database import IS_SQLITE, get_db
from ..models import (Agendamento, Aluno, Anexo, Avaliacao, Disciplina, Gestor, Motivo,
                      Notificacao)
from ..protecao import limiter
from ..security import exige_aluno, exige_gestor, exige_login
from ..servicos import (agendamento_json, avisa, busca_texto, gestores_do_aluno, quando,
                        valida_periodo)

router = APIRouter(prefix="/api", tags=["agendamentos"])

TIPOS = {b"%PDF": ".pdf", b"\x89PNG": ".png", b"\xff\xd8\xff": ".jpg"}  # RNF17: confere o conteúdo real


async def _le_arquivo(arq: UploadFile) -> tuple[bytes, str, str]:
    """Lê e confere o arquivo (tamanho e tipo real). Ainda não grava nada no disco."""
    conteudo = await arq.read(UPLOAD_MAX_MB * 1024 * 1024 + 1)
    if len(conteudo) > UPLOAD_MAX_MB * 1024 * 1024:
        raise HTTPException(413, f"O arquivo {arq.filename} passa de {UPLOAD_MAX_MB} MB.")
    ext = next((e for magica, e in TIPOS.items() if conteudo.startswith(magica)), None)
    if not ext:
        raise HTTPException(415, f"{arq.filename}: envie PDF, JPG ou PNG.")
    nome_original = Path(arq.filename or "arquivo").name[:200]   # sem pastas no nome
    return conteudo, ext, nome_original


def _grava_arquivo(conteudo: bytes, ext: str) -> str:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    nome = f"{uuid.uuid4().hex}{ext}"          # nome gerado pelo sistema, nunca o do aluno
    (UPLOAD_DIR / nome).write_bytes(conteudo)
    return nome


# ======================= ALUNO =======================
@router.post("/agendamentos", status_code=201)
@limiter.limit(LIMITE_AGENDAMENTO)
async def solicitar(
    request: Request,
    id_motivo: int = Form(...),
    titulo: str = Form(..., min_length=3, max_length=100),
    descricao: str | None = Form(None, max_length=500),
    id_disciplina: int | None = Form(None),
    inicio: datetime | None = Form(None),
    id_gestor: int | None = Form(None),
    documentos: list[int] = Form([]),            # id do documento de cada arquivo, na mesma ordem
    arquivos: list[UploadFile] = File([]),
    u: dict = Depends(exige_aluno),
    db: Session = Depends(get_db),
):
    if not IS_SQLITE:
        # Isola a transação para dois alunos não pegarem o mesmo horário ao mesmo tempo (RN01)
        db.connection(execution_options={"isolation_level": "SERIALIZABLE"})
    aluno = db.get(Aluno, u["id"])
    motivo = db.get(Motivo, id_motivo)
    if not motivo or not motivo.ativo:
        raise HTTPException(404, "Motivo não encontrado.")
    if motivo.destino == "SECRETARIA":     # RN13
        raise HTTPException(422, motivo.orientacao or "Esse assunto é tratado pela secretaria.")
    if motivo.exige_disciplina:
        disc = db.get(Disciplina, id_disciplina) if id_disciplina else None
        if not disc or disc.id_curso != aluno.id_curso:
            raise HTTPException(422, "Escolha uma disciplina do seu curso.")
    else:
        id_disciplina = None

    # RN17: documentos obrigatórios
    obrigatorios = {d.id_documento for d in motivo.documentos if d.obrigatorio}
    if len(arquivos) > MAX_ARQUIVOS:
        raise HTTPException(422, f"Envie no máximo {MAX_ARQUIVOS} arquivos.")
    if len(documentos) != len(arquivos):
        raise HTTPException(422, "Cada arquivo precisa indicar qual documento é.")
    if not set(documentos) <= {d.id_documento for d in motivo.documentos}:
        raise HTTPException(422, "Documento não pedido para esse motivo.")
    faltando = obrigatorios - set(documentos)
    if faltando:
        nomes = [d.documento.nome for d in motivo.documentos if d.id_documento in faltando]
        raise HTTPException(422, "Anexe: " + ", ".join(nomes))

    lidos = [await _le_arquivo(arq) for arq in arquivos]   # confere todos antes de gravar qualquer um

    gestores = gestores_do_aluno(db, aluno, id_disciplina)
    if not gestores:
        raise HTTPException(422, "Não há coordenador cadastrado para o seu curso.")

    if motivo.atendimento == "ONLINE":
        gestor = gestores[0]
        ag = Agendamento(id_aluno=aluno.id, id_gestor=gestor.id, id_motivo=motivo.id,
                         id_disciplina=id_disciplina, id_status=PENDENTE,
                         titulo=titulo.strip(), descricao=(descricao or "").strip() or None)
    else:
        if not inicio or not id_gestor:
            raise HTTPException(422, "Escolha um horário.")
        if id_gestor not in {g.id for g in gestores}:
            raise HTTPException(422, "Esse coordenador não atende o seu curso ou disciplina.")
        inicio = inicio.replace(second=0, microsecond=0, tzinfo=None)
        if inicio < datetime.now() + timedelta(hours=ANTECEDENCIA_MIN_HORAS):     # RN03
            raise HTTPException(422, f"Escolha um horário com pelo menos {ANTECEDENCIA_MIN_HORAS} h de antecedência.")
        futura = db.scalar(select(Agendamento).where(                             # RN05
            Agendamento.id_aluno == aluno.id, Agendamento.id_status == APROVADA,
            Agendamento.inicio > datetime.now()))
        if futura:
            raise HTTPException(422, f"Você já tem uma reunião marcada ({quando(futura.inicio)}). "
                                     "Cancele-a para marcar outra.")
        fim = inicio + timedelta(minutes=motivo.duracao_min or 30)
        try:
            local = valida_periodo(db, id_gestor, inicio, fim)
        except ValueError as e:
            raise HTTPException(409, str(e))
        ag = Agendamento(id_aluno=aluno.id, id_gestor=id_gestor, id_motivo=motivo.id,
                         id_disciplina=id_disciplina, id_status=APROVADA,   # confirmação automática (RN08)
                         inicio=inicio, fim=fim, local=local,
                         titulo=titulo.strip(), descricao=(descricao or "").strip() or None)

    db.add(ag)
    try:
        db.flush()
        for id_doc, (conteudo, ext, nome) in zip(documentos, lidos):
            caminho = _grava_arquivo(conteudo, ext)
            db.add(Anexo(id_agendamento=ag.id, id_documento=id_doc, nome_arquivo=nome, caminho=caminho))
        db.refresh(ag)
        if ag.id_status == APROVADA:
            avisa(db, ag, f"Reunião confirmada: {quando(ag.inicio)}, {ag.local}, com {ag.gestor.nome}.")
        else:
            avisa(db, ag, f"Pedido recebido: {motivo.nome}. Você será avisado quando o coordenador responder.")
        db.commit()
    except (IntegrityError, DBAPIError):
        db.rollback()
        raise HTTPException(409, "Esse horário acabou de ser ocupado. Escolha outro.")
    db.refresh(ag)
    return agendamento_json(ag)


@router.get("/agendamentos/meus")
def meus(q: str | None = None, u: dict = Depends(exige_aluno), db: Session = Depends(get_db)):
    consulta = select(Agendamento).where(Agendamento.id_aluno == u["id"])
    filtro = busca_texto(Agendamento.titulo, Agendamento.descricao, q)
    if filtro is not None:
        consulta = consulta.where(filtro)
    consulta = consulta.order_by(Agendamento.criado_em.desc())
    return [agendamento_json(a) for a in db.scalars(consulta).unique()]


class CancelaIn(BaseModel):
    motivo: str | None = Field(default=None, max_length=200)


@router.patch("/agendamentos/{id_ag}/cancelar")
def cancelar(id_ag: int, dados: CancelaIn | None = None, u: dict = Depends(exige_login),
             db: Session = Depends(get_db)):
    ag = db.get(Agendamento, id_ag)
    if not ag:
        raise HTTPException(404, "Pedido não encontrado.")
    if u["perfil"] == "aluno":
        if ag.id_aluno != u["id"]:
            raise HTTPException(404, "Pedido não encontrado.")
        if ag.id_status not in (PENDENTE, APROVADA):
            raise HTTPException(422, "Esse pedido não pode mais ser cancelado.")
        if ag.inicio and ag.inicio - datetime.now() < timedelta(hours=CANCELAMENTO_MIN_HORAS):   # RN04
            raise HTTPException(422, f"Só é possível cancelar até {CANCELAMENTO_MIN_HORAS} h antes.")
        ag.cancelado_por = "ALUNO"
        ag.observacao = (dados.motivo if dados else None) or "Cancelada pelo aluno"
    else:   # coordenador cancela reunião confirmada (RF18)
        if ag.id_gestor != u["id"] or ag.id_status != APROVADA:
            raise HTTPException(422, "Só é possível cancelar reuniões confirmadas da sua agenda.")
        ag.cancelado_por = "GESTOR"
        ag.observacao = f"Cancelada pelo coordenador: {(dados.motivo if dados else None) or 'imprevisto'}"[:300]
        avisa(db, ag, f"Sua reunião de {quando(ag.inicio)} foi cancelada pelo coordenador. "
                      "Escolha outro horário em Nova solicitação.")
    ag.id_status = CANCELADA
    db.commit()
    return agendamento_json(ag)


class AvaliacaoIn(BaseModel):
    nota: int = Field(ge=1, le=10)
    comentario: str | None = Field(default=None, max_length=500)


@router.post("/agendamentos/{id_ag}/avaliacao", status_code=201)
def avaliar(id_ag: int, dados: AvaliacaoIn, u: dict = Depends(exige_aluno), db: Session = Depends(get_db)):
    ag = db.get(Agendamento, id_ag)
    if not ag or ag.id_aluno != u["id"]:
        raise HTTPException(404, "Pedido não encontrado.")
    if ag.id_status != REALIZADA:                       # RN09
        raise HTTPException(422, "Só reuniões realizadas podem ser avaliadas.")
    if ag.avaliacao:
        raise HTTPException(409, "Essa reunião já foi avaliada.")
    db.add(Avaliacao(id_agendamento=ag.id, nota=dados.nota, comentario=dados.comentario))
    db.commit()
    return {"ok": True}


# ======================= COORDENADOR =======================
@router.get("/agenda")
def agenda(inicio: date | None = None, fim: date | None = None, id_status: int | None = None,
           id_motivo: int | None = None, q: str | None = None,
           u: dict = Depends(exige_gestor), db: Session = Depends(get_db)):
    """Reuniões do coordenador por período, status e motivo (RF22)."""
    quando_col = func.coalesce(Agendamento.inicio, Agendamento.criado_em)
    consulta = select(Agendamento).where(Agendamento.id_gestor == u["id"])
    if inicio:
        consulta = consulta.where(quando_col >= datetime.combine(inicio, datetime.min.time()))
    if fim:
        consulta = consulta.where(quando_col < datetime.combine(fim + timedelta(days=1), datetime.min.time()))
    if id_status:
        consulta = consulta.where(Agendamento.id_status == id_status)
    if id_motivo:
        consulta = consulta.where(Agendamento.id_motivo == id_motivo)
    filtro = busca_texto(Agendamento.titulo, Agendamento.descricao, q)
    if filtro is not None:
        consulta = consulta.where(filtro)
    consulta = consulta.order_by(quando_col)
    return [agendamento_json(a, para_gestor=True) for a in db.scalars(consulta).unique()]


@router.get("/pendentes")
def pendentes(u: dict = Depends(exige_gestor), db: Session = Depends(get_db)):
    """Pedidos online aguardando resposta: prazo mais próximo, depois prioridade, depois chegada (RN14)."""
    consulta = (select(Agendamento).join(Motivo)
                .where(Agendamento.id_gestor == u["id"], Agendamento.id_status == PENDENTE)
                .order_by(case((Motivo.data_limite.is_(None), 1), else_=0), Motivo.data_limite,
                          Motivo.prioridade, Agendamento.criado_em))
    return [agendamento_json(a, para_gestor=True) for a in db.scalars(consulta).unique()]


class DecisaoIn(BaseModel):
    aceitar: bool
    observacao: str | None = Field(default=None, max_length=300)


@router.patch("/agendamentos/{id_ag}/decisao")
def decidir(id_ag: int, dados: DecisaoIn, u: dict = Depends(exige_gestor), db: Session = Depends(get_db)):
    """Aceitar ou recusar pedido online, como entrega de atestado (RF17)."""
    ag = db.get(Agendamento, id_ag)
    if not ag or ag.id_gestor != u["id"]:
        raise HTTPException(404, "Pedido não encontrado.")
    if ag.id_status != PENDENTE:
        raise HTTPException(422, "Esse pedido já foi respondido.")
    ag.id_status = APROVADA if dados.aceitar else RECUSADA
    ag.observacao = dados.observacao
    texto = "aceito" if dados.aceitar else "recusado"
    avisa(db, ag, f"Seu pedido \"{ag.titulo}\" foi {texto}."
                  + (f" Observação: {dados.observacao}" if dados.observacao else ""))
    db.commit()
    return agendamento_json(ag, para_gestor=True)


@router.patch("/agendamentos/{id_ag}/realizada")
def realizada(id_ag: int, u: dict = Depends(exige_gestor), db: Session = Depends(get_db)):
    ag = db.get(Agendamento, id_ag)
    if not ag or ag.id_gestor != u["id"]:
        raise HTTPException(404, "Reunião não encontrada.")
    if ag.id_status != APROVADA or not ag.inicio:
        raise HTTPException(422, "Só reuniões confirmadas podem ser concluídas.")
    if ag.inicio > datetime.now():
        raise HTTPException(422, "A reunião ainda não começou.")
    ag.id_status = REALIZADA
    avisa(db, ag, "Reunião realizada com sucesso. Avalie o atendimento de 1 a 10 em Meus pedidos.")
    db.commit()
    return agendamento_json(ag, para_gestor=True)


@router.get("/agendamentos/{id_ag}/whatsapp")
def link_whatsapp(id_ag: int, u: dict = Depends(exige_gestor), db: Session = Depends(get_db)):
    """Link wa.me com a mensagem pronta (envio manual pelo coordenador, sem API paga)."""
    ag = db.get(Agendamento, id_ag)
    if not ag or ag.id_gestor != u["id"]:
        raise HTTPException(404, "Pedido não encontrado.")
    if not (ag.aluno.aceita_whatsapp and ag.aluno.celular):
        raise HTTPException(422, "O aluno não autorizou contato por WhatsApp.")
    numero = ag.aluno.celular if ag.aluno.celular.startswith("55") else "55" + ag.aluno.celular
    texto = f"Olá, {ag.aluno.nome.split()[0]}! Sobre seu pedido \"{ag.titulo}\": "
    return {"link": f"https://wa.me/{numero}?text={quote(texto)}"}


@router.get("/anexos/{id_anexo}")
def baixar_anexo(id_anexo: int, u: dict = Depends(exige_login), db: Session = Depends(get_db)):
    anexo = db.get(Anexo, id_anexo)
    ag = db.get(Agendamento, anexo.id_agendamento) if anexo else None
    dono = ag and ((u["perfil"] == "aluno" and ag.id_aluno == u["id"]) or
                   (u["perfil"] == "coordenador" and ag.id_gestor == u["id"]))
    if not dono:
        raise HTTPException(404, "Arquivo não encontrado.")
    return FileResponse(UPLOAD_DIR / anexo.caminho, filename=anexo.nome_arquivo)


# ======================= AVISOS =======================
@router.get("/notificacoes")
def notificacoes(u: dict = Depends(exige_aluno), db: Session = Depends(get_db)):
    consulta = (select(Notificacao).join(Agendamento)
                .where(Agendamento.id_aluno == u["id"], Notificacao.canal == "SISTEMA")
                .order_by(Notificacao.criada_em.desc()).limit(20))
    return [{"id": n.id, "mensagem": n.mensagem, "lida": bool(n.lida),
             "criada_em": n.criada_em.isoformat(timespec="minutes")} for n in db.scalars(consulta)]


@router.patch("/notificacoes/lidas")
def marcar_lidas(u: dict = Depends(exige_aluno), db: Session = Depends(get_db)):
    ids = select(Agendamento.id).where(Agendamento.id_aluno == u["id"])
    for n in db.scalars(select(Notificacao).where(Notificacao.id_agendamento.in_(ids), Notificacao.lida.is_(False))):
        n.lida = True
    db.commit()
    return {"ok": True}
