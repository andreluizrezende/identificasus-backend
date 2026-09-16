/**
 * Grava, no dbsamu local, a metade de `mob_usuario` que corresponde ao
 * usuário de teste do `keycloak-fake.ts` — sem passar pela API administrativa
 * de um Keycloak de verdade, que este ambiente não tem.
 *
 * Uso:  npm run semear-ambiente-local
 *
 * (!) SÓ FAZ SENTIDO COM `keycloak-fake.ts` NO AR. As duas metades de uma
 *     conta (credencial no IdP, cadastro em `mob_usuario`) normalmente nascem
 *     juntas em `scripts/criar-administrador.ts`, que fala com a API
 *     administrativa do Keycloak (ver ADR-09). Sem Keycloak disponível aqui, a
 *     metade "credencial" já está semeada dentro do processo do fake — este
 *     script só grava a outra metade, com o MESMO `sub`, para que
 *     `SessaoService.usuarioDo` encontre a linha depois do login.
 *
 * (!) DATABASE_URL_ADMINISTRACAO, E NÃO DATABASE_URL — mesmo motivo do
 *     `criar-administrador.ts`: cadastrar profissional é finalidade de
 *     administração, não de assistência (ADR-14).
 *
 * (!) IDEMPOTENTE. Rodar de novo atualiza a mesma linha (chave é o CPF fixo
 *     do usuário de teste), em vez de duplicar ou falhar.
 */
import 'dotenv/config';
import { createConnection } from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2/promise';
import { USUARIO_DE_TESTE } from './dev-fixture';

const NU_CPF_DE_TESTE = '11111111111';
const PERFIS_DE_TESTE = ['CAMPO', 'SUPERVISAO'];

interface LinhaId extends RowDataPacket { id_usuario: number }
interface LinhaPerfil extends RowDataPacket { id_perfil: number; co_perfil: string }

async function principal(): Promise<void> {
  const url = process.env.DATABASE_URL_ADMINISTRACAO;
  if (!url) {
    throw new Error(
      'DATABASE_URL_ADMINISTRACAO não configurada. Copie .env.example para .env ' +
      '(rode antes db:usuarios, db:recuperacao e db:homologacao).',
    );
  }

  const conexao = await createConnection({ uri: url, dateStrings: true, timezone: 'Z' });
  try {
    await conexao.query(
      `INSERT INTO mob_usuario (nu_cpf, no_usuario, ds_email, co_usuario_idp, st_ativo)
       VALUES (?, ?, ?, ?, 'A')
       ON DUPLICATE KEY UPDATE
         no_usuario = VALUES(no_usuario), ds_email = VALUES(ds_email),
         co_usuario_idp = VALUES(co_usuario_idp), st_ativo = 'A'`,
      [NU_CPF_DE_TESTE, USUARIO_DE_TESTE.nome, USUARIO_DE_TESTE.email, USUARIO_DE_TESTE.sub],
    );

    const [linhas] = await conexao.query<LinhaId[]>(
      'SELECT id_usuario FROM mob_usuario WHERE nu_cpf = ?',
      [NU_CPF_DE_TESTE],
    );
    const idUsuario = linhas[0]?.id_usuario;
    if (!idUsuario) throw new Error('usuario gravado mas nao encontrado — abortando.');

    const [perfis] = await conexao.query<LinhaPerfil[]>(
      `SELECT id_perfil, co_perfil FROM mob_perfil WHERE co_perfil IN (?)`,
      [PERFIS_DE_TESTE],
    );
    for (const perfil of perfis) {
      await conexao.query(
        'INSERT IGNORE INTO mob_usuario_perfil (id_usuario, id_perfil) VALUES (?, ?)',
        [idUsuario, perfil.id_perfil],
      );
    }

    console.log('Usuário de teste gravado em mob_usuario:');
    console.log(`  id_usuario:     ${idUsuario}`);
    console.log(`  nu_cpf:         ${NU_CPF_DE_TESTE}`);
    console.log(`  ds_email:       ${USUARIO_DE_TESTE.email}`);
    console.log(`  co_usuario_idp: ${USUARIO_DE_TESTE.sub}`);
    console.log(`  perfis:         ${perfis.map((p) => p.co_perfil).join(', ') || '(nenhum encontrado)'}`);
    console.log('\nAparelho e base já vêm de "npm run db:homologacao" (APAR-HOM-0001, Base Centro).');
  } finally {
    await conexao.end();
  }
}

void principal();
