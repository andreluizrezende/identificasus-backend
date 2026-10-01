-- =====================================================================
-- Credencial local: o Keycloak sai da arquitetura.
--
-- Até aqui quem guardava senha era o Keycloak (ADR-09) e `mob_usuario` só
-- sabia o `sub` dele (`co_usuario_idp`). Agora a API autentica sozinha: confere
-- a senha contra o hash guardado aqui e emite o próprio JWT
-- (src/acesso/senha.ts e src/acesso/token.service.ts).
--
-- (!) CONTINUA HAVENDO UM SÓ LUGAR COM SENHA. O argumento do ADR-09 contra
--     "dois armazenamentos de credencial" segue de pé — o que mudou foi qual
--     deles é o único. Não há cópia em outro serviço.
--
-- (!) CONTAS EXISTENTES FICAM SEM SENHA (`ds_senha_hash` nulo) e não entram até
--     alguém definir uma: pelo "perdi minha senha" do aplicativo, ou por
--     `npm run criar-administrador`, que redefine a senha de quem já existe.
--     A senha do Keycloak não é migrável — ele só guarda o hash, num formato
--     que não é o deste serviço — e inventar uma senha provisória em massa
--     seria criar justamente a credencial fraca que a política existe para
--     impedir.
-- =====================================================================

USE dbsamu;

ALTER TABLE mob_usuario
  ADD COLUMN ds_senha_hash VARCHAR(255) NULL
    COMMENT 'scrypt$<log2 N>$<r>$<p>$<sal>$<hash>; nunca a senha'
    AFTER ds_email,
  -- Finalidade do tratamento (ADR-14, LGPD art. 6º) que vai na claim
  -- `purpose` do token. Era um atributo do usuário no realm do Keycloak.
  -- (!) NÃO É CARGO: o cargo mora em mob_perfil, que aceita mais de um. Nula =
  --     token sem `purpose`, e o guard de finalidade recusa todas as rotas.
  ADD COLUMN co_finalidade VARCHAR(20) NULL
    COMMENT 'Finalidade da sessao (claim purpose); nula = nenhuma rota abre'
    AFTER ds_senha_hash,
  -- Freio de tentativas: o que era `bruteForceProtected` no realm.
  ADD COLUMN qt_falhas_login TINYINT UNSIGNED NOT NULL DEFAULT 0
    COMMENT 'Senhas erradas seguidas; zera no acerto e na troca de senha'
    AFTER co_finalidade,
  ADD COLUMN st_bloqueio_ate DATETIME(6) NULL
    COMMENT 'Ate quando a conta recusa entrada, mesmo com a senha certa'
    AFTER qt_falhas_login,
  ADD CONSTRAINT ck_mob_usuario_co_finalidade
    CHECK (co_finalidade IS NULL OR co_finalidade IN ('ASSISTENCIAL','AUDITORIA','PESQUISA','ADMINISTRACAO'));

-- O `sub` do Keycloak não identifica mais ninguém: o token agora carrega o
-- próprio id_usuario.
ALTER TABLE mob_usuario DROP INDEX uc_mob_usuario_co_usuario_idp;
ALTER TABLE mob_usuario DROP COLUMN co_usuario_idp;

-- ---------------------------------------------------------------------
-- Grants. Ficam aqui, e não em 02, porque grant por coluna exige a coluna.
--
-- (!) UPDATE POR COLUNA, como já era com st_credenciais_alteradas: a
--     aplicação troca a senha (recuperação) e conta as falhas (entrada), e
--     continua sem poder mexer em CPF, nome, e-mail, finalidade ou st_ativo.
--     Mudar a finalidade de alguém é ato de administração, não de atendimento.
-- ---------------------------------------------------------------------
GRANT UPDATE (st_credenciais_alteradas, ds_senha_hash, qt_falhas_login, st_bloqueio_ate)
  ON dbsamu.mob_usuario TO 'nri_assistencial'@'%';
