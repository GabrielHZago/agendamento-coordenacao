-- =============================================================
-- Sistema de Agendamento da Coordenação — Tech Titans
-- Banco: SQL Server (Express)  ·  Padrão: tb_ para entidades, tassoc_ para associações N:N
-- Versão 4: + confirmação automática (sem aprovação manual), reservas do coordenador cancelam reuniões
-- =============================================================

-- ---------- Cursos, disciplinas e pessoas ----------

CREATE TABLE tb_cursos (
    id   INT IDENTITY PRIMARY KEY,
    nome VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE tb_disciplinas (
    id       INT IDENTITY PRIMARY KEY,
    nome     VARCHAR(100) NOT NULL,
    id_curso INT NOT NULL REFERENCES tb_cursos(id),
    CONSTRAINT uq_disciplina UNIQUE (id_curso, nome)
);

CREATE TABLE tb_gestores (
    id                   INT IDENTITY PRIMARY KEY,
    nome                 VARCHAR(100) NOT NULL,
    email                VARCHAR(254) NOT NULL UNIQUE,
    whatsapp             VARCHAR(20)  NULL,          -- número usado para responder os alunos
    max_disciplinas      TINYINT NULL               -- "até N disciplinas" (NULL = sem limite)
);

-- Coordenador x curso (N:N)
CREATE TABLE tassoc_tb_gestores_tb_cursos (
    id_gestor INT NOT NULL REFERENCES tb_gestores(id),
    id_curso  INT NOT NULL REFERENCES tb_cursos(id),
    PRIMARY KEY (id_gestor, id_curso)
);

-- Coordenador x disciplina que ele atende (N:N). O limite N é conferido pela aplicação.
CREATE TABLE tassoc_tb_gestores_tb_disciplinas (
    id_gestor     INT NOT NULL REFERENCES tb_gestores(id),
    id_disciplina INT NOT NULL REFERENCES tb_disciplinas(id),
    PRIMARY KEY (id_gestor, id_disciplina)
);

CREATE TABLE tb_alunos (
    id       INT IDENTITY PRIMARY KEY,
    nome     VARCHAR(100) NOT NULL,
    email    VARCHAR(254) NOT NULL UNIQUE,
    ra       VARCHAR(20)  NOT NULL UNIQUE,
    celular  VARCHAR(20)  NULL,
    aceita_whatsapp BIT   NOT NULL DEFAULT 0,      -- consentimento (LGPD) para receber respostas no WhatsApp
    id_curso INT NOT NULL REFERENCES tb_cursos(id)
);

-- ---------- Senhas (1:1, chave = id do dono; bcrypt cabe em 60, 255 dá folga) ----------

CREATE TABLE tb_senhas_alunos (
    id_aluno      INT PRIMARY KEY REFERENCES tb_alunos(id),
    senha_hash    VARCHAR(255) NOT NULL,
    atualizada_em DATETIME2    NOT NULL DEFAULT SYSDATETIME()
);

CREATE TABLE tb_senhas_gestores (
    id_gestor     INT PRIMARY KEY REFERENCES tb_gestores(id),
    senha_hash    VARCHAR(255) NOT NULL,
    atualizada_em DATETIME2    NOT NULL DEFAULT SYSDATETIME()
);

-- ---------- Motivos de contato (configuráveis) ----------

-- destino: 'COORDENACAO' agenda reunião; 'SECRETARIA' só orienta o aluno a procurar a secretaria
CREATE TABLE tb_motivos (
    id                INT IDENTITY PRIMARY KEY,
    nome              VARCHAR(100) NOT NULL UNIQUE,  -- ex.: Entrega de atestado, Análise curricular
    destino           VARCHAR(12)  NOT NULL CHECK (destino IN ('COORDENACAO', 'SECRETARIA')),
    atendimento       VARCHAR(10)  NOT NULL DEFAULT 'PRESENCIAL'
                      CHECK (atendimento IN ('PRESENCIAL', 'ONLINE')),  -- ONLINE = resolvido sem reunião
    duracao_min       SMALLINT     NULL CHECK (duracao_min BETWEEN 5 AND 240),
    prioridade        TINYINT      NOT NULL DEFAULT 2 CHECK (prioridade BETWEEN 1 AND 3), -- 1 alta, 3 baixa
    data_limite       DATE         NULL,             -- ex.: prazo de lançamento de notas
    exige_disciplina  BIT          NOT NULL DEFAULT 0,
    orientacao        VARCHAR(300) NULL,             -- texto mostrado ao aluno (ex.: "Procure a secretaria")
    ativo             BIT          NOT NULL DEFAULT 1,
    CONSTRAINT ck_motivo_duracao CHECK (atendimento = 'ONLINE' OR duracao_min IS NOT NULL)
);

CREATE TABLE tb_documentos (
    id   INT IDENTITY PRIMARY KEY,
    nome VARCHAR(100) NOT NULL UNIQUE                 -- ex.: Atestado médico, Histórico escolar
);

-- Documentos que cada motivo pede (N:N). obrigatorio = 1: o pedido só é enviado com o anexo
CREATE TABLE tassoc_tb_motivos_tb_documentos (
    id_motivo    INT NOT NULL REFERENCES tb_motivos(id),
    id_documento INT NOT NULL REFERENCES tb_documentos(id),
    obrigatorio  BIT NOT NULL DEFAULT 0,
    PRIMARY KEY (id_motivo, id_documento)
);

-- ---------- Escala de atendimento ----------

-- Modelos prontos ("padrões") que o coordenador pode aplicar
CREATE TABLE tb_modelos_escala (
    id   INT IDENTITY PRIMARY KEY,
    nome VARCHAR(60) NOT NULL UNIQUE                 -- ex.: Noturno seg-sex
);

CREATE TABLE tb_modelos_escala_itens (
    id          INT IDENTITY PRIMARY KEY,
    id_modelo   INT     NOT NULL REFERENCES tb_modelos_escala(id),
    dia_semana  TINYINT NOT NULL CHECK (dia_semana BETWEEN 1 AND 7),  -- 1 = segunda
    hora_inicio TIME    NOT NULL,
    hora_fim    TIME    NOT NULL,
    CONSTRAINT ck_modelo_item CHECK (hora_fim > hora_inicio)
);

-- Escala semanal de cada coordenador (copiada de um modelo ou montada à mão).
-- Almoço fixo = dois blocos no mesmo dia (ex.: 08:00-12:00 e 13:00-17:00).
CREATE TABLE tb_escalas (
    id          INT IDENTITY PRIMARY KEY,
    id_gestor   INT     NOT NULL REFERENCES tb_gestores(id),
    dia_semana  TINYINT NOT NULL CHECK (dia_semana BETWEEN 1 AND 7),
    hora_inicio TIME    NOT NULL,
    hora_fim    TIME    NOT NULL,
    local       VARCHAR(100) NOT NULL,               -- bloco, andar e sala
    CONSTRAINT ck_escala CHECK (hora_fim > hora_inicio)
);

-- Reservas que o coordenador faz para si mesmo (almoço, compromisso pessoal, emergência médica...)
-- Se cair sobre reuniões já marcadas, a aplicação cancela essas reuniões e avisa os alunos.
CREATE TABLE tb_ausencias (
    id        INT IDENTITY PRIMARY KEY,
    id_gestor INT          NOT NULL REFERENCES tb_gestores(id),
    inicio    DATETIME2    NOT NULL,
    fim       DATETIME2    NOT NULL,
    motivo    VARCHAR(100) NULL,
    criada_em DATETIME2    NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT ck_ausencia CHECK (fim > inicio)
);

-- ---------- Agendamentos ----------

CREATE TABLE tb_status (
    id   TINYINT PRIMARY KEY,
    nome VARCHAR(20) NOT NULL UNIQUE
);

-- Reunião presencial nasce Aprovada (confirmação automática). Pendente/Recusada só existem em pedidos online.
INSERT INTO tb_status (id, nome) VALUES
    (1, 'Pendente'), (2, 'Aprovada'), (3, 'Recusada'),
    (4, 'Cancelada'), (5, 'Realizada');

-- Horário livre = escala - ausências - agendamentos ativos (calculado pela aplicação).
-- "fim" é gravado (e não calculado pela duração do motivo) porque a duração do motivo pode mudar depois.
-- Pedido ONLINE (ex.: entrega de atestado): inicio, fim e local ficam vazios; não ocupa a agenda.
CREATE TABLE tb_agendamentos (
    id            INT IDENTITY PRIMARY KEY,
    id_aluno      INT     NOT NULL REFERENCES tb_alunos(id),
    id_gestor     INT     NOT NULL REFERENCES tb_gestores(id),
    id_motivo     INT     NOT NULL REFERENCES tb_motivos(id),
    id_disciplina INT     NULL     REFERENCES tb_disciplinas(id),
    id_status     TINYINT NOT NULL REFERENCES tb_status(id),     -- presencial nasce 2 (Aprovada); online nasce 1 (Pendente)
    inicio        DATETIME2 NULL,
    fim           DATETIME2 NULL,
    local         VARCHAR(100) NULL,                 -- copiado da escala no momento do pedido
    titulo        VARCHAR(100) NOT NULL,
    descricao     VARCHAR(500) NULL,
    observacao    VARCHAR(300) NULL,                 -- motivo da recusa ou do cancelamento
    cancelado_por VARCHAR(7)   NULL CHECK (cancelado_por IN ('ALUNO', 'GESTOR')),
    id_ausencia   INT          NULL REFERENCES tb_ausencias(id),  -- reserva que causou o cancelamento
    criado_em     DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    atualizado_em DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT ck_agendamento CHECK ((inicio IS NULL AND fim IS NULL) OR fim > inicio)
);

-- Barra duas reuniões confirmadas começando no mesmo minuto com o mesmo coordenador.
-- Sobreposição parcial (ex.: 14:00-15:00 x 14:30-15:00) é conferida pela aplicação dentro de uma transação.
CREATE UNIQUE INDEX uq_agendamento_ativo
    ON tb_agendamentos (id_gestor, inicio)
    WHERE id_status = 2 AND inicio IS NOT NULL;   -- só reuniões Aprovadas; pedidos online ficam de fora

CREATE INDEX ix_agendamentos_gestor_periodo ON tb_agendamentos (id_gestor, inicio, id_status);
CREATE INDEX ix_agendamentos_aluno          ON tb_agendamentos (id_aluno, id_status);

-- Documentos enviados pelo aluno para um pedido
CREATE TABLE tb_anexos (
    id             INT IDENTITY PRIMARY KEY,
    id_agendamento INT          NOT NULL REFERENCES tb_agendamentos(id),
    id_documento   INT          NOT NULL REFERENCES tb_documentos(id),
    nome_arquivo   VARCHAR(200) NOT NULL,
    caminho        VARCHAR(300) NOT NULL,            -- onde o arquivo foi salvo (pasta uploads/ do servidor)
    enviado_em     DATETIME2    NOT NULL DEFAULT SYSDATETIME()
);

-- ---------- Pós-reunião e avisos ----------

CREATE TABLE tb_avaliacoes (
    id_agendamento INT PRIMARY KEY REFERENCES tb_agendamentos(id),
    nota           TINYINT NOT NULL CHECK (nota BETWEEN 1 AND 10),
    comentario     VARCHAR(500) NULL,
    criada_em      DATETIME2 NOT NULL DEFAULT SYSDATETIME()
);

-- Uma linha por aviso e por canal. enviada_em NULL = ainda na fila (e-mail/WhatsApp)
CREATE TABLE tb_notificacoes (
    id             INT IDENTITY PRIMARY KEY,
    id_agendamento INT NOT NULL REFERENCES tb_agendamentos(id),
    canal          VARCHAR(10)  NOT NULL DEFAULT 'SISTEMA'
                   CHECK (canal IN ('SISTEMA', 'EMAIL', 'WHATSAPP')),
    mensagem       VARCHAR(300) NOT NULL,
    lida           BIT NOT NULL DEFAULT 0,          -- usado no canal SISTEMA
    criada_em      DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    enviada_em     DATETIME2 NULL
);

-- ---------- Dados iniciais de exemplo ----------

INSERT INTO tb_motivos (nome, destino, atendimento, duracao_min, prioridade, exige_disciplina, orientacao) VALUES
    ('Entrega de atestado',                'COORDENACAO', 'ONLINE',     NULL, 2, 1, 'Anexe o atestado; não é preciso ir à coordenação.'),
    ('Nota, presença ou trabalho',         'COORDENACAO', 'PRESENCIAL', 20,   1, 1, NULL),
    ('Reprovação e como refazer',          'COORDENACAO', 'PRESENCIAL', 30,   2, 1, NULL),
    ('Análise curricular (transferência)', 'COORDENACAO', 'PRESENCIAL', 60,   3, 0, 'Leve o histórico e as ementas da outra instituição.'),
    ('Documentação de matrícula',          'SECRETARIA',  'PRESENCIAL', 15,   2, 0, 'Esse assunto é com a secretaria acadêmica.'),
    ('Pagamento e financeiro',             'SECRETARIA',  'PRESENCIAL', 15,   2, 0, 'Esse assunto é com a secretaria ou o financeiro.');

INSERT INTO tb_documentos (nome) VALUES
    ('Atestado médico'), ('Histórico escolar'), ('Ementas das disciplinas');

INSERT INTO tassoc_tb_motivos_tb_documentos (id_motivo, id_documento, obrigatorio) VALUES
    (1, 1, 1),   -- atestado: anexo obrigatório
    (4, 2, 0), (4, 3, 0);
