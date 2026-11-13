"""Mapeamento das tabelas criadas por database/script_banco_agendamento.sql (versão 4).

O SQL Server já tem as tabelas: aqui só dizemos ao SQLAlchemy como elas são.
No SQLite (teste local), as tabelas são criadas a partir daqui.
"""
from datetime import date, datetime, time

from sqlalchemy import (Boolean, Column, Date, DateTime, ForeignKey, Index, Integer,
                        SmallInteger, String, Table, Time, UniqueConstraint, text)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def agora() -> datetime:
    return datetime.now().replace(microsecond=0)


# ---------- Associações N:N (tassoc_) ----------
gestores_cursos = Table(
    "tassoc_tb_gestores_tb_cursos", Base.metadata,
    Column("id_gestor", ForeignKey("tb_gestores.id"), primary_key=True),
    Column("id_curso", ForeignKey("tb_cursos.id"), primary_key=True),
)

gestores_disciplinas = Table(
    "tassoc_tb_gestores_tb_disciplinas", Base.metadata,
    Column("id_gestor", ForeignKey("tb_gestores.id"), primary_key=True),
    Column("id_disciplina", ForeignKey("tb_disciplinas.id"), primary_key=True),
)


# ---------- Cursos, disciplinas e pessoas ----------
class Curso(Base):
    __tablename__ = "tb_cursos"
    id: Mapped[int] = mapped_column(primary_key=True)
    nome: Mapped[str] = mapped_column(String(100), unique=True)


class Disciplina(Base):
    __tablename__ = "tb_disciplinas"
    __table_args__ = (UniqueConstraint("id_curso", "nome", name="uq_disciplina"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    nome: Mapped[str] = mapped_column(String(100))
    id_curso: Mapped[int] = mapped_column(ForeignKey("tb_cursos.id"))


class Gestor(Base):
    __tablename__ = "tb_gestores"
    id: Mapped[int] = mapped_column(primary_key=True)
    nome: Mapped[str] = mapped_column(String(100))
    email: Mapped[str] = mapped_column(String(254), unique=True)
    whatsapp: Mapped[str | None] = mapped_column(String(20))
    max_disciplinas: Mapped[int | None] = mapped_column(SmallInteger)
    cursos: Mapped[list[Curso]] = relationship(secondary=gestores_cursos)
    disciplinas: Mapped[list[Disciplina]] = relationship(secondary=gestores_disciplinas)


class Aluno(Base):
    __tablename__ = "tb_alunos"
    id: Mapped[int] = mapped_column(primary_key=True)
    nome: Mapped[str] = mapped_column(String(100))
    email: Mapped[str] = mapped_column(String(254), unique=True)
    ra: Mapped[str] = mapped_column(String(20), unique=True)
    celular: Mapped[str | None] = mapped_column(String(20))
    aceita_whatsapp: Mapped[bool] = mapped_column(Boolean, default=False)
    id_curso: Mapped[int] = mapped_column(ForeignKey("tb_cursos.id"))
    curso: Mapped[Curso] = relationship()


class SenhaAluno(Base):
    __tablename__ = "tb_senhas_alunos"
    id_aluno: Mapped[int] = mapped_column(ForeignKey("tb_alunos.id"), primary_key=True)
    senha_hash: Mapped[str] = mapped_column(String(255))
    atualizada_em: Mapped[datetime] = mapped_column(DateTime, default=agora)


class SenhaGestor(Base):
    __tablename__ = "tb_senhas_gestores"
    id_gestor: Mapped[int] = mapped_column(ForeignKey("tb_gestores.id"), primary_key=True)
    senha_hash: Mapped[str] = mapped_column(String(255))
    atualizada_em: Mapped[datetime] = mapped_column(DateTime, default=agora)


# ---------- Motivos ----------
class Documento(Base):
    __tablename__ = "tb_documentos"
    id: Mapped[int] = mapped_column(primary_key=True)
    nome: Mapped[str] = mapped_column(String(100), unique=True)


class MotivoDocumento(Base):
    __tablename__ = "tassoc_tb_motivos_tb_documentos"
    id_motivo: Mapped[int] = mapped_column(ForeignKey("tb_motivos.id"), primary_key=True)
    id_documento: Mapped[int] = mapped_column(ForeignKey("tb_documentos.id"), primary_key=True)
    obrigatorio: Mapped[bool] = mapped_column(Boolean, default=False)
    documento: Mapped[Documento] = relationship(lazy="joined")


class Motivo(Base):
    __tablename__ = "tb_motivos"
    id: Mapped[int] = mapped_column(primary_key=True)
    nome: Mapped[str] = mapped_column(String(100), unique=True)
    destino: Mapped[str] = mapped_column(String(12))           # COORDENACAO | SECRETARIA
    atendimento: Mapped[str] = mapped_column(String(10), default="PRESENCIAL")  # PRESENCIAL | ONLINE
    duracao_min: Mapped[int | None] = mapped_column(SmallInteger)
    prioridade: Mapped[int] = mapped_column(SmallInteger, default=2)  # 1 alta .. 3 baixa
    data_limite: Mapped[date | None] = mapped_column(Date)
    exige_disciplina: Mapped[bool] = mapped_column(Boolean, default=False)
    orientacao: Mapped[str | None] = mapped_column(String(300))
    ativo: Mapped[bool] = mapped_column(Boolean, default=True)
    documentos: Mapped[list[MotivoDocumento]] = relationship(lazy="selectin", cascade="all, delete-orphan")


# ---------- Agenda ----------
class Escala(Base):
    __tablename__ = "tb_escalas"
    id: Mapped[int] = mapped_column(primary_key=True)
    id_gestor: Mapped[int] = mapped_column(ForeignKey("tb_gestores.id"))
    dia_semana: Mapped[int] = mapped_column(SmallInteger)       # 1 = segunda ... 7 = domingo
    hora_inicio: Mapped[time] = mapped_column(Time)
    hora_fim: Mapped[time] = mapped_column(Time)
    local: Mapped[str] = mapped_column(String(100))


class Ausencia(Base):
    """Reserva que o coordenador faz para si mesmo (almoço, compromisso, emergência)."""
    __tablename__ = "tb_ausencias"
    id: Mapped[int] = mapped_column(primary_key=True)
    id_gestor: Mapped[int] = mapped_column(ForeignKey("tb_gestores.id"))
    inicio: Mapped[datetime] = mapped_column(DateTime)
    fim: Mapped[datetime] = mapped_column(DateTime)
    motivo: Mapped[str | None] = mapped_column(String(100))
    criada_em: Mapped[datetime] = mapped_column(DateTime, default=agora)


class Status(Base):
    __tablename__ = "tb_status"
    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True, autoincrement=False)
    nome: Mapped[str] = mapped_column(String(20), unique=True)


class Agendamento(Base):
    __tablename__ = "tb_agendamentos"
    id: Mapped[int] = mapped_column(primary_key=True)
    id_aluno: Mapped[int] = mapped_column(ForeignKey("tb_alunos.id"))
    id_gestor: Mapped[int] = mapped_column(ForeignKey("tb_gestores.id"))
    id_motivo: Mapped[int] = mapped_column(ForeignKey("tb_motivos.id"))
    id_disciplina: Mapped[int | None] = mapped_column(ForeignKey("tb_disciplinas.id"))
    id_status: Mapped[int] = mapped_column(ForeignKey("tb_status.id"))
    inicio: Mapped[datetime | None] = mapped_column(DateTime)
    fim: Mapped[datetime | None] = mapped_column(DateTime)
    local: Mapped[str | None] = mapped_column(String(100))
    titulo: Mapped[str] = mapped_column(String(100))
    descricao: Mapped[str | None] = mapped_column(String(500))
    observacao: Mapped[str | None] = mapped_column(String(300))
    cancelado_por: Mapped[str | None] = mapped_column(String(7))
    id_ausencia: Mapped[int | None] = mapped_column(ForeignKey("tb_ausencias.id"))
    criado_em: Mapped[datetime] = mapped_column(DateTime, default=agora)
    atualizado_em: Mapped[datetime] = mapped_column(DateTime, default=agora, onupdate=agora)

    # Mesmos índices do script SQL. O único filtrado barra duas reuniões Aprovadas
    # no mesmo minuto com o mesmo coordenador (vale no SQLite e no SQL Server).
    __table_args__ = (
        Index("uq_agendamento_ativo", "id_gestor", "inicio", unique=True,
              sqlite_where=text("id_status = 2 AND inicio IS NOT NULL"),
              mssql_where=text("id_status = 2 AND inicio IS NOT NULL")),
        Index("ix_agendamentos_gestor_periodo", "id_gestor", "inicio", "id_status"),
        Index("ix_agendamentos_aluno", "id_aluno", "id_status"),
    )

    aluno: Mapped[Aluno] = relationship(lazy="joined")
    gestor: Mapped[Gestor] = relationship(lazy="joined")
    motivo: Mapped[Motivo] = relationship(lazy="joined")
    disciplina: Mapped[Disciplina | None] = relationship(lazy="joined")
    anexos: Mapped[list["Anexo"]] = relationship(lazy="selectin")
    avaliacao: Mapped["Avaliacao | None"] = relationship(lazy="selectin", uselist=False)


class Anexo(Base):
    __tablename__ = "tb_anexos"
    id: Mapped[int] = mapped_column(primary_key=True)
    id_agendamento: Mapped[int] = mapped_column(ForeignKey("tb_agendamentos.id"))
    id_documento: Mapped[int] = mapped_column(ForeignKey("tb_documentos.id"))
    nome_arquivo: Mapped[str] = mapped_column(String(200))
    caminho: Mapped[str] = mapped_column(String(300))
    enviado_em: Mapped[datetime] = mapped_column(DateTime, default=agora)
    documento: Mapped[Documento] = relationship(lazy="joined")


class Avaliacao(Base):
    __tablename__ = "tb_avaliacoes"
    id_agendamento: Mapped[int] = mapped_column(ForeignKey("tb_agendamentos.id"), primary_key=True)
    nota: Mapped[int] = mapped_column(SmallInteger)
    comentario: Mapped[str | None] = mapped_column(String(500))
    criada_em: Mapped[datetime] = mapped_column(DateTime, default=agora)


class Notificacao(Base):
    __tablename__ = "tb_notificacoes"
    id: Mapped[int] = mapped_column(primary_key=True)
    id_agendamento: Mapped[int] = mapped_column(ForeignKey("tb_agendamentos.id"))
    canal: Mapped[str] = mapped_column(String(10), default="SISTEMA")  # SISTEMA | EMAIL | WHATSAPP
    mensagem: Mapped[str] = mapped_column(String(300))
    lida: Mapped[bool] = mapped_column(Boolean, default=False)
    criada_em: Mapped[datetime] = mapped_column(DateTime, default=agora)
    enviada_em: Mapped[datetime | None] = mapped_column(DateTime)
