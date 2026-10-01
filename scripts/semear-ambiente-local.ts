/**
 * Grava, no dbsamu local, um usuário de teste pronto para entrar no
 * aplicativo — sem as perguntas de `criar-administrador.ts`.
 *
 * Uso:  npm run semear-ambiente-local
 *
 * (!) SÓ PARA DESENVOLVIMENTO. A senha está escrita abaixo, em claro, de
 *     propósito: é o que permite a qualquer pessoa da equipe entrar no ambiente
 *     local sem combinar nada. Por isso mesmo o script se recusa a rodar com
 *     NODE_ENV=production — num banco de verdade, esta conta seria uma porta
 *     com a chave pendurada na fechadura.
 *
 * (!) DATABASE_URL_ADMINISTRACAO, E NÃO DATABASE_URL — mesmo motivo do
 *     `criar-administrador.ts`: cadastrar profissional é finalidade de
 *     administração, não de assistência (ADR-14).
 *
 * (!) IDEMPOTENTE. Rodar de novo atualiza a mesma linha (chave é o CPF fixo
 *     do usuário de teste) e redefine a senha, em vez de duplicar ou falhar.
 */
import 'dotenv/config';
import { createConnection } from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2/promise';
import { cifrarSenha } from '../src/acesso/senha';

const USUARIO_DE_TESTE = {
  nu_cpf: '11111111111',
  email: 'andre.teste@identificasus.local',
  senha: 'CampoSamu2027!Ba',
  nome: 'Equipe de teste (local)',
  finalidade: 'ASSISTENCIAL',
  perfis: ['CAMPO', 'SUPERVISAO'],
};

interface LinhaId extends RowDataPacket { id_usuario: number }
interface LinhaPerfil extends RowDataPacket { id_perfil: number; co_perfil: string }

async function principal(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('semear-ambiente-local não roda em produção: a senha do usuário de teste é pública.');
  }
  const url = process.env.DATABASE_URL_ADMINISTRACAO;
  if (!url) {
    throw new Error(
      'DATABASE_URL_ADMINISTRACAO não configurada. Copie .env.example para .env ' +
      '(rode antes db:usuarios, db:recuperacao, db:credencial e db:homologacao).',
    );
  }

  const u = USUARIO_DE_TESTE;
  const hash = await cifrarSenha(u.senha);
  const conexao = await createConnection({ uri: url, dateStrings: true, timezone: 'Z' });
  try {
    await conexao.query(
      `INSERT INTO mob_usuario (nu_cpf, no_usuario, ds_email, ds_senha_hash, co_finalidade, st_ativo)
       VALUES (?, ?, ?, ?, ?, 'A')
       ON DUPLICATE KEY UPDATE
         no_usuario = VALUES(no_usuario), ds_email = VALUES(ds_email),
         ds_senha_hash = VALUES(ds_senha_hash), co_finalidade = VALUES(co_finalidade),
         qt_falhas_login = 0, st_bloqueio_ate = NULL, st_ativo = 'A'`,
      [u.nu_cpf, u.nome, u.email, hash, u.finalidade],
    );

    const [linhas] = await conexao.query<LinhaId[]>(
      'SELECT id_usuario FROM mob_usuario WHERE nu_cpf = ?',
      [u.nu_cpf],
    );
    const idUsuario = linhas[0]?.id_usuario;
    if (!idUsuario) throw new Error('usuario gravado mas nao encontrado — abortando.');

    const [perfis] = await conexao.query<LinhaPerfil[]>(
      `SELECT id_perfil, co_perfil FROM mob_perfil WHERE co_perfil IN (?)`,
      [u.perfis],
    );
    for (const perfil of perfis) {
      await conexao.query(
        'INSERT IGNORE INTO mob_usuario_perfil (id_usuario, id_perfil) VALUES (?, ?)',
        [idUsuario, perfil.id_perfil],
      );
    }

    console.log('Usuário de teste gravado em mob_usuario:');
    console.log(`  id_usuario:  ${idUsuario}`);
    console.log(`  ds_email:    ${u.email}`);
    console.log(`  senha:       ${u.senha}`);
    console.log(`  finalidade:  ${u.finalidade}`);
    console.log(`  perfis:      ${perfis.map((p) => p.co_perfil).join(', ') || '(nenhum encontrado)'}`);
    console.log('\nAparelho e base já vêm de "npm run db:homologacao" (APAR-HOM-0001, Base Centro).');
  } finally {
    await conexao.end();
  }
}

principal().catch((erro: unknown) => {
  console.error(`\n✗ ${erro instanceof Error ? erro.message : String(erro)}\n`);
  process.exit(1);
});
