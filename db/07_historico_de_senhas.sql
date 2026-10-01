-- =====================================================================
-- Historico de senhas: a nova nao pode repetir nenhuma das 3 ultimas.
--
-- Era o `passwordHistory(3)` do realm do Keycloak, que saiu da arquitetura em
-- 06_credencial_local.sql. As 3 contam a atual: ela fica em
-- mob_usuario.ds_senha_hash, e aqui ficam so as 2 anteriores.
--
-- (!) SO AS 2 ANTERIORES, E NAO TODAS. Cada hash guardado e mais um alvo de
--     quebra offline se o banco vazar, e senha antiga costuma ser variacao da
--     atual. Guardar alem do que a regra usa so aumenta o que vaza. A
--     aplicacao apaga as mais velhas a cada troca.
--
-- (!) HASH, NUNCA A SENHA. Mesmo formato de ds_senha_hash (scrypt com sal
--     proprio): conferir "ja foi usada?" custa um scrypt por hash guardado.
-- =====================================================================

USE dbsamu;

CREATE TABLE mob_senha_historico (
  id_senha_historico BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_usuario         INT UNSIGNED NOT NULL,
  ds_senha_hash      VARCHAR(255) NOT NULL,
  -- Quando esta senha DEIXOU de valer (foi substituida).
  st_substituicao    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT pk_mob_senha_historico PRIMARY KEY (id_senha_historico),
  CONSTRAINT fk_mob_senha_historico_mob_usuario
    FOREIGN KEY (id_usuario) REFERENCES mob_usuario (id_usuario)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='Hashes das senhas anteriores; so as mais recentes, para a regra de nao repetir';

-- A consulta e sempre "as ultimas deste usuario".
CREATE INDEX ix_mob_senha_historico_id_usuario
  ON mob_senha_historico (id_usuario, id_senha_historico);

-- ---------------------------------------------------------------------
-- Grants. Ficam aqui, e nao em 02, porque a tabela nasce aqui.
--
-- nri_assistencial troca a senha na recuperacao; nri_administracao, no
-- criar-administrador. Os dois leem, gravam a senha que saiu e apagam as
-- antigas. Nenhum dos dois pode alterar uma linha: historico nao se edita.
-- ---------------------------------------------------------------------
GRANT SELECT, INSERT, DELETE ON dbsamu.mob_senha_historico TO 'nri_assistencial'@'%';
GRANT SELECT, INSERT, DELETE ON dbsamu.mob_senha_historico TO 'nri_administracao'@'%';
