"""Os testes rodam em SQLite, mas a VM usa SQL Server. Este teste recompila no dialeto do SQL Server
cada consulta que a API executa e procura construções que o SQLite aceita e o T-SQL não."""
import re

from sqlalchemy import event
from sqlalchemy.dialects import mssql
from sqlalchemy.orm import Session

PROIBIDO = re.compile(r"\bIS\s+(1|0|true|false)\b", re.IGNORECASE)   # T-SQL só aceita IS [NOT] NULL

ROTAS_ALUNO = ["/api/motivos", "/api/documentos", "/api/cursos", "/api/disciplinas", "/api/notificacoes",
               "/api/agendamentos/meus?q=nota", "/api/horarios/livres?id_motivo=2&id_disciplina=1"]
ROTAS_COORD = ["/api/motivos?todos=1", "/api/agenda?inicio=2026-01-01&fim=2027-01-01&q=x", "/api/pendentes",
               "/api/reservas", "/api/escalas", "/api/minhas-disciplinas"]


def test_consultas_compilam_para_sql_server(lucas, coord):
    vistas: list[str] = []

    def ouvir(ctx):
        vistas.append(str(ctx.statement.compile(dialect=mssql.dialect())))

    event.listen(Session, "do_orm_execute", ouvir)
    try:
        for rota in ROTAS_ALUNO:
            assert lucas.get(rota).status_code == 200, rota
        assert lucas.patch("/api/notificacoes/lidas").status_code == 200
        for rota in ROTAS_COORD:
            assert coord.get(rota).status_code == 200, rota
    finally:
        event.remove(Session, "do_orm_execute", ouvir)

    assert len(vistas) > 10
    ruins = [sql for sql in vistas if PROIBIDO.search(sql)]
    assert not ruins, "SQL inválido no SQL Server:\n" + "\n\n".join(ruins)
