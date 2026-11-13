"""Regras centrais: cálculo de horários livres, conflitos, avisos e formatação."""
from datetime import date, datetime, timedelta

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .config import ANTECEDENCIA_MIN_HORAS, APROVADA, DIAS_AGENDA, NOMES_STATUS
from .models import Agendamento, Aluno, Ausencia, Escala, Gestor, Notificacao


def _sobrepoe(a_ini, a_fim, b_ini, b_fim) -> bool:
    return a_ini < b_fim and b_ini < a_fim


def gestores_do_aluno(db: Session, aluno: Aluno, id_disciplina: int | None = None) -> list[Gestor]:
    """Coordenadores que atendem o aluno: os da disciplina escolhida ou, sem disciplina, os do curso (RN07, RN15)."""
    if id_disciplina:
        from .models import gestores_disciplinas
        q = select(Gestor).join(gestores_disciplinas).where(gestores_disciplinas.c.id_disciplina == id_disciplina)
        gestores = list(db.scalars(q).unique())
        if gestores:
            return gestores
    from .models import gestores_cursos
    q = select(Gestor).join(gestores_cursos).where(gestores_cursos.c.id_curso == aluno.id_curso)
    return list(db.scalars(q).unique())


def _bloqueios(db: Session, gestor_ids: list[int], de: datetime, ate: datetime) -> dict[int, list[tuple]]:
    """Períodos ocupados por reservas do coordenador e reuniões confirmadas."""
    bloq: dict[int, list[tuple]] = {g: [] for g in gestor_ids}
    for a in db.scalars(select(Ausencia).where(
            Ausencia.id_gestor.in_(gestor_ids), Ausencia.fim > de, Ausencia.inicio < ate)):
        bloq[a.id_gestor].append((a.inicio, a.fim))
    for ag in db.scalars(select(Agendamento).where(
            Agendamento.id_gestor.in_(gestor_ids), Agendamento.id_status == APROVADA,
            Agendamento.inicio.is_not(None), Agendamento.fim > de, Agendamento.inicio < ate)):
        bloq[ag.id_gestor].append((ag.inicio, ag.fim))
    return bloq


def horarios_livres(db: Session, gestores: list[Gestor], duracao_min: int) -> list[dict]:
    """Horário livre = escala - reservas do coordenador - reuniões confirmadas (RN01, RN03, RN06, RN12)."""
    if not gestores:
        return []
    ids = [g.id for g in gestores]
    nomes = {g.id: g.nome for g in gestores}
    agora = datetime.now()
    de = agora + timedelta(hours=ANTECEDENCIA_MIN_HORAS)
    ate = datetime.combine(date.today() + timedelta(days=DIAS_AGENDA), datetime.min.time())
    escalas = list(db.scalars(select(Escala).where(Escala.id_gestor.in_(ids))))
    bloq = _bloqueios(db, ids, de, ate)
    duracao = timedelta(minutes=duracao_min)
    passo = timedelta(minutes=duracao_min if duracao_min <= 30 else 30)

    por_dia: dict[str, list[dict]] = {}
    dia = de.date()
    while dia < ate.date():
        for esc in (e for e in escalas if e.dia_semana == dia.isoweekday()):
            t = datetime.combine(dia, esc.hora_inicio)
            fim_bloco = datetime.combine(dia, esc.hora_fim)
            while t + duracao <= fim_bloco:
                if t >= de and not any(_sobrepoe(t, t + duracao, b0, b1) for b0, b1 in bloq[esc.id_gestor]):
                    por_dia.setdefault(dia.isoformat(), []).append({
                        "inicio": t.isoformat(timespec="minutes"),
                        "fim": (t + duracao).isoformat(timespec="minutes"),
                        "gestor_id": esc.id_gestor,
                        "gestor": nomes[esc.id_gestor],
                        "local": esc.local,
                    })
                t += passo
        dia += timedelta(days=1)
    return [{"data": d, "horarios": sorted(h, key=lambda x: x["inicio"])} for d, h in sorted(por_dia.items())]


def valida_periodo(db: Session, id_gestor: int, inicio: datetime, fim: datetime) -> str:
    """Confere se o período cabe na escala e está livre. Devolve o local; erro vira ValueError."""
    escala = next((e for e in db.scalars(select(Escala).where(
        Escala.id_gestor == id_gestor, Escala.dia_semana == inicio.isoweekday()))
        if datetime.combine(inicio.date(), e.hora_inicio) <= inicio
        and fim <= datetime.combine(inicio.date(), e.hora_fim)), None)
    if not escala:
        raise ValueError("Esse horário está fora da agenda do coordenador.")
    bloq = _bloqueios(db, [id_gestor], inicio, fim)[id_gestor]
    if any(_sobrepoe(inicio, fim, b0, b1) for b0, b1 in bloq):
        raise ValueError("Esse horário acabou de ser ocupado. Escolha outro.")
    return escala.local


def avisa(db: Session, ag: Agendamento, mensagem: str) -> None:
    """Aviso no sistema + e-mail na fila; WhatsApp na fila só com autorização do aluno (RF19, RF26, RF27, RN19)."""
    db.add(Notificacao(id_agendamento=ag.id, canal="SISTEMA", mensagem=mensagem[:300]))
    db.add(Notificacao(id_agendamento=ag.id, canal="EMAIL", mensagem=mensagem[:300]))
    if ag.aluno.aceita_whatsapp and ag.aluno.celular:
        db.add(Notificacao(id_agendamento=ag.id, canal="WHATSAPP", mensagem=mensagem[:300]))


def quando(dt: datetime | None) -> str:
    return dt.strftime("%d/%m às %H:%M") if dt else ""


def agendamento_json(ag: Agendamento, *, para_gestor: bool = False) -> dict:
    d = {
        "id": ag.id,
        "status": NOMES_STATUS.get(ag.id_status, "?"),
        "id_status": ag.id_status,
        "motivo": ag.motivo.nome,
        "atendimento": ag.motivo.atendimento,
        "disciplina": ag.disciplina.nome if ag.disciplina else None,
        "titulo": ag.titulo,
        "descricao": ag.descricao,
        "inicio": ag.inicio.isoformat(timespec="minutes") if ag.inicio else None,
        "fim": ag.fim.isoformat(timespec="minutes") if ag.fim else None,
        "local": ag.local,
        "gestor": ag.gestor.nome,
        "observacao": ag.observacao,
        "cancelado_por": ag.cancelado_por,
        "criado_em": ag.criado_em.isoformat(timespec="minutes") if ag.criado_em else None,
        "avaliacao": ({"nota": ag.avaliacao.nota, "comentario": ag.avaliacao.comentario}
                      if ag.avaliacao else None),
        "anexos": [{"id": a.id, "documento": a.documento.nome, "arquivo": a.nome_arquivo} for a in ag.anexos],
    }
    if para_gestor:
        d["aluno"] = {"nome": ag.aluno.nome, "ra": ag.aluno.ra, "email": ag.aluno.email,
                      "whatsapp": bool(ag.aluno.aceita_whatsapp and ag.aluno.celular)}
        d["prioridade"] = ag.motivo.prioridade
        d["data_limite"] = ag.motivo.data_limite.isoformat() if ag.motivo.data_limite else None
    return d


def busca_texto(coluna_titulo, coluna_descricao, q: str | None):
    """Filtro de palavra-chave no título ou na descrição (RF13). Parametrizado: sem SQL injection."""
    if not q:
        return None
    termo = q.strip()[:60]
    if not termo:
        return None
    # % e _ digitados pelo usuário viram texto comum, não curinga do LIKE
    termo = termo.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    padrao = f"%{termo}%"
    return or_(coluna_titulo.ilike(padrao, escape="\\"), coluna_descricao.ilike(padrao, escape="\\"))
