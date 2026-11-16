# Agenda da Coordenação

Sistema web para alunos marcarem atendimento com a coordenação do curso, pelo celular ou pelo computador.
Projeto acadêmico da equipe Tech Titans, Faculdade Anhanguera de Osasco, 2026.

- **Aluno:** escolhe o motivo, a disciplina e um horário livre. A reunião presencial é confirmada na hora.
  Pedidos online, como entrega de atestado, vão para o coordenador aceitar ou recusar.
- **Coordenador:** monta a escala semanal, reserva horários para si (almoço, emergência),
  responde pedidos online, consulta as reuniões por período e configura os motivos de contato.

**Tecnologias:** Python 3.12 + FastAPI + SQLAlchemy · SQL Server 2025 Express (SQLite no desenvolvimento) ·
HTML + Bootstrap 5.3 + JavaScript, sem etapa de build · nginx + systemd numa VM Ubuntu.

Documentação do projeto (requisitos, planejamento, DER, slides): pasta do Google Drive da equipe.

## Estrutura

```
app/                 API em FastAPI
  main.py            cria o app, middlewares e serve o frontend
  config.py          variáveis do .env e constantes das regras de negócio
  database.py        conexão (SQL Server ou SQLite)
  models.py          tabelas (espelha database/script_banco_agendamento.sql)
  protecao.py        limite de requisições, CSP e cabeçalhos de segurança
  security.py        senhas (bcrypt), sessão e bloqueio de login
  servicos.py        horários livres, conflitos e avisos
  seed_demo.py       dados de demonstração
  routers/           rotas: auth, motivos, agenda, agendamentos
frontend/            telas (servidas pelo próprio FastAPI)
  index.html
  css/app.css
  js/                util.js (API, modal, máscaras), app.js (telas), demo.js (modo demonstração)
  vendor/            Bootstrap, Bootstrap Icons e IMask (locais, sem CDN)
database/
  script_banco_agendamento.sql   tabelas e dados iniciais (referência do modelo)
tests/               testes automatizados (pytest)
instalar.sh          instala e configura tudo numa VM Ubuntu
```

Logins de demonstração (criados por `app/seed_demo.py`): coordenador `coordenacao@demo.edu` / `Coord2026!`;
alunos RA `1234567` ou `7654321` / `Aluno2026!`. Para ver as telas sem servidor, abra com `?demo`.

---

# Instalação

> **Suposição de ambiente.** A equipe não tem acesso à infraestrutura da faculdade.
> Esta instalação simula um servidor da instituição com uma máquina virtual na rede local.
> Se a faculdade já tiver servidor, banco ou login institucional, o script deve ser adaptado.

## 1. Criar a VM (VirtualBox ou similar)

| Item | Valor |
| --- | --- |
| Sistema | Ubuntu Server 24.04 LTS (22.04 também funciona) |
| Processador | 2 núcleos, x86_64 (o SQL Server não roda em ARM) |
| Memória | 4 GB (o SQL Server exige no mínimo 2 GB) |
| Disco | 25 GB |
| Rede | **Placa em modo Bridge**, para a VM ganhar um IP da mesma rede dos celulares e PCs |

Durante a instalação do Ubuntu, marque "Install OpenSSH server" (o script também instala, se faltar).

## 2. Instalar tudo com um comando

Na VM, logado com um usuário que tenha `sudo`:

```bash
curl -fsSL https://raw.githubusercontent.com/GabrielHZago/agendamento-coordenacao/main/instalar.sh | sudo bash
```

O script baixa o projeto do GitHub, pede a senha do administrador do banco (`sa`) e faz o resto:
atualiza o Ubuntu, instala SQL Server 2025 Express, cria banco, tabelas e um usuário do banco
com permissão mínima, instala Python e as dependências, cria o serviço que sobe sozinho com a VM,
configura o firewall e confere se o sistema respondeu.
No fim, ele mostra o endereço de acesso, por exemplo `http://192.168.0.15` (porta 80, pelo nginx).

Outras formas:

```bash
# sem perguntas (senha do sa na linha de comando) e sem dados de demonstração
curl -fsSL https://raw.githubusercontent.com/GabrielHZago/agendamento-coordenacao/main/instalar.sh \
  | sudo SA_PASSWORD='Troque#Esta1' SEED_DEMO=0 bash

# a partir de uma pasta já clonada/copiada
git clone https://github.com/GabrielHZago/agendamento-coordenacao.git
cd agendamento-coordenacao && sudo bash instalar.sh
```

Para **atualizar** o sistema depois de mudar o código no GitHub, rode o mesmo comando de novo:
o banco existente é mantido.

## 3. Acessar pelos terminais

Qualquer celular ou computador **na mesma rede** abre o endereço mostrado no navegador.

- Wi-Fi da faculdade costuma isolar os aparelhos (um não enxerga o outro).
  Se isso acontecer na demonstração, use o **roteador do celular** de alguém do grupo:
  ligue o notebook com a VM e os celulares nessa mesma rede.
- Só as portas 22 (SSH, com limite contra força bruta) e 80 (nginx) ficam abertas.
  O uvicorn (8000) e o banco (1433) só aceitam conexões de dentro da VM.

## Desenvolvimento local (sem SQL Server)

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows  (Linux/Mac: source .venv/bin/activate)
pip install -r requirements-dev.txt
python -m app.seed_demo         # cria dev.db com dados de demonstração
uvicorn app.main:app --reload --port 8000
pytest                          # testes automatizados
```

## Criar contas da coordenação (tela escondida)

Abra `http://IP-DA-VM/#admin` e informe a **chave de administração**, mostrada no fim da instalação
e guardada em `/opt/agendamento/.env` (`ADMIN_KEY`). Ali se cria o coordenador e se definem os cursos e
as disciplinas que ele atende; o coordenador só consulta essa lista. No desenvolvimento (SQLite) a chave é `dev`.

## Esqueci a senha

O link de redefinição vai por e-mail, vale 30 minutos e só funciona uma vez (não precisa de tabela no banco:
o link é assinado com a `SECRET_KEY`). Para enviar e-mail, informe o servidor SMTP na instalação:

```bash
curl -fsSL https://raw.githubusercontent.com/GabrielHZago/agendamento-coordenacao/main/instalar.sh   | sudo SMTP_HOST=smtp.gmail.com SMTP_USER=conta@gmail.com SMTP_PASSWORD='senha de app' bash
```

Sem SMTP, o link aparece no log: `sudo journalctl -u agendamento | grep redefini`.
**Na apresentação**, se a rede bloquear e-mail, instale com `RECUPERACAO_MOSTRA_LINK=1` para o link
aparecer na própria tela. Nunca deixe ligado fora da apresentação.

## Comandos úteis

| Para | Comando |
| --- | --- |
| Ver se o sistema está rodando | `sudo systemctl status agendamento` |
| Ver os logs ao vivo | `sudo journalctl -u agendamento -f` |
| Reiniciar | `sudo systemctl restart agendamento` |
| Abrir o banco pelo terminal | `sqlcmd -C -I -S localhost -U sa -d agendamento` |

## Segurança (resumo)

| Ameaça | Proteção |
| --- | --- |
| DDoS / excesso de acessos | nginx: 30 conexões e 20 req/s por IP, login 10/min, timeouts curtos (slowloris), corpo máx. 27 MB; uvicorn com `--limit-concurrency`; SYN cookies no kernel; fail2ban bane por 10 min quem insiste no limite; Python: limite por rota (slowapi) e `pool_timeout` no banco |
| SQL injection | só consultas pelo ORM (parametrizadas); `%`, `_` e `[` da busca tratados como texto; nomes do instalador validados |
| XSS e CSRF | CSP `script-src 'self'` (sem script inline nem CDN), todo texto escapado antes de ir para a tela; cookie SameSite=strict e recusa de POST/PUT/PATCH/DELETE vindo de outro site |
| Força bruta no login | bloqueio de 15 min após 5 erros, limite no nginx, resposta com o mesmo tempo para RA inexistente |
| Upload malicioso | só PDF/PNG/JPG conferidos pelo conteúdo (magic bytes), até 5 MB e 5 arquivos, nome gerado pelo sistema, fora da pasta pública |
| Invasão do processo | serviço isolado pelo systemd (`ProtectSystem=strict`, sem privilégios, só grava em `uploads/`); banco com usuário sem permissão de alterar tabelas |

**Limite da solução:** uma VM sozinha não segura um DDoS volumétrico (milhões de pacotes que lotam o link);
isso se resolve antes do servidor, no firewall da faculdade ou numa CDN. O projeto reduz o risco do DDoS
de aplicação: inundação de requisições, conexões lentas, força bruta e uploads gigantes.

Próximos passos: HTTPS (certificado da faculdade ou Let's Encrypt, e `https_only=True` no cookie) e
bloqueio de login guardado no banco em vez da memória de cada worker.

### Como demonstrar na apresentação

```bash
# 1) Limite de requisições: as primeiras passam (200), depois vem 429
for i in $(seq 1 80); do curl -s -o /dev/null -w "%{http_code} " http://IP-DA-VM/api/saude; done; echo

# 2) Força bruta no login: depois de algumas tentativas, 429
for i in $(seq 1 15); do curl -s -o /dev/null -w "%{http_code} " -H 'Content-Type: application/json'   -d '{"perfil":"aluno","login":"1234567","senha":"errada"}' http://IP-DA-VM/api/login; done; echo

# 3) SQL injection no login: só 401, sem erro e sem entrar
curl -s -H 'Content-Type: application/json' -d '{"perfil":"aluno","login":"x' OR '1'='1","senha":"x"}' http://IP-DA-VM/api/login; echo

# 4) Na VM: quem foi banido e quantos pedidos o nginx barrou
sudo fail2ban-client status nginx-limit-req
sudo grep -c " 429 " /var/log/nginx/access.log
```
