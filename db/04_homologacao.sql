-- =====================================================================
-- IdentificaSUS · dbsamu · carga de HOMOLOGAÇÃO
-- ---------------------------------------------------------------------
-- Bases, viaturas e aparelhos suficientes para abrir um turno e percorrer
-- o aplicativo de ponta a ponta.
--
-- (!) NÃO SÃO DADOS REAIS. Os nomes de base seguem as regiões atendidas
--     pelo SAMU 192 Salvador para que as telas façam sentido, mas os
--     códigos, endereços, coordenadas e placas são inventados. A lista
--     oficial das bases vem da SMS, no OE5.
--
-- (!) NENHUM DADO PESSOAL AQUI. Nenhuma linha de mob_usuario, mob_caso ou
--     mob_caso_atributo. Usuário se cria com `npm run criar-administrador`,
--     que passa pelo Keycloak; caso se cria pelo aplicativo, que é o que
--     este arquivo existe para permitir testar.
--
-- Idempotente: pode rodar quantas vezes for preciso.
-- =====================================================================

USE dbsamu;

-- ── Bases ─────────────────────────────────────────────────────────────
INSERT INTO mob_base (co_base, no_base, sg_base, ds_endereco, vl_latitude, vl_longitude, dt_implantacao, st_ativo)
VALUES
  ('BASE-HOM-01', 'Base Centro',        'CEN', 'Endereco ficticio de homologacao, s/n', -12.9714000, -38.5014000, '2027-03-01', 'A'),
  ('BASE-HOM-02', 'Base Subúrbio',      'SUB', 'Endereco ficticio de homologacao, s/n', -12.8900000, -38.4700000, '2027-03-01', 'A'),
  ('BASE-HOM-03', 'Base Cabula',        'CAB', 'Endereco ficticio de homologacao, s/n', -12.9500000, -38.4400000, '2027-04-01', 'A'),
  ('BASE-HOM-04', 'Central de Regulação','REG', 'Endereco ficticio de homologacao, s/n', -12.9800000, -38.5100000, '2027-03-01', 'A')
ON DUPLICATE KEY UPDATE
  no_base = VALUES(no_base), sg_base = VALUES(sg_base), st_ativo = 'A';

-- ── Viaturas ──────────────────────────────────────────────────────────
-- Uma de cada tipo aceito pelo ck_mob_viatura_tp_viatura, para que as
-- telas de início de turno mostrem as quatro possibilidades.
INSERT INTO mob_viatura (id_base, co_viatura, tp_viatura, st_ativo)
SELECT b.id_base, v.co_viatura, v.tp_viatura, 'A'
  FROM (
    SELECT 'BASE-HOM-01' AS co_base, 'USB-HOM-101' AS co_viatura, 'USB' AS tp_viatura UNION ALL
    SELECT 'BASE-HOM-01', 'USA-HOM-102', 'USA' UNION ALL
    SELECT 'BASE-HOM-02', 'USB-HOM-201', 'USB' UNION ALL
    SELECT 'BASE-HOM-02', 'MOT-HOM-202', 'MOT' UNION ALL
    SELECT 'BASE-HOM-03', 'USB-HOM-301', 'USB' UNION ALL
    SELECT 'BASE-HOM-03', 'EMB-HOM-302', 'EMB'
  ) AS v
  JOIN mob_base b ON b.co_base = v.co_base
ON DUPLICATE KEY UPDATE
  tp_viatura = VALUES(tp_viatura), st_ativo = 'A';

-- ── Aparelhos autorizados ─────────────────────────────────────────────
-- É `co_dispositivo` que a pessoa digita (ou lê do QR) na tela de entrar.
-- Aparelho fora desta lista é recusado ANTES de a senha sair do backend
-- — ver src/modulos/sessao/sessao.service.ts.
INSERT INTO mob_dispositivo (id_base, co_dispositivo, ds_modelo, st_ativo)
SELECT b.id_base, d.co_dispositivo, d.ds_modelo, 'A'
  FROM (
    SELECT 'BASE-HOM-01' AS co_base, 'APAR-HOM-0001' AS co_dispositivo, 'Tablet de homologacao' AS ds_modelo UNION ALL
    SELECT 'BASE-HOM-01', 'APAR-HOM-0002', 'Celular de homologacao' UNION ALL
    SELECT 'BASE-HOM-02', 'APAR-HOM-0003', 'Tablet de homologacao' UNION ALL
    SELECT 'BASE-HOM-03', 'APAR-HOM-0004', 'Tablet de homologacao' UNION ALL
    SELECT 'BASE-HOM-04', 'APAR-HOM-0005', 'Estacao da regulacao'
  ) AS d
  JOIN mob_base b ON b.co_base = d.co_base
ON DUPLICATE KEY UPDATE
  ds_modelo = VALUES(ds_modelo), st_ativo = 'A', st_revogacao = NULL;

-- ── Um aparelho revogado, de propósito ────────────────────────────────
-- A tela de exceção "aparelho não autorizado" (M16) precisa de um caso
-- para exercitar. Sem ele, o caminho de recusa nunca é testado — e é o
-- único que ninguém percebe estar quebrado até o dia em que importa.
INSERT INTO mob_dispositivo (id_base, co_dispositivo, ds_modelo, st_ativo, st_revogacao)
SELECT b.id_base, 'APAR-HOM-9999', 'Aparelho revogado (teste de recusa)', 'I', CURRENT_TIMESTAMP(6)
  FROM mob_base b WHERE b.co_base = 'BASE-HOM-01'
ON DUPLICATE KEY UPDATE
  st_ativo = 'I', st_revogacao = COALESCE(st_revogacao, CURRENT_TIMESTAMP(6));

SELECT
  (SELECT COUNT(*) FROM mob_base)        AS bases,
  (SELECT COUNT(*) FROM mob_viatura)     AS viaturas,
  (SELECT COUNT(*) FROM mob_dispositivo) AS aparelhos;
