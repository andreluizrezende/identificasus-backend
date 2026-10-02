-- =====================================================================
-- Finalidade ADJUDICACAO: a Central de Regulacao (identificasus-web).
--
-- O usuario de banco nri_adjudicacao existe desde 02 (ADR-14), mas sem grant
-- nenhum e sem finalidade correspondente na aplicacao. O console da
-- regulacao e quem decide vinculo, e decide com esta finalidade.
--
-- (!) FINALIDADE NAO E CARGO, como sempre: o cargo REGULACAO mora em
--     mob_perfil. ADJUDICACAO diz PARA QUE os dados sao lidos naquela sessao.
--
-- (!) SO LEITURA, POR ENQUANTO. As telas do console sao a fila (casos em
--     ANALISE e ADJUDICACAO) e o detalhe do caso. Os grants de escrita vem
--     junto com as tabelas web_ da comparacao e da adjudicacao, quando elas
--     existirem: grant dado antes da necessidade e grant que ninguem lembra
--     de tirar.
--
-- A trilha de auditoria continua sendo gravada pelo pool assistencial
-- (AuditoriaService), entao nri_adjudicacao nao precisa de nada em
-- mob_auditoria. Mas a trilha precisa ACEITAR a finalidade: sem o CHECK
-- abaixo, cada consulta da regulacao era recusada pelo banco, e o
-- AuditoriaService, que nao derruba a requisicao por falha de trilha, so
-- registrava o erro no log.
-- =====================================================================

USE dbsamu;

-- A finalidade nova precisa caber na coluna (ver 06_credencial_local.sql).
ALTER TABLE mob_usuario DROP CONSTRAINT ck_mob_usuario_co_finalidade;
ALTER TABLE mob_usuario
  ADD CONSTRAINT ck_mob_usuario_co_finalidade
  CHECK (co_finalidade IS NULL OR co_finalidade IN
    ('ASSISTENCIAL','AUDITORIA','PESQUISA','ADMINISTRACAO','ADJUDICACAO'));

ALTER TABLE mob_auditoria DROP CONSTRAINT ck_mob_auditoria_co_finalidade;
ALTER TABLE mob_auditoria
  ADD CONSTRAINT ck_mob_auditoria_co_finalidade
  CHECK (co_finalidade IN
    ('ASSISTENCIAL','AUDITORIA','PESQUISA','ADMINISTRACAO','ADJUDICACAO'));

-- Fila
GRANT SELECT ON dbsamu.mob_caso TO 'nri_adjudicacao'@'%';
GRANT SELECT ON dbsamu.mob_base TO 'nri_adjudicacao'@'%';

-- Detalhe do caso: atributos vigentes, catalogo do protocolo e historico.
GRANT SELECT ON dbsamu.mob_caso_atributo  TO 'nri_adjudicacao'@'%';
GRANT SELECT ON dbsamu.mob_caso_estado    TO 'nri_adjudicacao'@'%';
GRANT SELECT ON dbsamu.mob_tipo_atributo  TO 'nri_adjudicacao'@'%';
GRANT SELECT ON dbsamu.mob_grupo_atributo TO 'nri_adjudicacao'@'%';
GRANT SELECT ON dbsamu.mob_vocabulario    TO 'nri_adjudicacao'@'%';
GRANT SELECT ON dbsamu.mob_procedencia    TO 'nri_adjudicacao'@'%';

-- (!) mob_usuario SO POR COLUNA. O detalhe mostra quem capturou cada atributo
--     e quem mudou o estado, e para isso basta o nome. CPF, e-mail e hash de
--     senha continuam fora do alcance da regulacao.
GRANT SELECT (id_usuario, no_usuario) ON dbsamu.mob_usuario TO 'nri_adjudicacao'@'%';
