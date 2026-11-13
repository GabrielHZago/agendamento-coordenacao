# Instalação — Sistema de Agendamento da Coordenação

> **Suposição de ambiente.** A equipe não tem acesso à infraestrutura da faculdade.
> Esta instalação simula um servidor da instituição com uma máquina virtual na rede local.
> Se a faculdade já tiver servidor, banco ou login institucional, o script deve ser adaptado.

## 1. Criar a VM (VirtualBox ou similar)

| Item | Valor |
| --- | --- |
| Sistema | Ubuntu Server 24.04 LTS (22.04 também funciona) |
| Processador | 2 núcleos |
| Memória | 4 GB (o SQL Server exige no mínimo 2 GB) |
| Disco | 25 GB |
| Rede | **Placa em modo Bridge**, para a VM ganhar um IP da mesma rede dos celulares e PCs |

Durante a instalação do Ubuntu, marque "Install OpenSSH server".

## 2. Copiar o projeto para a VM

Pela rede (do seu PC): `scp -r agendamento/ usuario@IP_DA_VM:~/`
ou clonando o repositório: `git clone <url-do-repositorio> agendamento`

A pasta precisa ter: `app/`, `frontend/`, `requirements.txt`, `script_banco_agendamento.sql` e `instalar.sh`.

## 3. Rodar a instalação

```bash
cd ~/agendamento
sudo bash instalar.sh
```

O script pede a senha do administrador do banco (`sa`) e faz o resto:
SQL Server 2025 Express, banco e tabelas, usuário do banco com permissão mínima,
Python e dependências, serviço que sobe sozinho com a VM e firewall.
No fim, ele mostra o endereço de acesso, por exemplo `http://192.168.0.15:8000`.

## 4. Acessar pelos terminais

Qualquer celular ou computador **na mesma rede** abre o endereço mostrado no navegador.

- Wi-Fi da faculdade costuma isolar os aparelhos (um não enxerga o outro).
  Se isso acontecer na demonstração, use o **roteador do celular** de alguém do grupo:
  ligue o notebook com a VM e os celulares nessa mesma rede.
- O banco (porta 1433) não fica exposto: só o sistema conversa com ele, dentro da VM.

## Comandos úteis

| Para | Comando |
| --- | --- |
| Ver se o sistema está rodando | `sudo systemctl status agendamento` |
| Ver os logs ao vivo | `sudo journalctl -u agendamento -f` |
| Reiniciar depois de mudar o código | `sudo systemctl restart agendamento` |
| Abrir o banco pelo terminal | `sqlcmd -C -S localhost -U sa -d agendamento` |
