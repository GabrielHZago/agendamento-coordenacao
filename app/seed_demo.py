"""Dados de demonstração: python -m app.seed_demo

Cria (se ainda não existirem) um curso, disciplinas, um coordenador com escala,
dois alunos e, no SQLite, os motivos de exemplo. Pode rodar mais de uma vez.

Logins de demonstração:
  Coordenador: coordenacao@demo.edu  / Coord2026!
  Aluno:       RA 1234567            / Aluno2026!
  Aluno:       RA 7654321            / Aluno2026!
"""
from datetime import time

from sqlalchemy import select

from .database import IS_SQLITE, SessionLocal
from .models import (Aluno, Curso, Disciplina, Documento, Escala, Gestor, Motivo,
                     MotivoDocumento, SenhaAluno, SenhaGestor)
from .security import hash_senha

MOTIVOS_EXEMPLO = [  # mesmos do script SQL (tempos estimados pela equipe)
    ("Entrega de atestado", "COORDENACAO", "ONLINE", None, 2, True, "Anexe o atestado; não é preciso ir à coordenação."),
    ("Nota, presença ou trabalho", "COORDENACAO", "PRESENCIAL", 20, 1, True, None),
    ("Reprovação e como refazer", "COORDENACAO", "PRESENCIAL", 30, 2, True, None),
    ("Análise curricular (transferência)", "COORDENACAO", "PRESENCIAL", 60, 3, False,
     "Leve o histórico e as ementas da outra instituição."),
    ("Documentação de matrícula", "SECRETARIA", "PRESENCIAL", 15, 2, False, "Esse assunto é com a secretaria acadêmica."),
    ("Pagamento e financeiro", "SECRETARIA", "PRESENCIAL", 15, 2, False, "Esse assunto é com a secretaria ou o financeiro."),
]


def main() -> None:
    if IS_SQLITE:
        from .config import NOMES_STATUS
        from .database import Base, engine
        from .models import Status
        Base.metadata.create_all(engine)
        with SessionLocal() as db:
            if not db.get(Status, 1):
                db.add_all(Status(id=i, nome=n) for i, n in NOMES_STATUS.items())
                db.commit()
    with SessionLocal() as db:
        curso = db.scalar(select(Curso).where(Curso.nome == "Análise e Desenvolvimento de Sistemas"))
        if not curso:
            curso = Curso(nome="Análise e Desenvolvimento de Sistemas")
            db.add(curso)
            db.flush()
            for nome in ("Banco de Dados", "Engenharia de Software", "Programação Web", "Redes de Computadores"):
                db.add(Disciplina(nome=nome, id_curso=curso.id))

        if IS_SQLITE and not db.scalar(select(Motivo)):
            docs = {n: Documento(nome=n) for n in ("Atestado médico", "Histórico escolar", "Ementas das disciplinas")}
            db.add_all(docs.values())
            db.flush()
            for nome, destino, atend, dur, prio, exige, orient in MOTIVOS_EXEMPLO:
                m = Motivo(nome=nome, destino=destino, atendimento=atend, duracao_min=dur, prioridade=prio,
                           exige_disciplina=exige, orientacao=orient, ativo=True)
                db.add(m)
                db.flush()
                if nome == "Entrega de atestado":
                    db.add(MotivoDocumento(id_motivo=m.id, id_documento=docs["Atestado médico"].id, obrigatorio=True))
                if nome.startswith("Análise curricular"):
                    for d in ("Histórico escolar", "Ementas das disciplinas"):
                        db.add(MotivoDocumento(id_motivo=m.id, id_documento=docs[d].id, obrigatorio=False))

        gestor = db.scalar(select(Gestor).where(Gestor.email == "coordenacao@demo.edu"))
        if not gestor:
            gestor = Gestor(nome="Prof.ª Marina Coordenadora", email="coordenacao@demo.edu", max_disciplinas=6)
            db.add(gestor)
            db.flush()
            db.add(SenhaGestor(id_gestor=gestor.id, senha_hash=hash_senha("Coord2026!")))
            gestor.cursos = [curso]
            gestor.disciplinas = list(db.scalars(select(Disciplina).where(Disciplina.id_curso == curso.id)))
            sala = "Bloco A, 2º andar, sala 204"
            for dia in range(1, 6):   # segunda a sexta; o intervalo das 18h às 18h30 fica de fora
                db.add(Escala(id_gestor=gestor.id, dia_semana=dia, hora_inicio=time(14, 0), hora_fim=time(18, 0), local=sala))
                db.add(Escala(id_gestor=gestor.id, dia_semana=dia, hora_inicio=time(18, 30), hora_fim=time(21, 30), local=sala))

        for nome, ra, email in (("Lucas Andrade", "1234567", "lucas@aluno.demo.edu"),
                                ("Beatriz Lima", "7654321", "beatriz@aluno.demo.edu")):
            if not db.scalar(select(Aluno).where(Aluno.ra == ra)):
                a = Aluno(nome=nome, ra=ra, email=email, id_curso=curso.id, celular="11999990000",
                          aceita_whatsapp=True)
                db.add(a)
                db.flush()
                db.add(SenhaAluno(id_aluno=a.id, senha_hash=hash_senha("Aluno2026!")))
        db.commit()
    print("Dados de demonstração prontos.")
    print("  Coordenador: coordenacao@demo.edu / Coord2026!")
    print("  Aluno:       RA 1234567 ou 7654321 / Aluno2026!")


if __name__ == "__main__":
    main()
