-- =====================================================================
-- ADR-14: o MySQL nao tem row-level security. A separacao por finalidade
-- e reconstruida com usuarios distintos, views e uma camada unica de
-- acesso na aplicacao. Trocar as senhas antes de aplicar.
-- =====================================================================

CREATE USER IF NOT EXISTS 'nri_assistencial'@'%' IDENTIFIED BY 'trocar';
CREATE USER IF NOT EXISTS 'nri_adjudicacao'@'%'  IDENTIFIED BY 'trocar';
CREATE USER IF NOT EXISTS 'nri_auditoria'@'%'    IDENTIFIED BY 'trocar';
CREATE USER IF NOT EXISTS 'nri_pesquisa'@'%'     IDENTIFIED BY 'trocar';
CREATE USER IF NOT EXISTS 'nri_migracao'@'%'     IDENTIFIED BY 'trocar';
CREATE USER IF NOT EXISTS 'nri_administracao'@'%' IDENTIFIED BY 'trocar';

-- Finalidade assistencial: opera o caso e a captura.
GRANT SELECT, INSERT, UPDATE ON dbsamu.mob_caso           TO 'nri_assistencial'@'%';
GRANT SELECT, INSERT, UPDATE ON dbsamu.mob_caso_atributo  TO 'nri_assistencial'@'%';
GRANT SELECT, INSERT         ON dbsamu.mob_caso_estado    TO 'nri_assistencial'@'%';
GRANT SELECT, INSERT, UPDATE ON dbsamu.mob_midia          TO 'nri_assistencial'@'%';
GRANT SELECT, INSERT, UPDATE ON dbsamu.mob_evento_sincronizacao TO 'nri_assistencial'@'%';
GRANT SELECT, INSERT, UPDATE ON dbsamu.mob_divergencia    TO 'nri_assistencial'@'%';
GRANT SELECT, INSERT, UPDATE ON dbsamu.mob_sessao         TO 'nri_assistencial'@'%';
-- Recuperacao de senha: le, cria e queima codigo. Nunca apaga: o historico de
-- pedidos e o que denuncia um ataque em andamento.
GRANT SELECT, INSERT, UPDATE ON dbsamu.mob_recuperacao    TO 'nri_assistencial'@'%';
GRANT SELECT, INSERT         ON dbsamu.mob_turno          TO 'nri_assistencial'@'%';
GRANT SELECT, INSERT         ON dbsamu.mob_turno_guarnicao TO 'nri_assistencial'@'%';
GRANT SELECT ON dbsamu.mob_usuario          TO 'nri_assistencial'@'%';
-- (!) UPDATE DE UMA COLUNA SO, e nao da tabela. `st_credenciais_alteradas` e o
--     que derruba os tokens emitidos antes da troca de senha; sem este grant, a
--     troca acontece no Keycloak e as sessoes abertas continuam validas ate o
--     token expirar — o recurso pela metade, e falhando em silencio.
--     O grant por coluna deixa a aplicacao carimbar a data e continua sem
--     deixa-la mexer em CPF, nome, e-mail ou st_ativo.
GRANT UPDATE (st_credenciais_alteradas) ON dbsamu.mob_usuario TO 'nri_assistencial'@'%';
GRANT SELECT ON dbsamu.mob_perfil           TO 'nri_assistencial'@'%';
GRANT SELECT ON dbsamu.mob_usuario_perfil   TO 'nri_assistencial'@'%';
GRANT SELECT ON dbsamu.mob_base             TO 'nri_assistencial'@'%';
GRANT SELECT ON dbsamu.mob_viatura          TO 'nri_assistencial'@'%';
GRANT SELECT ON dbsamu.mob_dispositivo      TO 'nri_assistencial'@'%';
GRANT SELECT ON dbsamu.mob_procedencia      TO 'nri_assistencial'@'%';
GRANT SELECT ON dbsamu.mob_grupo_atributo   TO 'nri_assistencial'@'%';
GRANT SELECT ON dbsamu.mob_tipo_atributo    TO 'nri_assistencial'@'%';
GRANT SELECT ON dbsamu.mob_vocabulario      TO 'nri_assistencial'@'%';
-- Na trilha, so escreve. Nunca le em massa, nunca altera.
GRANT INSERT ON dbsamu.mob_auditoria TO 'nri_assistencial'@'%';
GRANT EXECUTE ON PROCEDURE dbsamu.sp_mob_registra_atributo TO 'nri_assistencial'@'%';
GRANT EXECUTE ON FUNCTION  dbsamu.fn_mob_calcula_completude TO 'nri_assistencial'@'%';

-- Auditoria: le a trilha inteira, nao altera nada.
GRANT SELECT ON dbsamu.mob_auditoria TO 'nri_auditoria'@'%';
GRANT SELECT ON dbsamu.mob_caso_estado TO 'nri_auditoria'@'%';
GRANT SELECT ON dbsamu.mob_divergencia TO 'nri_auditoria'@'%';

-- Pesquisa: apenas as views pseudonimizadas. Nenhum grant em tabela base.
GRANT SELECT ON dbsamu.vw_mob_caso_completude TO 'nri_pesquisa'@'%';

-- Administracao: cadastros. E a finalidade dos scripts de operacao e das telas
-- de cadastro — criar profissional, base, viatura, aparelho.
--
-- (!) NAO TEM ACESSO A CASO, ATRIBUTO, MIDIA NEM DIVERGENCIA. Quem administra o
--     ambiente nao le atendimento: sao finalidades distintas, e o token carrega
--     uma so. Foi por isso que `scripts/criar-administrador.ts` deixou de usar
--     DATABASE_URL — um script de cadastro rodando como `nri_assistencial`
--     precisaria que o usuario assistencial pudesse criar usuarios, e ai a
--     separacao do ADR-14 teria sido desfeita pela porta dos fundos.
GRANT SELECT, INSERT, UPDATE ON dbsamu.mob_usuario        TO 'nri_administracao'@'%';
GRANT SELECT, INSERT, UPDATE ON dbsamu.mob_usuario_perfil TO 'nri_administracao'@'%';
GRANT SELECT, INSERT, UPDATE ON dbsamu.mob_base           TO 'nri_administracao'@'%';
GRANT SELECT, INSERT, UPDATE ON dbsamu.mob_viatura        TO 'nri_administracao'@'%';
GRANT SELECT, INSERT, UPDATE ON dbsamu.mob_dispositivo    TO 'nri_administracao'@'%';
GRANT SELECT ON dbsamu.mob_perfil TO 'nri_administracao'@'%';
GRANT INSERT ON dbsamu.mob_auditoria TO 'nri_administracao'@'%';
GRANT EXECUTE ON PROCEDURE dbsamu.sp_mob_ultimo_elo TO 'nri_administracao'@'%';

-- Migracao: DDL, usado so pelo pipeline.
GRANT ALL PRIVILEGES ON dbsamu.* TO 'nri_migracao'@'%';

FLUSH PRIVILEGES;
