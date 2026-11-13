# Handoff para agente local: Sistema de Agendamento com a Coordenação (Tech Titans)

> Cole este arquivo inteiro como primeira mensagem para o agente (Claude Code, Cursor, etc.), com a pasta do projeto aberta.

---

## PROMPT

Você vai assumir um projeto acadêmico já escrito, mas **nunca executado**. O código foi feito em um ambiente sem FastAPI/SQLAlchemy instalados; só passou em `py_compile` (Python), `bash -n` (script) e em um teste do frontend em **modo demonstração** no Chrome headless. Sua tarefa é fazê-lo **rodar de verdade**, corrigindo o que quebrar, sem mudar as decisões de projeto listadas abaixo.

Faça nesta ordem e me reporte ao final de cada etapa o que mudou (arquivo + motivo):

1. **Rodar local com SQLite** (sem SQL Server):
   ```bash
   python3 -m venv .venv && source .venv/bin/activate
   pip install -r requirements.txt
   python -m app.seed_demo          # cria dev.db com dados de demonstração
   uvicorn app.main:app --reload --port 8000
   ```
   Abra `http://localhost:8000`. Faça login como aluno e como coordenador (credenciais abaixo) e percorra **todas** as telas. Corrija erros de import, de modelo (relationships, nomes de coluna), de validação Pydantic e de serialização.
2. **Testes automatizados mínimos** em `tests/` com `pytest` + `fastapi.testclient` (banco SQLite temporário). Precisam passar:
   - login certo/errado e bloqueio após 5 falhas (RNF de segurança);
   - aluno marca reunião presencial → nasce **Aprovada** (status 2);
   - segunda reunião futura do mesmo aluno → 422 (RN05);
   - horário com menos de 24 h → 422 (RN03);
   - dois alunos no mesmo horário → o segundo recebe 409;
   - motivo da SECRETARIA → 422, sem gravar nada (RN13);
   - motivo ONLINE sem documento obrigatório → 422 (RN17); com PDF válido → Pendente (status 1);
   - upload com extensão `.pdf` mas conteúdo não-PDF → recusado (magic bytes);
   - coordenador cria reserva sobre reunião → 409 com lista; com `confirmar=true` → reunião vira Cancelada, `cancelado_por='GESTOR'`, aluno recebe notificação;
   - `/api/horarios/livres` não devolve horário ocupado nem dentro de reserva;
   - `/api/pendentes` na ordem data_limite (nulos por último) → prioridade → criado_em (RN14).
3. **Validar no SQL Server** (VM Ubuntu 24.04 com `instalar.sh`): conferir que `script_banco_agendamento.sql` roda limpo, que os nomes de tabelas/colunas batem com `app/models.py` e que o índice filtrado `uq_agendamento_ativo` existe. Se algo divergir, **o script SQL é a referência**; ajuste o modelo.
4. **Instalação na VM**: rodar `sudo bash instalar.sh` numa Ubuntu Server 24.04 limpa, corrigir o que falhar, e confirmar acesso pelo celular em `http://<IP-da-VM>:8000`.
5. **Lembretes** (pendente, não implementado): job com `apscheduler` (já está no requirements) que cria notificações 24 h e 1 h antes de cada reunião Aprovada, sem duplicar. Envio real de e-mail fica como fila (`tb_notificacoes.canal='EMAIL'`, `enviada_em` nulo); só implemente SMTP se eu pedir.
6. Ao final, me entregue: lista de mudanças, saída do `pytest`, e o que ainda não funciona.

**Não faça:** trocar a stack, criar status "Remarcada", exigir aprovação para reunião presencial, guardar senha em texto puro, montar SQL com f-string/concatenação, adicionar dependências de frontend com build (o frontend é um único `index.html`).

---

## CONTEXTO DO PROJETO

- **O quê:** sistema web para alunos marcarem atendimento com a coordenação do curso (Faculdade Anhanguera Osasco, equipe Tech Titans). Uso em celular e PC.
- **Escala:** a coordenação atende ~10 mil alunos; meta de 200 usuários simultâneos.
- **Prazo:** entrega na sexta 13/11 (lab, 19h–21h50); apresentação até terça 17/11.
- **Infraestrutura:** não temos acesso à infraestrutura da faculdade. A implantação numa VM com script bash é uma **suposição** nossa.

### Stack
| Camada | Tecnologia |
|---|---|
| Banco | SQL Server 2025 Express (Linux) — fallback SQLite para desenvolvimento; MySQL é plano B |
| Back-end | Python 3.12, FastAPI, SQLAlchemy 2.0, pyodbc (ODBC Driver 18) |
| Front-end | `frontend/index.html` único: HTML + CSS + JS puro, tema escuro padrão + claro, servido pelo próprio FastAPI (`StaticFiles`) |
| Servidor | uvicorn com N workers via systemd (`agendamento.service`), porta 8000, ufw |

### Estrutura
```
app/
  config.py        # variáveis (.env), constantes de regra e de status
  database.py      # engine (SQLite ou mssql+pyodbc), SessionLocal, get_db, IS_SQLITE
  models.py        # ORM de todas as tabelas (espelha o script SQL)
  security.py      # bcrypt, bloqueio de login em memória, exige_login/aluno/gestor
  servicos.py      # horarios_livres, valida_periodo, avisa, agendamento_json, busca_texto
  seed_demo.py     # dados de demonstração (python -m app.seed_demo)
  main.py          # app, rate limit (slowapi), SessionMiddleware, routers, /api/saude, StaticFiles
  routers/auth.py, motivos.py, agenda.py, agendamentos.py
frontend/index.html
script_banco_agendamento.sql   # DDL + seeds (v4) — fonte da verdade do modelo
instalar.sh                    # instala tudo numa Ubuntu 22.04/24.04
LEIAME_instalacao.md
requirements.txt
```

### Logins de demonstração (seed_demo)
- Coordenador: `coordenacao@demo.edu` / `Coord2026!`
- Alunos: RA `1234567` (Lucas Andrade) e RA `7654321` (Beatriz Lima) / `Aluno2026!`
- O frontend entra sozinho em **modo demonstração** (dados no navegador) se abrir com `?demo` ou se `/api/saude` não responder.

### Status (tb_status) — ids fixos
1 Pendente (só pedidos ONLINE) · 2 Aprovada · 3 Recusada · 4 Cancelada · 5 Realizada. Não existe "Remarcada": remarcar = cancelar + marcar outra.

### Regras de negócio principais
- **Confirmação automática:** reunião PRESENCIAL nasce Aprovada. Só pedidos ONLINE (ex.: entrega de atestado) ficam Pendentes para o coordenador Aceitar/Recusar.
- **RN03:** antecedência mínima de 24 h. **RN04:** aluno cancela até 2 h antes. **RN05:** no máximo 1 reunião futura Aprovada por aluno.
- **RN13:** motivo com `destino='SECRETARIA'` só mostra a orientação, nunca grava agendamento.
- **RN14:** fila de pendentes por `data_limite` (nulos por último), `prioridade` (1 alta) e `criado_em`.
- **RN17:** documentos marcados `obrigatorio` em `tassoc_tb_motivos_tb_documentos` precisam vir anexados.
- **Horários livres** = escala semanal (`tb_escalas`) − reservas do coordenador (`tb_ausencias`) − reuniões Aprovadas. A duração vem do motivo; o passo é a duração se for ≤ 30 min, senão 30 min; a janela é de 21 dias.
- **Reserva do coordenador** (almoço, pessoal, emergência médica): se cobrir reuniões, a API devolve 409 com a lista; com `confirmar=true`, cancela as reuniões (`cancelado_por='GESTOR'`, `id_ausencia`) e notifica os alunos.
- **Coordenador ↔ disciplinas:** N disciplinas por coordenador (limite em `tb_gestores.max_disciplinas`). O aluno é atendido pelo coordenador da disciplina escolhida; sem disciplina, pelo do curso.
- **Notificações:** sempre SISTEMA + EMAIL na fila; WHATSAPP só com `aceita_whatsapp`. A resposta por WhatsApp é manual, por link `wa.me` (`GET /api/agendamentos/{id}/whatsapp`).

### Segurança (decidido)
- Senhas com bcrypt em `tb_senhas_alunos` / `tb_senhas_gestores` (PK = id do dono).
- Sessão via cookie assinado (Starlette SessionMiddleware, HttpOnly, SameSite=strict, 8 h).
- Limite de 120 requisições por minuto por IP (slowapi); 5 logins errados geram bloqueio de 15 min; `--limit-concurrency 500` no uvicorn.
- Só consultas parametrizadas (ORM).
- Upload aceita só PDF/PNG/JPG conferidos por *magic bytes*, até 5 MB, salvos com nome uuid fora da pasta pública.
- Concorrência: transação SERIALIZABLE no POST de agendamento (fora do SQLite) e índice único filtrado `(id_gestor, inicio) WHERE id_status = 2 AND inicio IS NOT NULL`. Um IntegrityError devolve 409.
- **Ponto de atenção:** o bloqueio de login fica em memória *por worker*. Com vários workers o limite efetivo é 5 × N. Aceitável para o protótipo; se der tempo, mover para tabela.

### API (prefixo `/api`)
| Método | Rota | Quem | Observação |
|---|---|---|---|
| POST | /login | todos | `{perfil:'aluno'\|'coordenador', login, senha}` (aluno: RA ou e-mail) |
| POST | /logout · GET /me | logado | |
| POST | /alunos | público | cadastro: nome, ra, email, id_curso, senha (≥8, letras e números), celular, aceita_whatsapp, aceite_lgpd |
| GET | /cursos · /disciplinas?id_curso | público | |
| GET | /motivos?todos · /documentos | logado | |
| POST/PUT | /motivos[/{id}] | coordenador | documentos `[{id, obrigatorio}]` |
| GET | /horarios/livres?id_motivo&id_disciplina | aluno | `[{data, horarios:[{inicio,fim,gestor_id,gestor,local}]}]` |
| GET/POST/DELETE | /escalas[/{id}] | coordenador | `{dia_semana 1–7, hora_inicio, hora_fim, local}`; recusa sobreposição |
| GET/PUT | /minhas-disciplinas | coordenador | `{ids:[...]}` |
| GET/POST/DELETE | /reservas[/{id}] | coordenador | POST `{inicio, fim, motivo, confirmar}` → 409 `{mensagem, reunioes}` |
| POST | /agendamentos | aluno | **multipart**: id_motivo, titulo, descricao, id_disciplina, inicio, id_gestor, documentos[] + arquivos[] (pareados por posição) |
| GET | /agendamentos/meus?q | aluno | |
| PATCH | /agendamentos/{id}/cancelar | aluno/coord. | `{motivo?}` |
| POST | /agendamentos/{id}/avaliacao | aluno | `{nota 1–10, comentario?}`; só em Realizada |
| GET | /agenda?inicio&fim&id_status&id_motivo&q | coordenador | |
| GET | /pendentes | coordenador | |
| PATCH | /agendamentos/{id}/decisao · /realizada | coordenador | `{aceitar, observacao}` |
| GET | /agendamentos/{id}/whatsapp | coordenador | `{link}` |
| GET | /anexos/{id} | dono ou coordenador | |
| GET/PATCH | /notificacoes · /notificacoes/lidas | aluno | |
| GET | /saude | público | usado pelo frontend para decidir modo demo |

### Telas (frontend/index.html, rotas por hash)
`#login`, `#cadastro`, `#meus` (próxima reunião, avisos, histórico com busca, cancelar, avaliar), `#nova` (motivo → orientação da secretaria ou detalhes + anexos → dia/horário → confirmar), `#agenda` (reuniões dos próximos 7 dias, pedidos online com Aceitar/Recusar/WhatsApp, reservar horário com confirmação de conflito), `#reunioes` (filtros + marcar realizada), `#escala` (blocos semanais + disciplinas), `#motivos` (CRUD).
Acessibilidade: tema escuro por padrão com alternância para o claro, fonte A−/A/A+, botão "Ouvir" (speechSynthesis pt-BR), alvos de toque ≥ 44 px, sem `alert/confirm` (diálogos próprios).

### Pendências fora do código (não resolva, só saiba)
- Perguntar a um professor ou coordenador como é a infraestrutura atual da faculdade.
- Lista real de motivos com tempos médios (os do seed são placeholders).
- O modelo de dados no Figma e os documentos do Isaac ainda podem mudar o esquema.
