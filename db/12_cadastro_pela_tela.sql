-- =====================================================================
-- 12: cadastro de profissionais e aparelhos pela tela de administracao
--     (US-34; modulo administracao/ no backend, area "Administracao" no
--     console web).
--
-- Grants do nri_administracao (ADR-14). Em producao todas as finalidades
-- rodam como usr_samu e o script de migracao pula GRANT: la este arquivo nao
-- muda nada. Local: npm run db:cadastro.
-- =====================================================================

USE dbsamu;

-- Tirar um perfil de alguem e apagar a linha de associacao: mob_usuario_perfil
-- nao tem coluna de ativo. 02 deu SELECT, INSERT e UPDATE, mas nao DELETE.
-- O que foi tirado fica na trilha (admin_profissional_alterado, com antes e
-- depois), que e onde a historia de acesso de alguem precisa estar.
GRANT DELETE ON dbsamu.mob_usuario_perfil TO 'nri_administracao'@'%';

FLUSH PRIVILEGES;
