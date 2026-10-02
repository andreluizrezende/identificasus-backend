-- =====================================================================
-- 11: a regulacao decide o caso (nao resolvido, pericia) e ve as fotos.
--
-- Grants do nri_adjudicacao (ADR-14). Em producao todas as finalidades rodam
-- como usr_samu (PENDENCIAS.md) e o script de migracao pula GRANT: la este
-- arquivo nao muda nada, e fica valendo para quando a separacao existir.
-- Local: npm run db:decisao.
-- =====================================================================

USE dbsamu;

-- Decisao do caso (US-31). So a coluna de estado: o resto do caso e do campo.
-- O historico (mob_caso_estado) e gravado pelo gatilho de 09, que roda com o
-- privilegio de quem o criou; a aplicacao so informa autor e motivo nas
-- variaveis de sessao.
GRANT UPDATE (st_caso) ON dbsamu.mob_caso TO 'nri_adjudicacao'@'%';

-- Fotos do caso (GET /regulacao/casos/:coCaso/fotos). Faltou junto com a
-- rota: o caminho no Blob vem de mob_midia.
GRANT SELECT ON dbsamu.mob_midia TO 'nri_adjudicacao'@'%';

FLUSH PRIVILEGES;
