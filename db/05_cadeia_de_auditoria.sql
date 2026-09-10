-- =====================================================================
-- IdentificaSUS · dbsamu · leitura do último elo da trilha
-- ---------------------------------------------------------------------
-- O PROBLEMA QUE ISTO RESOLVE
--
-- A trilha é encadeada por hash: cada linha guarda o hash da anterior. Para
-- gravar um elo novo, a aplicação precisa LER o último — e `nri_assistencial`
-- tem, de propósito, apenas INSERT em `mob_auditoria` (ver
-- 02_usuarios_por_finalidade.sql). Sem isso, o encadeamento não fecha.
--
-- As duas saídas erradas, e por que são erradas:
--
--   1. Dar SELECT em `mob_auditoria` a `nri_assistencial`. Resolveria, e
--      transformaria o usuário que atende no campo em usuário que lê a trilha
--      inteira. A trilha registra quem viu o quê; quem é vigiado por ela não
--      deveria poder lê-la.
--   2. Calcular o hash dentro do banco, com SHA2() e concatenação. Resolveria,
--      e criaria uma segunda implementação do mesmo algoritmo — uma em SQL,
--      outra em TypeScript (src/comum/hash-auditoria.ts). Duas implementações
--      de um hash divergem em silêncio, e uma cadeia que não fecha por
--      divergência de implementação é indistinguível de uma cadeia adulterada.
--
-- A saída adotada: um procedimento com SQL SECURITY DEFINER que devolve UMA
-- linha — o último hash — e nada mais. A aplicação recebe o elo anterior,
-- calcula o novo em TypeScript (implementação única) e insere. O grant é
-- EXECUTE, não SELECT: `nri_assistencial` continua sem conseguir ler a trilha.
--
-- (!) O `FOR UPDATE` É O QUE IMPEDE A CADEIA DE BIFURCAR. Dois eventos
--     simultâneos leriam o mesmo elo anterior e produziriam dois "próximos" —
--     e cadeia bifurcada não prova nada. O bloqueio pertence à transação de
--     quem chamou, e por isso a chamada tem de estar dentro dela.
-- =====================================================================

USE dbsamu;

DROP PROCEDURE IF EXISTS sp_mob_ultimo_elo;

DELIMITER $$

CREATE DEFINER = CURRENT_USER PROCEDURE sp_mob_ultimo_elo (
  OUT p_co_hash CHAR(64)
)
  SQL SECURITY DEFINER
  READS SQL DATA
BEGIN
  SELECT co_hash_atual
    INTO p_co_hash
    FROM mob_auditoria
   ORDER BY id_auditoria DESC
   LIMIT 1
     FOR UPDATE;
END$$

DELIMITER ;

-- EXECUTE, e só. Continua sem SELECT em mob_auditoria.
GRANT EXECUTE ON PROCEDURE dbsamu.sp_mob_ultimo_elo TO 'nri_assistencial'@'%';
GRANT EXECUTE ON PROCEDURE dbsamu.sp_mob_ultimo_elo TO 'nri_auditoria'@'%';
FLUSH PRIVILEGES;
