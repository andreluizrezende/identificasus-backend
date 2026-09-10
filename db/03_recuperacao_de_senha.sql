-- =====================================================================
-- Recuperacao de senha ("perdi minha senha").
--
-- Referencia: fiocruz-backend, migrations 20260822090000 e 20260822120000.
-- O fluxo, os limites e a disciplina de nao revelar quais contas existem vem
-- de la. O que muda aqui esta anotado abaixo.
--
-- (!) TABELA PROPRIA, E NAO COLUNAS EM mob_usuario. Guardar o codigo na linha
--     do usuario parece mais simples e custa caro: perde-se o historico de
--     pedidos, que e o que denuncia um ataque em andamento, e cada pedido novo
--     sobrescreve o anterior sem deixar rastro de que existiu.
--
-- (!) O CODIGO NAO E GUARDADO, so o hash bcrypt dele. Quem le o banco nao entra
--     na conta de ninguem.
--
-- (!) NENHUMA SENHA MORA AQUI. Diferente do fiocruz, neste projeto quem guarda
--     credencial e o Keycloak (ADR-09). Esta tabela guarda o codigo de uso
--     unico e a trilha; a troca da senha acontece na API administrativa do
--     Keycloak. Criar uma coluna de hash de senha aqui abriria um segundo
--     armazenamento de credencial — dois lugares para revogar, dois para vazar.
-- =====================================================================

USE dbsamu;

CREATE TABLE mob_recuperacao (
  id_recuperacao   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_usuario       INT UNSIGNED NOT NULL,
  -- Hash bcrypt do codigo de 6 digitos. Prefixo co_ porque e codigo; o
  -- comprimento e de hash, nao de codigo.
  co_codigo_hash   VARCHAR(72)  NOT NULL,
  st_expiracao     DATETIME(6)  NOT NULL,
  -- Preenchida no uso: e ela que torna o codigo de uso unico.
  -- Nula = ainda vale, se nao tiver expirado.
  st_uso           DATETIME(6)  NULL,
  -- Cada palpite errado incrementa. Seis digitos sao um milhao de combinacoes,
  -- o que nao basta contra um script: o teto de tentativas e o que faz o
  -- codigo curto ser seguro.
  qt_tentativas    TINYINT UNSIGNED NOT NULL DEFAULT 0,
  -- Quem pediu, para a trilha. Nao identifica pessoa sozinho, mas mostra se
  -- mil pedidos sairam do mesmo lugar.
  ds_origem        VARCHAR(45)  NULL,
  st_criacao       DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT pk_mob_recuperacao PRIMARY KEY (id_recuperacao),
  CONSTRAINT fk_mob_recuperacao_mob_usuario
    FOREIGN KEY (id_usuario) REFERENCES mob_usuario (id_usuario)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT ck_mob_recuperacao_qt_tentativas CHECK (qt_tentativas BETWEEN 0 AND 10)
) ENGINE=InnoDB COMMENT='Pedido de recuperacao de senha; guarda o hash do codigo, nunca a senha';

-- A consulta quente e "o ultimo codigo valido deste usuario".
CREATE INDEX ix_mob_recuperacao_id_usuario
  ON mob_recuperacao (id_usuario, st_expiracao);

-- ---------------------------------------------------------------------
-- Instante da ultima troca de credencial.
--
-- (!) E o que permite recusar um token emitido ANTES dela. Sem isto, redefinir
--     a senha nao derruba sessao nenhuma, e quem entrou com a senha velha fica
--     dentro ate o token expirar — o recurso pela metade, justo no caso que ele
--     existe para atender.
--
-- (!) NULA NAS LINHAS EXISTENTES, E ISSO E O CERTO. Preencher com NOW() na
--     migracao invalidaria de uma vez todos os tokens em circulacao: um logout
--     coletivo no meio do plantao, causado por uma migracao. Nulo significa
--     "nunca trocou", e nada e comparado.
--
-- (!) NAO SERVE PARA DESATIVACAO. Conta desligada e st_ativo = 'I', conferido
--     direto na linha. Sao dois mecanismos porque sao duas perguntas: "esta
--     credencial ainda vale?" e "esta pessoa ainda trabalha aqui?".
-- ---------------------------------------------------------------------
ALTER TABLE mob_usuario
  ADD COLUMN st_credenciais_alteradas DATETIME(6) NULL
  COMMENT 'Instante da ultima troca de senha; derruba tokens emitidos antes';

-- E-mail do profissional. Ate aqui o cadastro vinha do Keycloak; a recuperacao
-- precisa de um destino, e o destino tem de ser conhecido antes do pedido.
ALTER TABLE mob_usuario
  ADD COLUMN ds_email VARCHAR(180) NULL AFTER no_usuario;

ALTER TABLE mob_usuario
  ADD CONSTRAINT uc_mob_usuario_ds_email UNIQUE (ds_email);

-- Identificador do profissional no provedor de identidade (Keycloak). E o que
-- permite trocar a senha la sem guardar credencial aqui.
ALTER TABLE mob_usuario
  ADD COLUMN co_usuario_idp VARCHAR(64) NULL
  COMMENT 'Subject do usuario no Keycloak; a senha vive la, nao aqui'
  AFTER ds_email;

ALTER TABLE mob_usuario
  ADD CONSTRAINT uc_mob_usuario_co_usuario_idp UNIQUE (co_usuario_idp);
