-- =====================================================================
-- 10: numero e data gravados no tipo certo; historico sem as duplicatas
-- deixadas pelo gatilho antigo.
--
-- Usa DELIMITER (procedure com BEGIN ... END). Producao: o
-- scripts/aplicar-migracao-producao.ps1 entende DELIMITER desde esta
-- migracao. Local: npm run db:valor-tipado.
-- =====================================================================

USE dbsamu;

-- ---------------------------------------------------------------------
-- 1. sp_mob_registra_atributo grava numero em vl_numerico e data em dt_valor.
--
-- A procedure so recebia texto e gravava tudo em ds_valor: a estatura ficava
-- "1.80", e vl_numerico e dt_valor existiam na tabela sem uso. Uma comparacao
-- numerica (o que o motor de vinculo vai precisar) nao teria de onde ler.
-- A assinatura nao muda: o tipo vem de mob_tipo_atributo.tp_dado, e so passa
-- para a coluna tipada o texto que e de fato um numero ou uma data valida.
-- O resto continua em ds_valor, como antes: nada e perdido por nao converter.
-- ---------------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_mob_registra_atributo;

DELIMITER //

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
  DECLARE v_tp_dado CHAR(1) DEFAULT NULL;
  DECLARE v_texto   VARCHAR(300) DEFAULT p_ds_valor;
  DECLARE v_numero  DECIMAL(12,3) DEFAULT NULL;
  DECLARE v_data    DATE DEFAULT NULL;

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  SELECT tp_dado INTO v_tp_dado
    FROM mob_tipo_atributo WHERE id_tipo_atributo = p_id_tipo_atributo;

  IF p_id_vocabulario IS NULL AND p_ds_valor IS NOT NULL THEN
    IF v_tp_dado = 'N' AND TRIM(p_ds_valor) REGEXP '^-?[0-9]{1,9}([.][0-9]{1,3})?$' THEN
      SET v_numero = CAST(TRIM(p_ds_valor) AS DECIMAL(12,3));
      SET v_texto = NULL;
    ELSEIF v_tp_dado = 'D' AND TRIM(p_ds_valor) REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      SET v_data = STR_TO_DATE(TRIM(p_ds_valor), '%Y-%m-%d');
      IF v_data IS NOT NULL THEN SET v_texto = NULL; END IF;
    END IF;
  END IF;

  START TRANSACTION;

  UPDATE mob_caso_atributo
     SET lg_vigente = 0
   WHERE id_caso = p_id_caso
     AND id_tipo_atributo = p_id_tipo_atributo
     AND lg_vigente = 1;

  INSERT INTO mob_caso_atributo
    (id_caso, id_tipo_atributo, id_procedencia, id_vocabulario,
     ds_valor, vl_numerico, dt_valor, id_usuario, lg_vigente)
  VALUES
    (p_id_caso, p_id_tipo_atributo, p_id_procedencia, p_id_vocabulario,
     v_texto, v_numero, v_data, p_id_usuario, 1);

  UPDATE mob_caso
     SET qt_completude = fn_mob_calcula_completude(p_id_caso)
   WHERE id_caso = p_id_caso;

  COMMIT;
END//

DELIMITER ;

-- Recriar a procedure apaga o EXECUTE dado em 02. (Em producao o script pula
-- o GRANT: la tudo roda como usr_samu.)
GRANT EXECUTE ON PROCEDURE dbsamu.sp_mob_registra_atributo TO 'nri_assistencial'@'%';

-- O que ja foi gravado como texto passa para a coluna do tipo. E o mesmo
-- valor em outra coluna, e nao uma correcao: autor, procedencia, horario e
-- versao continuam os da linha.
UPDATE mob_caso_atributo a
  JOIN mob_tipo_atributo t ON t.id_tipo_atributo = a.id_tipo_atributo
   SET a.vl_numerico = CAST(TRIM(a.ds_valor) AS DECIMAL(12,3)), a.ds_valor = NULL
 WHERE t.tp_dado = 'N' AND a.id_vocabulario IS NULL AND a.vl_numerico IS NULL
   AND TRIM(a.ds_valor) REGEXP '^-?[0-9]{1,9}([.][0-9]{1,3})?$';

UPDATE mob_caso_atributo a
  JOIN mob_tipo_atributo t ON t.id_tipo_atributo = a.id_tipo_atributo
   SET a.dt_valor = STR_TO_DATE(TRIM(a.ds_valor), '%Y-%m-%d'), a.ds_valor = NULL
 WHERE t.tp_dado = 'D' AND a.id_vocabulario IS NULL AND a.dt_valor IS NULL
   AND TRIM(a.ds_valor) REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
   AND STR_TO_DATE(TRIM(a.ds_valor), '%Y-%m-%d') IS NOT NULL;

-- ---------------------------------------------------------------------
-- 2. Historico de estado: tira as duplicatas do gatilho antigo.
--
-- Ate a migracao 09, cada transicao feita pela aplicacao gravava duas linhas:
-- uma do CasoService, com autor e motivo, e uma do gatilho, sem autor e com o
-- motivo "Transicao registrada pelo gatilho". Sai SO a do gatilho que tem
-- gemea com autor: mesmo caso, mesmos estados, ate 2 s de diferenca. Uma
-- transicao feita direto no banco (so a linha do gatilho, sem gemea) fica:
-- e o registro de que ninguem pela aplicacao a fez.
-- ---------------------------------------------------------------------
DELETE dup
  FROM mob_caso_estado dup
  JOIN mob_caso_estado gemea
    ON gemea.id_caso = dup.id_caso
   AND gemea.st_atual = dup.st_atual
   AND gemea.st_anterior <=> dup.st_anterior
   AND gemea.id_caso_estado <> dup.id_caso_estado
   AND gemea.id_usuario IS NOT NULL
   AND ABS(TIMESTAMPDIFF(MICROSECOND, gemea.st_transicao, dup.st_transicao)) <= 2000000
 WHERE dup.id_usuario IS NULL
   AND dup.ds_motivo = 'Transicao registrada pelo gatilho';
