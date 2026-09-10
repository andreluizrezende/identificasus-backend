-- =====================================================================
-- IdentificaSUS - Modulo Mobile (captura em campo)
-- Script de criacao do banco de dados
--
-- Aderente a: "Padroes de banco de dados utilizados na implementacao"
--             Projeto CicatribioVET - R1, 15/05 - Andre Rezende
--
-- SGBD.......: MySQL 8.0 (InnoDB)
-- Base.......: dbsamu       (db + nome do projeto, item 2.1.1)
-- Tabelas....: mob_<descricao>                        (item 2.1.2)
-- Atributos..: <prefixo de tipo>_<descricao>          (item 2.1.3)
-- =====================================================================

DROP DATABASE IF EXISTS dbsamu;
CREATE DATABASE dbsamu
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_0900_ai_ci;
USE dbsamu;

-- =====================================================================
-- 1. CADASTROS BASICOS
-- =====================================================================

CREATE TABLE mob_perfil (
  id_perfil        SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  co_perfil        VARCHAR(20)  NOT NULL,
  no_perfil        VARCHAR(60)  NOT NULL,
  ds_perfil        VARCHAR(200) NULL,
  st_ativo         CHAR(1)      NOT NULL DEFAULT 'A',
  st_criacao       DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT pk_mob_perfil PRIMARY KEY (id_perfil),
  CONSTRAINT uc_mob_perfil_co_perfil UNIQUE (co_perfil),
  CONSTRAINT ck_mob_perfil_st_ativo CHECK (st_ativo IN ('A','I'))
) ENGINE=InnoDB COMMENT='Perfis de acesso do modulo mobile';

CREATE TABLE mob_usuario (
  id_usuario       INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nu_cpf           CHAR(11)     NOT NULL,
  no_usuario       VARCHAR(120) NOT NULL,
  co_conselho      VARCHAR(30)  NULL,
  ds_cargo         VARCHAR(60)  NULL,
  st_ativo         CHAR(1)      NOT NULL DEFAULT 'A',
  st_criacao       DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  st_alteracao     DATETIME(6)  NULL ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT pk_mob_usuario PRIMARY KEY (id_usuario),
  CONSTRAINT uc_mob_usuario_nu_cpf UNIQUE (nu_cpf),
  CONSTRAINT ck_mob_usuario_st_ativo CHECK (st_ativo IN ('A','I')),
  CONSTRAINT ck_mob_usuario_nu_cpf CHECK (nu_cpf REGEXP '^[0-9]{11}$')
) ENGINE=InnoDB COMMENT='Profissional autenticado individualmente (RF-10.01)';

CREATE INDEX ix_mob_usuario_no_usuario ON mob_usuario (no_usuario);

CREATE TABLE mob_usuario_perfil (
  id_usuario_perfil INT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_usuario        INT UNSIGNED NOT NULL,
  id_perfil         SMALLINT UNSIGNED NOT NULL,
  st_criacao        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT pk_mob_usuario_perfil PRIMARY KEY (id_usuario_perfil),
  CONSTRAINT uc_mob_usuario_perfil_usuario_perfil UNIQUE (id_usuario, id_perfil),
  CONSTRAINT fk_mob_usuario_perfil_mob_usuario
    FOREIGN KEY (id_usuario) REFERENCES mob_usuario (id_usuario),
  CONSTRAINT fk_mob_usuario_perfil_mob_perfil
    FOREIGN KEY (id_perfil) REFERENCES mob_perfil (id_perfil)
) ENGINE=InnoDB COMMENT='Associativa entre usuario e perfil';

CREATE TABLE mob_base (
  id_base          SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  co_base          VARCHAR(20)  NOT NULL,
  no_base          VARCHAR(80)  NOT NULL,
  sg_base          VARCHAR(10)  NULL,
  ds_endereco      VARCHAR(200) NULL,
  vl_latitude      DECIMAL(10,7) NULL,
  vl_longitude     DECIMAL(10,7) NULL,
  dt_implantacao   DATE         NULL,
  st_ativo         CHAR(1)      NOT NULL DEFAULT 'A',
  CONSTRAINT pk_mob_base PRIMARY KEY (id_base),
  CONSTRAINT uc_mob_base_co_base UNIQUE (co_base),
  CONSTRAINT ck_mob_base_st_ativo CHECK (st_ativo IN ('A','I'))
) ENGINE=InnoDB COMMENT='Bases do SAMU 192 Salvador; dt_implantacao sustenta o indicador I9';

CREATE TABLE mob_viatura (
  id_viatura       SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_base          SMALLINT UNSIGNED NOT NULL,
  co_viatura       VARCHAR(20) NOT NULL,
  tp_viatura       CHAR(3)     NOT NULL,
  st_ativo         CHAR(1)     NOT NULL DEFAULT 'A',
  CONSTRAINT pk_mob_viatura PRIMARY KEY (id_viatura),
  CONSTRAINT uc_mob_viatura_co_viatura UNIQUE (co_viatura),
  CONSTRAINT fk_mob_viatura_mob_base
    FOREIGN KEY (id_base) REFERENCES mob_base (id_base),
  CONSTRAINT ck_mob_viatura_tp_viatura CHECK (tp_viatura IN ('USB','USA','MOT','EMB')),
  CONSTRAINT ck_mob_viatura_st_ativo CHECK (st_ativo IN ('A','I'))
) ENGINE=InnoDB COMMENT='USB, USA, motolancia e ambulancha';

CREATE TABLE mob_dispositivo (
  id_dispositivo   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_base          SMALLINT UNSIGNED NOT NULL,
  co_dispositivo   VARCHAR(30)  NOT NULL,
  ds_modelo        VARCHAR(80)  NULL,
  st_ativo         CHAR(1)      NOT NULL DEFAULT 'A',
  st_autorizacao   DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  st_revogacao     DATETIME(6)  NULL,
  CONSTRAINT pk_mob_dispositivo PRIMARY KEY (id_dispositivo),
  CONSTRAINT uc_mob_dispositivo_co_dispositivo UNIQUE (co_dispositivo),
  CONSTRAINT fk_mob_dispositivo_mob_base
    FOREIGN KEY (id_base) REFERENCES mob_base (id_base),
  CONSTRAINT ck_mob_dispositivo_st_ativo CHECK (st_ativo IN ('A','I'))
) ENGINE=InnoDB COMMENT='Aparelho autorizado; aparelho fora desta lista nao carrega dado algum';

-- =====================================================================
-- 2. TURNO E SESSAO
-- =====================================================================

CREATE TABLE mob_turno (
  id_turno         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_usuario       INT UNSIGNED NOT NULL,
  id_base          SMALLINT UNSIGNED NOT NULL,
  id_viatura       SMALLINT UNSIGNED NULL,
  id_dispositivo   INT UNSIGNED NOT NULL,
  hr_inicio        TIME         NOT NULL,
  hr_fim           TIME         NOT NULL,
  st_turno         CHAR(1)      NOT NULL DEFAULT 'A',
  st_abertura      DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  st_encerramento  DATETIME(6)  NULL,
  CONSTRAINT pk_mob_turno PRIMARY KEY (id_turno),
  CONSTRAINT fk_mob_turno_mob_usuario
    FOREIGN KEY (id_usuario) REFERENCES mob_usuario (id_usuario),
  CONSTRAINT fk_mob_turno_mob_base
    FOREIGN KEY (id_base) REFERENCES mob_base (id_base),
  CONSTRAINT fk_mob_turno_mob_viatura
    FOREIGN KEY (id_viatura) REFERENCES mob_viatura (id_viatura),
  CONSTRAINT fk_mob_turno_mob_dispositivo
    FOREIGN KEY (id_dispositivo) REFERENCES mob_dispositivo (id_dispositivo),
  CONSTRAINT ck_mob_turno_st_turno CHECK (st_turno IN ('A','E'))
) ENGINE=InnoDB COMMENT='Turno aberto por um profissional num aparelho';

CREATE INDEX ix_mob_turno_st_turno ON mob_turno (st_turno, id_usuario);

CREATE TABLE mob_turno_guarnicao (
  id_turno_guarnicao INT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_turno           INT UNSIGNED NOT NULL,
  id_usuario         INT UNSIGNED NOT NULL,
  ds_funcao          VARCHAR(60) NULL,
  CONSTRAINT pk_mob_turno_guarnicao PRIMARY KEY (id_turno_guarnicao),
  CONSTRAINT uc_mob_turno_guarnicao_turno_usuario UNIQUE (id_turno, id_usuario),
  CONSTRAINT fk_mob_turno_guarnicao_mob_turno
    FOREIGN KEY (id_turno) REFERENCES mob_turno (id_turno),
  CONSTRAINT fk_mob_turno_guarnicao_mob_usuario
    FOREIGN KEY (id_usuario) REFERENCES mob_usuario (id_usuario)
) ENGINE=InnoDB COMMENT='Composicao da guarnicao; nao transfere autoria de registro';

CREATE TABLE mob_sessao (
  id_sessao        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_usuario       INT UNSIGNED NOT NULL,
  id_dispositivo   INT UNSIGNED NOT NULL,
  co_token         CHAR(36)     NOT NULL,
  st_inicio        DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  st_expiracao     DATETIME(6)  NOT NULL,
  st_encerramento  DATETIME(6)  NULL,
  ds_motivo_encerramento VARCHAR(120) NULL,
  lg_expurgo_local TINYINT(1)   NOT NULL DEFAULT 0,
  CONSTRAINT pk_mob_sessao PRIMARY KEY (id_sessao),
  CONSTRAINT uc_mob_sessao_co_token UNIQUE (co_token),
  CONSTRAINT fk_mob_sessao_mob_usuario
    FOREIGN KEY (id_usuario) REFERENCES mob_usuario (id_usuario),
  CONSTRAINT fk_mob_sessao_mob_dispositivo
    FOREIGN KEY (id_dispositivo) REFERENCES mob_dispositivo (id_dispositivo),
  CONSTRAINT ck_mob_sessao_lg_expurgo_local CHECK (lg_expurgo_local IN (0,1))
) ENGINE=InnoDB COMMENT='Sessao offline valida por ate 72h (RF-11.04)';

CREATE INDEX ix_mob_sessao_st_expiracao ON mob_sessao (st_expiracao);

-- =====================================================================
-- 3. CATALOGO DO PROTOCOLO DE QUALIFICACAO (OE2)
-- =====================================================================

CREATE TABLE mob_procedencia (
  id_procedencia   TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  co_procedencia   VARCHAR(20)  NOT NULL,
  ds_procedencia   VARCHAR(120) NOT NULL,
  vl_confiabilidade DECIMAL(3,2) NOT NULL,
  CONSTRAINT pk_mob_procedencia PRIMARY KEY (id_procedencia),
  CONSTRAINT uc_mob_procedencia_co_procedencia UNIQUE (co_procedencia),
  CONSTRAINT ck_mob_procedencia_vl_confiabilidade
    CHECK (vl_confiabilidade > 0 AND vl_confiabilidade <= 1)
) ENGINE=InnoDB COMMENT='Observado, informado ou estimado; pondera o escore no NRI (RF-02.10)';

CREATE TABLE mob_grupo_atributo (
  id_grupo_atributo TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  co_grupo          VARCHAR(20) NOT NULL,
  no_grupo          VARCHAR(60) NOT NULL,
  nu_ordem          TINYINT UNSIGNED NOT NULL,
  st_ativo          CHAR(1)     NOT NULL DEFAULT 'A',
  CONSTRAINT pk_mob_grupo_atributo PRIMARY KEY (id_grupo_atributo),
  CONSTRAINT uc_mob_grupo_atributo_co_grupo UNIQUE (co_grupo),
  CONSTRAINT ck_mob_grupo_atributo_st_ativo CHECK (st_ativo IN ('A','I'))
) ENGINE=InnoDB COMMENT='As cinco etapas da captura em campo';

CREATE TABLE mob_tipo_atributo (
  id_tipo_atributo  SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_grupo_atributo TINYINT UNSIGNED NOT NULL,
  co_atributo       VARCHAR(40)  NOT NULL,
  no_atributo       VARCHAR(80)  NOT NULL,
  ds_atributo       VARCHAR(200) NULL,
  tp_dado           CHAR(1)      NOT NULL,
  lg_obrigatorio    TINYINT(1)   NOT NULL DEFAULT 0,
  lg_minimo_protocolo TINYINT(1) NOT NULL DEFAULT 0,
  nu_ordem          SMALLINT UNSIGNED NOT NULL,
  st_ativo          CHAR(1)      NOT NULL DEFAULT 'A',
  CONSTRAINT pk_mob_tipo_atributo PRIMARY KEY (id_tipo_atributo),
  CONSTRAINT uc_mob_tipo_atributo_co_atributo UNIQUE (co_atributo),
  CONSTRAINT fk_mob_tipo_atributo_mob_grupo_atributo
    FOREIGN KEY (id_grupo_atributo) REFERENCES mob_grupo_atributo (id_grupo_atributo),
  CONSTRAINT ck_mob_tipo_atributo_tp_dado CHECK (tp_dado IN ('T','N','D','L','B')),
  CONSTRAINT ck_mob_tipo_atributo_lg_obrigatorio CHECK (lg_obrigatorio IN (0,1)),
  CONSTRAINT ck_mob_tipo_atributo_lg_minimo CHECK (lg_minimo_protocolo IN (0,1)),
  CONSTRAINT ck_mob_tipo_atributo_st_ativo CHECK (st_ativo IN ('A','I'))
) ENGINE=InnoDB COMMENT='Atributos alternativos previstos no protocolo municipal';

CREATE INDEX ix_mob_tipo_atributo_id_grupo_atributo
  ON mob_tipo_atributo (id_grupo_atributo, nu_ordem);

CREATE TABLE mob_vocabulario (
  id_vocabulario    INT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_tipo_atributo  SMALLINT UNSIGNED NOT NULL,
  co_valor          VARCHAR(40)  NOT NULL,
  ds_valor          VARCHAR(120) NOT NULL,
  nu_ordem          SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  st_ativo          CHAR(1)      NOT NULL DEFAULT 'A',
  CONSTRAINT pk_mob_vocabulario PRIMARY KEY (id_vocabulario),
  CONSTRAINT uc_mob_vocabulario_tipo_valor UNIQUE (id_tipo_atributo, co_valor),
  CONSTRAINT fk_mob_vocabulario_mob_tipo_atributo
    FOREIGN KEY (id_tipo_atributo) REFERENCES mob_tipo_atributo (id_tipo_atributo),
  CONSTRAINT ck_mob_vocabulario_st_ativo CHECK (st_ativo IN ('A','I'))
) ENGINE=InnoDB COMMENT='Listas fechadas; evita texto livre como fonte de vinculacao (RF-02.08)';

-- =====================================================================
-- 4. CASO NAO IDENTIFICADO E CAPTURA
-- =====================================================================

CREATE TABLE mob_caso (
  id_caso            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  co_caso            VARCHAR(20)  NOT NULL,
  id_base            SMALLINT UNSIGNED NOT NULL,
  id_viatura         SMALLINT UNSIGNED NULL,
  id_turno           INT UNSIGNED NULL,
  id_usuario_abertura INT UNSIGNED NOT NULL,
  co_ocorrencia_samu VARCHAR(30)  NULL,
  st_caso            VARCHAR(20)  NOT NULL DEFAULT 'ABERTO',
  dt_ocorrencia      DATE         NOT NULL,
  hr_ocorrencia      TIME         NOT NULL,
  ds_local           VARCHAR(200) NULL,
  vl_latitude        DECIMAL(10,7) NULL,
  vl_longitude       DECIMAL(10,7) NULL,
  nu_precisao_gps    SMALLINT UNSIGNED NULL,
  ds_destino         VARCHAR(120) NULL,
  qt_completude      TINYINT UNSIGNED NOT NULL DEFAULT 0,
  dt_prazo           DATE         NULL,
  st_criacao         DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  st_alteracao       DATETIME(6)  NULL ON UPDATE CURRENT_TIMESTAMP(6),
  st_envio           DATETIME(6)  NULL,
  CONSTRAINT pk_mob_caso PRIMARY KEY (id_caso),
  CONSTRAINT uc_mob_caso_co_caso UNIQUE (co_caso),
  CONSTRAINT fk_mob_caso_mob_base
    FOREIGN KEY (id_base) REFERENCES mob_base (id_base),
  CONSTRAINT fk_mob_caso_mob_viatura
    FOREIGN KEY (id_viatura) REFERENCES mob_viatura (id_viatura),
  CONSTRAINT fk_mob_caso_mob_turno
    FOREIGN KEY (id_turno) REFERENCES mob_turno (id_turno),
  CONSTRAINT fk_mob_caso_mob_usuario
    FOREIGN KEY (id_usuario_abertura) REFERENCES mob_usuario (id_usuario),
  CONSTRAINT ck_mob_caso_st_caso CHECK (st_caso IN
    ('ABERTO','ENRIQUECIMENTO','ANALISE','ADJUDICACAO','RESOLVIDO',
     'NAO_RESOLVIDO','PERICIA','ENCERRADO')),
  CONSTRAINT ck_mob_caso_qt_completude CHECK (qt_completude BETWEEN 0 AND 100)
) ENGINE=InnoDB COMMENT='Registro de pessoa nao identificada aberto em campo';

CREATE INDEX ix_mob_caso_st_caso    ON mob_caso (st_caso, dt_prazo);
CREATE INDEX ix_mob_caso_id_base    ON mob_caso (id_base, dt_ocorrencia);
CREATE INDEX ix_mob_caso_st_envio   ON mob_caso (st_envio);

CREATE TABLE mob_caso_estado (
  id_caso_estado   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_caso          BIGINT UNSIGNED NOT NULL,
  st_anterior      VARCHAR(20)  NULL,
  st_atual         VARCHAR(20)  NOT NULL,
  id_usuario       INT UNSIGNED NULL,
  ds_motivo        VARCHAR(300) NULL,
  st_transicao     DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT pk_mob_caso_estado PRIMARY KEY (id_caso_estado),
  CONSTRAINT fk_mob_caso_estado_mob_caso
    FOREIGN KEY (id_caso) REFERENCES mob_caso (id_caso),
  CONSTRAINT fk_mob_caso_estado_mob_usuario
    FOREIGN KEY (id_usuario) REFERENCES mob_usuario (id_usuario)
) ENGINE=InnoDB COMMENT='Historico de transicoes; toda mudanca tem data, hora e responsavel (RF-01.03)';

CREATE INDEX ix_mob_caso_estado_id_caso ON mob_caso_estado (id_caso, st_transicao);

CREATE TABLE mob_caso_atributo (
  id_caso_atributo  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_caso           BIGINT UNSIGNED NOT NULL,
  id_tipo_atributo  SMALLINT UNSIGNED NOT NULL,
  id_procedencia    TINYINT UNSIGNED NOT NULL,
  id_vocabulario    INT UNSIGNED NULL,
  ds_valor          VARCHAR(300) NULL,
  vl_numerico       DECIMAL(12,3) NULL,
  dt_valor          DATE         NULL,
  id_usuario        INT UNSIGNED NOT NULL,
  lg_vigente        TINYINT(1)   NOT NULL DEFAULT 1,
  st_captura        DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  st_dispositivo    DATETIME(6)  NULL,
  co_vigencia       VARCHAR(64)
    GENERATED ALWAYS AS (IF(lg_vigente = 1,
      CONCAT(id_caso, '-', id_tipo_atributo), NULL)) VIRTUAL,
  CONSTRAINT pk_mob_caso_atributo PRIMARY KEY (id_caso_atributo),
  CONSTRAINT uc_mob_caso_atributo_co_vigencia UNIQUE (co_vigencia),
  CONSTRAINT fk_mob_caso_atributo_mob_caso
    FOREIGN KEY (id_caso) REFERENCES mob_caso (id_caso),
  CONSTRAINT fk_mob_caso_atributo_mob_tipo_atributo
    FOREIGN KEY (id_tipo_atributo) REFERENCES mob_tipo_atributo (id_tipo_atributo),
  CONSTRAINT fk_mob_caso_atributo_mob_procedencia
    FOREIGN KEY (id_procedencia) REFERENCES mob_procedencia (id_procedencia),
  CONSTRAINT fk_mob_caso_atributo_mob_vocabulario
    FOREIGN KEY (id_vocabulario) REFERENCES mob_vocabulario (id_vocabulario),
  CONSTRAINT fk_mob_caso_atributo_mob_usuario
    FOREIGN KEY (id_usuario) REFERENCES mob_usuario (id_usuario),
  CONSTRAINT ck_mob_caso_atributo_lg_vigente CHECK (lg_vigente IN (0,1)),
  CONSTRAINT ck_mob_caso_atributo_valor CHECK (
    id_vocabulario IS NOT NULL OR ds_valor IS NOT NULL
    OR vl_numerico IS NOT NULL OR dt_valor IS NOT NULL)
) ENGINE=InnoDB COMMENT='Valores capturados; versoes anteriores ficam com lg_vigente=0, nunca sao apagadas';

CREATE INDEX ix_mob_caso_atributo_id_caso ON mob_caso_atributo (id_caso, lg_vigente);

CREATE TABLE mob_midia (
  id_midia         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_caso          BIGINT UNSIGNED NOT NULL,
  id_usuario       INT UNSIGNED NOT NULL,
  tp_midia         CHAR(3)      NOT NULL,
  ds_legenda       VARCHAR(150) NULL,
  ds_caminho       VARCHAR(300) NOT NULL,
  co_hash          CHAR(64)     NOT NULL,
  nu_tamanho       INT UNSIGNED NOT NULL,
  lg_cifrada       TINYINT(1)   NOT NULL DEFAULT 1,
  lg_expurgada     TINYINT(1)   NOT NULL DEFAULT 0,
  st_captura       DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  st_envio         DATETIME(6)  NULL,
  CONSTRAINT pk_mob_midia PRIMARY KEY (id_midia),
  CONSTRAINT uc_mob_midia_co_hash UNIQUE (co_hash),
  CONSTRAINT fk_mob_midia_mob_caso
    FOREIGN KEY (id_caso) REFERENCES mob_caso (id_caso),
  CONSTRAINT fk_mob_midia_mob_usuario
    FOREIGN KEY (id_usuario) REFERENCES mob_usuario (id_usuario),
  CONSTRAINT ck_mob_midia_tp_midia CHECK (tp_midia IN ('IMG','DOC')),
  CONSTRAINT ck_mob_midia_lg_cifrada CHECK (lg_cifrada IN (0,1)),
  CONSTRAINT ck_mob_midia_lg_expurgada CHECK (lg_expurgada IN (0,1))
) ENGINE=InnoDB COMMENT='Referencia a midia no armazenamento de objetos; o binario nunca fica no MySQL';

CREATE INDEX ix_mob_midia_id_caso ON mob_midia (id_caso);

-- =====================================================================
-- 5. SINCRONIZACAO E DIVERGENCIA
-- =====================================================================

CREATE TABLE mob_evento_sincronizacao (
  id_evento        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_caso          BIGINT UNSIGNED NULL,
  id_dispositivo   INT UNSIGNED NOT NULL,
  id_usuario       INT UNSIGNED NOT NULL,
  co_idempotencia  CHAR(36)     NOT NULL,
  tp_evento        VARCHAR(30)  NOT NULL,
  ds_payload       JSON         NOT NULL,
  st_evento        VARCHAR(15)  NOT NULL DEFAULT 'PENDENTE',
  nu_tentativas    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  ds_erro          VARCHAR(300) NULL,
  st_dispositivo   DATETIME(6)  NOT NULL,
  st_envio         DATETIME(6)  NULL,
  st_aplicacao     DATETIME(6)  NULL,
  CONSTRAINT pk_mob_evento_sincronizacao PRIMARY KEY (id_evento),
  CONSTRAINT uc_mob_evento_sincronizacao_co_idempotencia UNIQUE (co_idempotencia),
  CONSTRAINT fk_mob_evento_sincronizacao_mob_caso
    FOREIGN KEY (id_caso) REFERENCES mob_caso (id_caso),
  CONSTRAINT fk_mob_evento_sincronizacao_mob_dispositivo
    FOREIGN KEY (id_dispositivo) REFERENCES mob_dispositivo (id_dispositivo),
  CONSTRAINT fk_mob_evento_sincronizacao_mob_usuario
    FOREIGN KEY (id_usuario) REFERENCES mob_usuario (id_usuario),
  CONSTRAINT ck_mob_evento_sincronizacao_tp_evento CHECK (tp_evento IN
    ('CASO','ATRIBUTO','MIDIA','ESTADO')),
  CONSTRAINT ck_mob_evento_sincronizacao_st_evento CHECK (st_evento IN
    ('PENDENTE','ENVIADO','APLICADO','DIVERGENTE','RECUSADO','EXPIRADO'))
) ENGINE=InnoDB COMMENT='Fila local; a chave de idempotencia garante que reenviar nunca duplica';

CREATE INDEX ix_mob_evento_sincronizacao_st_evento
  ON mob_evento_sincronizacao (st_evento, id_dispositivo);

CREATE TABLE mob_divergencia (
  id_divergencia   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_caso          BIGINT UNSIGNED NOT NULL,
  id_tipo_atributo SMALLINT UNSIGNED NOT NULL,
  id_evento        BIGINT UNSIGNED NOT NULL,
  ds_valor_dispositivo VARCHAR(300) NOT NULL,
  ds_valor_servidor    VARCHAR(300) NOT NULL,
  id_usuario_dispositivo INT UNSIGNED NOT NULL,
  id_usuario_servidor    INT UNSIGNED NULL,
  st_resolucao     VARCHAR(15)  NOT NULL DEFAULT 'PENDENTE',
  id_usuario_resolucao INT UNSIGNED NULL,
  ds_justificativa VARCHAR(300) NULL,
  st_deteccao      DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  st_resolvida     DATETIME(6)  NULL,
  CONSTRAINT pk_mob_divergencia PRIMARY KEY (id_divergencia),
  CONSTRAINT fk_mob_divergencia_mob_caso
    FOREIGN KEY (id_caso) REFERENCES mob_caso (id_caso),
  CONSTRAINT fk_mob_divergencia_mob_tipo_atributo
    FOREIGN KEY (id_tipo_atributo) REFERENCES mob_tipo_atributo (id_tipo_atributo),
  CONSTRAINT fk_mob_divergencia_mob_evento_sincronizacao
    FOREIGN KEY (id_evento) REFERENCES mob_evento_sincronizacao (id_evento),
  CONSTRAINT fk_mob_divergencia_mob_usuario
    FOREIGN KEY (id_usuario_resolucao) REFERENCES mob_usuario (id_usuario),
  CONSTRAINT ck_mob_divergencia_st_resolucao CHECK (st_resolucao IN
    ('PENDENTE','DISPOSITIVO','SERVIDOR','AMBOS'))
) ENGINE=InnoDB COMMENT='Conflito de valor na sincronizacao; nenhum lado e descartado (RF-11.02)';

CREATE INDEX ix_mob_divergencia_st_resolucao ON mob_divergencia (st_resolucao, id_caso);

-- =====================================================================
-- 6. TRILHA DE AUDITORIA
-- =====================================================================

CREATE TABLE mob_auditoria (
  id_auditoria     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_usuario       INT UNSIGNED NOT NULL,
  id_dispositivo   INT UNSIGNED NULL,
  id_caso          BIGINT UNSIGNED NULL,
  co_finalidade    VARCHAR(20)  NOT NULL,
  co_acao          VARCHAR(40)  NOT NULL,
  ds_recurso       VARCHAR(120) NOT NULL,
  ds_detalhe       JSON         NULL,
  co_hash_anterior CHAR(64)     NOT NULL,
  co_hash_atual    CHAR(64)     NOT NULL,
  st_ocorrencia    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT pk_mob_auditoria PRIMARY KEY (id_auditoria),
  CONSTRAINT uc_mob_auditoria_co_hash_atual UNIQUE (co_hash_atual),
  CONSTRAINT fk_mob_auditoria_mob_usuario
    FOREIGN KEY (id_usuario) REFERENCES mob_usuario (id_usuario),
  CONSTRAINT fk_mob_auditoria_mob_dispositivo
    FOREIGN KEY (id_dispositivo) REFERENCES mob_dispositivo (id_dispositivo),
  CONSTRAINT ck_mob_auditoria_co_finalidade CHECK (co_finalidade IN
    ('ASSISTENCIAL','AUDITORIA','PESQUISA','ADMINISTRACAO'))
) ENGINE=InnoDB COMMENT='Trilha encadeada por hash, apenas INSERT (RF-07.01, RF-07.02)';

CREATE INDEX ix_mob_auditoria_id_usuario ON mob_auditoria (id_usuario, st_ocorrencia);
CREATE INDEX ix_mob_auditoria_id_caso    ON mob_auditoria (id_caso, st_ocorrencia);

-- =====================================================================
-- 7. TRIGGERS
-- =====================================================================

DELIMITER //

CREATE TRIGGER tg_mob_auditoria_bloqueiaupdate
BEFORE UPDATE ON mob_auditoria
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Trilha de auditoria e imutavel (RF-07.02)';
END//

CREATE TRIGGER tg_mob_auditoria_bloqueiadelete
BEFORE DELETE ON mob_auditoria
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Trilha de auditoria e imutavel (RF-07.02)';
END//

CREATE TRIGGER tg_mob_caso_registraestado
AFTER UPDATE ON mob_caso
FOR EACH ROW
BEGIN
  IF NOT (NEW.st_caso <=> OLD.st_caso) THEN
    INSERT INTO mob_caso_estado (id_caso, st_anterior, st_atual, ds_motivo)
    VALUES (NEW.id_caso, OLD.st_caso, NEW.st_caso, 'Transicao registrada pelo gatilho');
  END IF;
END//

DELIMITER ;

-- =====================================================================
-- 8. FUNCAO E PROCEDIMENTO
-- =====================================================================

DELIMITER //

CREATE FUNCTION fn_mob_calcula_completude (p_id_caso BIGINT UNSIGNED)
RETURNS TINYINT UNSIGNED
DETERMINISTIC
READS SQL DATA
BEGIN
  DECLARE v_exigidos  SMALLINT DEFAULT 0;
  DECLARE v_atendidos SMALLINT DEFAULT 0;

  SELECT COUNT(*) INTO v_exigidos
    FROM mob_tipo_atributo
   WHERE lg_minimo_protocolo = 1 AND st_ativo = 'A';

  SELECT COUNT(DISTINCT ca.id_tipo_atributo) INTO v_atendidos
    FROM mob_caso_atributo ca
    JOIN mob_tipo_atributo ta ON ta.id_tipo_atributo = ca.id_tipo_atributo
   WHERE ca.id_caso = p_id_caso
     AND ca.lg_vigente = 1
     AND ta.lg_minimo_protocolo = 1
     AND ta.st_ativo = 'A';

  IF v_exigidos = 0 THEN
    RETURN 0;
  END IF;

  RETURN FLOOR(v_atendidos * 100 / v_exigidos);
END//

CREATE PROCEDURE sp_mob_registra_atributo (
  IN p_id_caso          BIGINT UNSIGNED,
  IN p_id_tipo_atributo SMALLINT UNSIGNED,
  IN p_id_procedencia   TINYINT UNSIGNED,
  IN p_id_vocabulario   INT UNSIGNED,
  IN p_ds_valor         VARCHAR(300),
  IN p_id_usuario       INT UNSIGNED
)
MODIFIES SQL DATA
BEGIN
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  START TRANSACTION;

  UPDATE mob_caso_atributo
     SET lg_vigente = 0
   WHERE id_caso = p_id_caso
     AND id_tipo_atributo = p_id_tipo_atributo
     AND lg_vigente = 1;

  INSERT INTO mob_caso_atributo
    (id_caso, id_tipo_atributo, id_procedencia, id_vocabulario,
     ds_valor, id_usuario, lg_vigente)
  VALUES
    (p_id_caso, p_id_tipo_atributo, p_id_procedencia, p_id_vocabulario,
     p_ds_valor, p_id_usuario, 1);

  UPDATE mob_caso
     SET qt_completude = fn_mob_calcula_completude(p_id_caso)
   WHERE id_caso = p_id_caso;

  COMMIT;
END//

DELIMITER ;

-- =====================================================================
-- 9. VIEWS
-- =====================================================================

CREATE VIEW vw_mob_fila_local AS
SELECT d.co_dispositivo,
       u.no_usuario,
       e.tp_evento,
       e.st_evento,
       COUNT(*)              AS qt_eventos,
       MIN(e.st_dispositivo) AS st_mais_antigo
  FROM mob_evento_sincronizacao e
  JOIN mob_dispositivo d ON d.id_dispositivo = e.id_dispositivo
  JOIN mob_usuario     u ON u.id_usuario     = e.id_usuario
 WHERE e.st_evento IN ('PENDENTE','ENVIADO','RECUSADO')
 GROUP BY d.co_dispositivo, u.no_usuario, e.tp_evento, e.st_evento;

CREATE VIEW vw_mob_caso_completude AS
SELECT c.co_caso,
       b.no_base,
       c.st_caso,
       c.dt_ocorrencia,
       c.dt_prazo,
       c.qt_completude,
       SUM(CASE WHEN ta.lg_minimo_protocolo = 1 THEN 1 ELSE 0 END) AS qt_minimos_preenchidos,
       COUNT(ca.id_caso_atributo)                                  AS qt_atributos_vigentes
  FROM mob_caso c
  JOIN mob_base b ON b.id_base = c.id_base
  LEFT JOIN mob_caso_atributo ca
         ON ca.id_caso = c.id_caso AND ca.lg_vigente = 1
  LEFT JOIN mob_tipo_atributo ta
         ON ta.id_tipo_atributo = ca.id_tipo_atributo
 GROUP BY c.id_caso, c.co_caso, b.no_base, c.st_caso,
          c.dt_ocorrencia, c.dt_prazo, c.qt_completude;

-- =====================================================================
-- 10. CARGA DE DOMINIOS (catalogo, sem dado pessoal)
-- =====================================================================

INSERT INTO mob_perfil (co_perfil, no_perfil, ds_perfil) VALUES
 ('CAMPO',      'Profissional de campo', 'Captura atributos na base e na viatura'),
 ('REGULACAO',  'Regulacao',             'Abre, acompanha e enriquece casos'),
 ('SUPERVISAO', 'Supervisao de base',    'Acompanha prazos e guarnicoes'),
 ('AUDITORIA',  'Auditoria e DPO',       'Consulta a trilha; nao edita caso');

INSERT INTO mob_procedencia (co_procedencia, ds_procedencia, vl_confiabilidade) VALUES
 ('OBSERVADO', 'Visto pela equipe durante o atendimento',       1.00),
 ('INFORMADO', 'Relatado por terceiro: familiar, testemunha',   0.70),
 ('ESTIMADO',  'Inferido pela equipe, como idade e estatura',   0.50);

INSERT INTO mob_grupo_atributo (co_grupo, no_grupo, nu_ordem) VALUES
 ('CIRCUNSTANCIA', 'Circunstancia',        1),
 ('FISICO',        'Caracteristicas fisicas', 2),
 ('VESTUARIO',     'Vestuario e objetos',  3),
 ('CLINICO',       'Achados clinicos',     4),
 ('MIDIA',         'Registro fotografico', 5);

INSERT INTO mob_tipo_atributo
  (id_grupo_atributo, co_atributo, no_atributo, tp_dado,
   lg_obrigatorio, lg_minimo_protocolo, nu_ordem)
VALUES
 (1,'LOCAL_OCORRENCIA','Local da ocorrencia','T',1,1,1),
 (1,'DATA_HORA','Data e hora do encontro','D',1,1,2),
 (1,'DESTINO','Destino do transporte','L',0,1,3),
 (1,'ACOMPANHANTE','Havia acompanhante ou testemunha','L',0,0,4),
 (2,'SEXO_APARENTE','Sexo aparente','L',1,1,1),
 (2,'FAIXA_ETARIA','Faixa etaria estimada','L',0,1,2),
 (2,'RACA_COR','Raca/cor','L',1,1,3),
 (2,'ESTATURA','Estatura aproximada','N',0,0,4),
 (2,'MARCA_IDENTIFICADORA','Marca identificadora','T',0,1,5),
 (2,'DENTICAO','Denticao','T',0,0,6),
 (3,'VESTUARIO_SUPERIOR','Vestuario superior','T',0,1,1),
 (3,'VESTUARIO_INFERIOR','Vestuario inferior','T',0,1,2),
 (3,'CALCADO','Calcado','T',0,1,3),
 (3,'OBJETO_PORTADO','Objeto portado','T',0,1,4),
 (3,'DOCUMENTO_PARCIAL','Documento ilegivel ou parcial','T',0,0,5),
 (4,'DISPOSITIVO_IMPLANTADO','Dispositivo implantado','T',0,0,1),
 (4,'CONDICAO_VISIVEL','Condicao visivel ou relatada','T',0,0,2),
 (4,'TIPAGEM_SANGUINEA','Tipagem sanguinea','L',0,0,3),
 (4,'CONSCIENCIA','Estado de consciencia no encontro','L',0,1,4),
 (5,'FOTO_MARCA','Fotografia de marca identificadora','T',0,0,1);

INSERT INTO mob_vocabulario (id_tipo_atributo, co_valor, ds_valor, nu_ordem)
SELECT ta.id_tipo_atributo, v.co_valor, v.ds_valor, v.nu_ordem
  FROM mob_tipo_atributo ta
  JOIN (
    SELECT 'SEXO_APARENTE' co_atributo,'F' co_valor,'Feminino' ds_valor,1 nu_ordem UNION ALL
    SELECT 'SEXO_APARENTE','M','Masculino',2 UNION ALL
    SELECT 'SEXO_APARENTE','I','Indeterminado',3 UNION ALL
    SELECT 'RACA_COR','BRANCA','Branca',1 UNION ALL
    SELECT 'RACA_COR','PRETA','Preta',2 UNION ALL
    SELECT 'RACA_COR','PARDA','Parda',3 UNION ALL
    SELECT 'RACA_COR','AMARELA','Amarela',4 UNION ALL
    SELECT 'RACA_COR','INDIGENA','Indigena',5 UNION ALL
    SELECT 'FAIXA_ETARIA','18_24','18 a 24 anos',1 UNION ALL
    SELECT 'FAIXA_ETARIA','25_34','25 a 34 anos',2 UNION ALL
    SELECT 'FAIXA_ETARIA','35_44','35 a 44 anos',3 UNION ALL
    SELECT 'FAIXA_ETARIA','45_59','45 a 59 anos',4 UNION ALL
    SELECT 'FAIXA_ETARIA','60_MAIS','60 anos ou mais',5 UNION ALL
    SELECT 'CONSCIENCIA','LUCIDO','Lucido',1 UNION ALL
    SELECT 'CONSCIENCIA','CONFUSO','Confuso',2 UNION ALL
    SELECT 'CONSCIENCIA','INCONSCIENTE','Inconsciente',3 UNION ALL
    SELECT 'TIPAGEM_SANGUINEA','A','Tipo A',1 UNION ALL
    SELECT 'TIPAGEM_SANGUINEA','B','Tipo B',2 UNION ALL
    SELECT 'TIPAGEM_SANGUINEA','AB','Tipo AB',3 UNION ALL
    SELECT 'TIPAGEM_SANGUINEA','O','Tipo O',4 UNION ALL
    SELECT 'TIPAGEM_SANGUINEA','NC','Nao coletada',5 UNION ALL
    SELECT 'ACOMPANHANTE','SIM','Sim',1 UNION ALL
    SELECT 'ACOMPANHANTE','NAO','Nao',2 UNION ALL
    SELECT 'ACOMPANHANTE','NAO_SEI','Nao sei',3
  ) v ON v.co_atributo = ta.co_atributo;
