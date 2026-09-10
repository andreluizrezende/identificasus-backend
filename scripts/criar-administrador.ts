/**
 * Cria o primeiro usuário do ambiente: no Keycloak, que guarda a credencial, e
 * em `mob_usuario`, que guarda quem a pessoa é. As duas metades, ou nenhuma.
 *
 * Uso:  npm run criar-administrador
 *
 * (!) NENHUM DADO ENTRA POR ARGUMENTO — a senha, principalmente. Argumento de
 *     linha de comando fica no histórico do shell e aparece na lista de
 *     processos para qualquer outro usuário da máquina. É a mesma regra escrita
 *     em fiocruz-backend/scripts/_terminal.js, e ela vale aqui pelo mesmo motivo.
 *
 * (!) FINALIDADE NÃO É CARGO, e é aqui que a distinção costuma se perder.
 *     `purpose` é a finalidade do tratamento de dados (ADR-14, LGPD art. 6º):
 *     diz *para que* aqueles dados podem ser lidos naquela sessão, e o token
 *     carrega uma só. Quem vai testar a captura em campo precisa de
 *     ASSISTENCIAL, mesmo sendo o administrador do ambiente — ADMINISTRACAO não
 *     abre rota de atendimento, de propósito. O cargo mora em `mob_perfil`, que
 *     aceita mais de um.
 */

import 'dotenv/config';
import { createConnection } from 'mysql2/promise';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { perguntar, perguntarOculto } from './_terminal';
import {
  acharPorEmail, ambiente, criarUsuario, definirSenha, tokenAdministrativo,
} from './keycloak-admin';

const FINALIDADES = ['ASSISTENCIAL', 'AUDITORIA', 'PESQUISA', 'ADMINISTRACAO'];
const SENHA_MINIMA = 10; // igual à política do realm

interface LinhaId extends RowDataPacket { id_usuario: number }
interface LinhaPerfil extends RowDataPacket { id_perfil: number; co_perfil: string }

async function principal(): Promise<void> {
  // (!) DATABASE_URL_ADMINISTRACAO, E NAO DATABASE_URL. Cadastrar profissional
  //     e finalidade de administracao, nao de assistencia. Usar a conexao
  //     assistencial aqui exigiria dar INSERT em mob_usuario ao usuario que
  //     atende no campo — e a separacao do ADR-14 teria sido desfeita pela
  //     porta dos fundos, para poupar uma linha de configuracao.
  const url = process.env.DATABASE_URL_ADMINISTRACAO;
  if (!url) {
    throw new Error(
      'DATABASE_URL_ADMINISTRACAO não configurada. Copie .env.example para .env.\n' +
      'Este script não usa DATABASE_URL de propósito: cadastro é finalidade de administração.',
    );
  }

  const env = ambiente();
  if (!env.clientSecret) {
    throw new Error(
      'KEYCLOAK_ADMIN_CLIENT_SECRET vazia. O script não cria credencial fora do Keycloak.',
    );
  }

  console.log('\nIdentificaSUS — criação de usuário');
  console.log(`Keycloak: ${env.base}/realms/${env.realm}`);
  console.log('Nada é gravado antes da confirmação no fim.\n');

  const no_usuario = exigir(await perguntar('Nome completo: '), 'nome');
  const ds_email = exigir(await perguntar('E-mail: '), 'e-mail').toLowerCase();
  const nu_cpf = somenteDigitos(await perguntar('CPF (só números): '));
  if (nu_cpf.length !== 11) throw new Error('O CPF precisa ter 11 dígitos.');

  const finalidade = (
    (await perguntar(`Finalidade [${FINALIDADES.join(' | ')}] (ASSISTENCIAL): `)) || 'ASSISTENCIAL'
  ).toUpperCase();
  if (!FINALIDADES.includes(finalidade)) {
    throw new Error(`Finalidade desconhecida: ${finalidade}`);
  }

  const conexao = await createConnection({ uri: url, dateStrings: true, timezone: 'Z' });
  try {
    const perfis = await conexao
      .query<LinhaPerfil[]>("SELECT id_perfil, co_perfil FROM mob_perfil WHERE st_ativo = 'A'")
      .then(([l]) => l);
    console.log(`\nPerfis disponíveis: ${perfis.map((p) => p.co_perfil).join(', ')}`);

    const escolhidos = (
      (await perguntar('Perfis, separados por vírgula (CAMPO,SUPERVISAO): ')) || 'CAMPO,SUPERVISAO'
    )
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    const desconhecido = escolhidos.find((c) => !perfis.some((p) => p.co_perfil === c));
    if (desconhecido) throw new Error(`Perfil desconhecido: ${desconhecido}`);

    const senha = await perguntarOculto(`\nSenha (mínimo ${SENHA_MINIMA}): `);
    if (senha.length < SENHA_MINIMA) {
      throw new Error(`A senha precisa de pelo menos ${SENHA_MINIMA} caracteres.`);
    }
    if (senha !== (await perguntarOculto('Repita a senha: '))) {
      throw new Error('As senhas não conferem.');
    }

    console.log('\n─── confirme ───────────────────────────────');
    console.log(`Nome:       ${no_usuario}`);
    console.log(`E-mail:     ${ds_email}`);
    console.log(`CPF:        ${nu_cpf}`);
    console.log(`Finalidade: ${finalidade}`);
    console.log(`Perfis:     ${escolhidos.join(', ')}`);
    console.log('────────────────────────────────────────────');
    if ((await perguntar('Gravar? (s/N): ')).toLowerCase() !== 's') {
      console.log('Nada foi gravado.');
      return;
    }

    // ── Keycloak primeiro ───────────────────────────────────────────────────
    // A ordem importa: sem `sub`, a linha em mob_usuario nasceria órfã e sem
    // como entrar. Keycloak que falha deixa o banco intocado; banco que falha
    // deixa uma conta no Keycloak sem cadastro local, que o próprio script
    // reaproveita na próxima execução.
    const token = await tokenAdministrativo(env);
    const existente = await acharPorEmail(env, token, ds_email);
    const sub = existente
      ? existente.id
      : await criarUsuario(env, token, { email: ds_email, nome: no_usuario, finalidade });

    if (existente) {
      console.log(`• Keycloak: conta já existia (${sub}); a senha será redefinida.`);
    } else {
      console.log(`• Keycloak: conta criada (${sub}).`);
    }
    await definirSenha(env, token, sub, senha);
    console.log('• Keycloak: senha definida.');

    // ── depois o cadastro local ─────────────────────────────────────────────
    await conexao.beginTransaction();
    try {
      await conexao.query<ResultSetHeader>(
        `INSERT INTO mob_usuario (nu_cpf, no_usuario, ds_email, co_usuario_idp, ds_cargo, st_ativo)
         VALUES (?, ?, ?, ?, ?, 'A')
         ON DUPLICATE KEY UPDATE
           no_usuario = VALUES(no_usuario),
           ds_email = VALUES(ds_email),
           co_usuario_idp = VALUES(co_usuario_idp),
           st_ativo = 'A'`,
        [nu_cpf, no_usuario, ds_email, sub, 'Administrador do ambiente'],
      );

      const [linhas] = await conexao.query<LinhaId[]>(
        'SELECT id_usuario FROM mob_usuario WHERE nu_cpf = ?',
        [nu_cpf],
      );
      const idUsuario = linhas[0]?.id_usuario;
      if (!idUsuario) throw new Error('mob_usuario gravado mas não encontrado — abortando.');

      for (const co of escolhidos) {
        const perfil = perfis.find((p) => p.co_perfil === co);
        if (!perfil) continue;
        await conexao.query<ResultSetHeader>(
          `INSERT IGNORE INTO mob_usuario_perfil (id_usuario, id_perfil) VALUES (?, ?)`,
          [idUsuario, perfil.id_perfil],
        );
      }

      await conexao.commit();
      console.log(`• dbsamu: mob_usuario #${idUsuario} e ${escolhidos.length} perfil(is).`);
    } catch (erro) {
      await conexao.rollback();
      throw erro;
    }

    console.log('\nPronto. Entre no aplicativo com este e-mail, a senha e o código do aparelho.');
    console.log('Se ainda não há aparelho cadastrado, rode antes: npm run db:homologacao\n');
  } finally {
    await conexao.end();
  }
}

function exigir(valor: string, campo: string): string {
  if (!valor) throw new Error(`O ${campo} é obrigatório.`);
  return valor;
}

function somenteDigitos(v: string): string {
  return v.replace(/\D/g, '');
}

principal()
  .then(() => process.exit(0))
  .catch((erro: unknown) => {
    console.error(`\n✗ ${erro instanceof Error ? erro.message : String(erro)}\n`);
    process.exit(1);
  });
