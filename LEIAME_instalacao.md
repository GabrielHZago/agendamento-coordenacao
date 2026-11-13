# Instalação — Sistema de Agendamento da Coordenação

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
| DDoS / excesso de acessos | nginx: 30 conexões e 20 req/s por IP, login 10/min, timeouts curtos (slowloris), corpo máx. 27 MB; uvicorn com `--limit-concurrency`; SYN cookies no kernel; Python: limite por rota (slowapi) |
| SQL injection | só consultas pelo ORM (parametrizadas); `%` e `_` da busca tratados como texto; nomes do instalador validados |
| XSS | CSP `script-src 'self'` (sem script inline nem CDN), todo texto escapado antes de ir para a tela |
| Força bruta no login | bloqueio de 15 min após 5 erros, limite no nginx, resposta com o mesmo tempo para RA inexistente |
| Upload malicioso | só PDF/PNG/JPG conferidos pelo conteúdo (magic bytes), até 5 MB e 5 arquivos, nome gerado pelo sistema, fora da pasta pública |
| Invasão do processo | serviço isolado pelo systemd (`ProtectSystem=strict`, sem privilégios, só grava em `uploads/`); banco com usuário sem permissão de alterar tabelas |

Ver os bloqueios do nginx: `sudo grep -c " 429 " /var/log/nginx/access.log`.
