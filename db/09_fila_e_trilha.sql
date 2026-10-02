-- =====================================================================
-- 09: o caso fechado em campo entra na fila, o historico de estado tem uma
-- linha por transicao, e a trilha passa a ser verificavel pelo conteudo.
--
-- (!) SEM DELIMITER. O gatilho e uma instrucao unica, sem BEGIN/END, para
--     este arquivo rodar tanto pelo cliente mysql quanto pelo
--     scripts/aplicar-migracao.cjs, que recusa DELIMITER.
--
-- (!) APLICAR ANTES DO BACKEND NOVO. O CasoService deixa de gravar a linha
--     de historico e passa a informar autor e motivo ao gatilho. Backend novo
--     sobre o gatilho antigo grava a transicao sem autor.
-- =====================================================================

USE dbsamu;

-- ---------------------------------------------------------------------
-- 1. Historico de estado: UMA linha por transicao, com autor e motivo.
--
-- O gatilho de 01 gravava "Transicao registrada pelo gatilho", sem autor, e o
-- CasoService gravava outra linha, com autor: toda transicao saia em dobro, e
-- metade do historico dizia que ninguem a fez (RF-01.03). Agora quem muda o
-- estado pela aplicacao informa autor e motivo em variaveis da sessao
-- (@mob_transicao_usuario, @mob_transicao_motivo), e o gatilho grava uma
-- linha so. UPDATE feito direto no banco continua registrado, sem autor:
-- e isso que ele foi, e o historico tem de dizer.
-- ---------------------------------------------------------------------
DROP TRIGGER IF EXISTS tg_mob_caso_registraestado;

CREATE TRIGGER tg_mob_caso_registraestado
AFTER UPDATE ON mob_caso
FOR EACH ROW
  INSERT INTO mob_caso_estado (id_caso, st_anterior, st_atual, id_usuario, ds_motivo)
  SELECT NEW.id_caso, OLD.st_caso, NEW.st_caso, @mob_transicao_usuario,
         COALESCE(@mob_transicao_motivo, 'Transicao registrada pelo gatilho')
    FROM DUAL
   WHERE NOT (NEW.st_caso <=> OLD.st_caso);

-- ---------------------------------------------------------------------
-- 2. Decisao do produto (02/10/2026): o caso entra na fila da regulacao ao
--    fechar a captura. O que ja foi fechado em campo entra agora.
-- ---------------------------------------------------------------------
SET @mob_transicao_usuario = NULL;
SET @mob_transicao_motivo = 'migracao 09: captura ja fechada em campo entra na fila da regulacao';
UPDATE mob_caso SET st_caso = 'ANALISE' WHERE st_caso = 'ENRIQUECIMENTO';
SET @mob_transicao_motivo = NULL;

-- ---------------------------------------------------------------------
-- 3. Trilha verificavel pelo conteudo.
--
-- O hash de cada elo usava um identificador aleatorio que nao era gravado:
-- dava para conferir a ORDEM da cadeia, mas nao recalcular o hash a partir do
-- que esta na linha. Uma alteracao feita por quem desligasse os gatilhos
-- passaria pela verificacao. `co_elo` guarda esse identificador, e o hash
-- passa a cobrir tambem aparelho e caso. Elos anteriores a esta coluna ficam
-- com co_elo nulo e continuam verificaveis so pela ordem.
-- ---------------------------------------------------------------------
ALTER TABLE mob_auditoria ADD COLUMN co_elo CHAR(36) NULL AFTER id_auditoria;
