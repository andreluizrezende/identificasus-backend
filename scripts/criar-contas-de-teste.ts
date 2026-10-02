/**
 * Cria as duas contas de teste de um ambiente — uma de campo (ASSISTENCIAL) e
 * uma da regulação (ADJUDICACAO) — com nome, e-mail e CPF gerados na hora.
 *
 * Uso (produção): scripts/criar-contas-de-teste-producao.ps1, que pede a senha
 * do banco. Local: DATABASE_URL_ADMINISTRACAO do .env.
 *
 * (!) A SENHA DE CADA CONTA SÓ QUEM RODA DIGITA. O script gera a identidade,
 *     mas pergunta a senha escondida no terminal, duas vezes, e aplica a mesma
 *     política do sistema (motivoDaRecusa). Ela não vai para arquivo, variável
 *     de ambiente nem log; só o hash vai para o banco.
 *
 * (!) IDENTIDADE FICTÍCIA, E DECLARADA COMO TAL. Nome "Teste ...", e-mail no
 *     domínio teste.identificasus.local (não recebe e-mail: "perdi minha senha"
 *     não funciona para estas contas) e CPF na faixa de teste usada pelos
 *     testes de banco. Ninguém confunde estas contas com uma pessoa.
 */
import 'dotenv/config';
import { randomInt } from 'node:crypto';
import { createConnection } from 'mysql2/promise';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { perguntar, perguntarOculto } from './_terminal';
import { SENHA_MINIMA, cifrarSenha, motivoDaRecusa } from '../src/acesso/senha';

interface Conta {
  rotulo: string;
  finalidade: 'ASSISTENCIAL' | 'ADJUDICACAO';
  perfis: string[];
  cargo: string;
  aparelho: string;
}

const CONTAS: Conta[] = [
  { rotulo: 'Campo', finalidade: 'ASSISTENCIAL', perfis: ['CAMPO', 'SUPERVISAO'], cargo: 'Conta de teste (campo)', aparelho: 'APAR-HOM-0001' },
  { rotulo: 'Regulação', finalidade: 'ADJUDICACAO', perfis: ['REGULACAO'], cargo: 'Conta de teste (regulação)', aparelho: 'APAR-HOM-0005' },
];

const ALFABETO = 'abcdefghjkmnpqrstuvwxyz23456789';
const sufixo = (n: number) => Array.from({ length: n }, () => ALFABETO[randomInt(ALFABETO.length)]).join('');

/** CPF na faixa de teste (000...), que os testes de banco também usam. */
const cpfDeTeste = () => `000${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;

interface LinhaId extends RowDataPacket { id_usuario: number }
interface LinhaPerfil extends RowDataPacket { id_perfil: number; co_perfil: string }

async function cpfLivre(c: Connection): Promise<string> {
  for (let i = 0; i < 20; i += 1) {
    const cpf = cpfDeTeste();
    const [r] = await c.query<LinhaId[]>('SELECT id_usuario FROM mob_usuario WHERE nu_cpf = ?', [cpf]);
    if (r.length === 0) return cpf;
  }
  throw new Error('não achei um CPF de teste livre em 20 tentativas.');
}

async function principal(): Promise<void> {
  const url = process.env.DATABASE_URL_ADMINISTRACAO;
  if (!url) throw new Error('DATABASE_URL_ADMINISTRACAO não configurada.');

  const conexao = await createConnection({ uri: url });
  try {
    const marca = sufixo(4);
    const planejadas = [];
    for (const conta of CONTAS) {
      const slug = conta.finalidade === 'ASSISTENCIAL' ? 'campo' : 'regulacao';
      const ds_email = `${slug}.${marca}@teste.identificasus.local`;
      const no_usuario = `Teste ${conta.rotulo} ${marca.toUpperCase()}`;
      const nu_cpf = await cpfLivre(conexao);

      console.log(`\n── Conta ${conta.rotulo} (${conta.finalidade}) ── ${ds_email}`);
      const senha = await perguntarOculto(`Senha (mínimo ${SENHA_MINIMA}): `);
      const recusa = motivoDaRecusa(senha, ds_email);
      if (recusa) throw new Error(recusa);
      if (senha !== (await perguntarOculto('Repita a senha: '))) throw new Error('As senhas não conferem.');
      planejadas.push({ conta, ds_email, no_usuario, nu_cpf, hash: await cifrarSenha(senha) });
    }

    console.log('\n─── confirme ───────────────────────────────');
    for (const p of planejadas) {
      console.log(`${p.no_usuario} | ${p.ds_email} | ${p.conta.finalidade} | perfis ${p.conta.perfis.join(',')}`);
    }
    console.log('────────────────────────────────────────────');
    if ((await perguntar('Gravar as duas contas? (s/N): ')).toLowerCase() !== 's') {
      console.log('Nada foi gravado.');
      return;
    }

    await conexao.beginTransaction();
    try {
      for (const p of planejadas) {
        await conexao.query(
          `INSERT INTO mob_usuario (nu_cpf, no_usuario, ds_email, ds_senha_hash, co_finalidade, ds_cargo, st_ativo)
           VALUES (?, ?, ?, ?, ?, ?, 'A')`,
          [p.nu_cpf, p.no_usuario, p.ds_email, p.hash, p.conta.finalidade, p.conta.cargo],
        );
        const [ids] = await conexao.query<LinhaId[]>('SELECT id_usuario FROM mob_usuario WHERE nu_cpf = ?', [p.nu_cpf]);
        const id = ids[0]?.id_usuario;
        if (!id) throw new Error('conta gravada mas não encontrada — desfazendo.');
        const [perfis] = await conexao.query<LinhaPerfil[]>(
          'SELECT id_perfil, co_perfil FROM mob_perfil WHERE co_perfil IN (?)', [p.conta.perfis],
        );
        for (const perfil of perfis) {
          await conexao.query('INSERT INTO mob_usuario_perfil (id_usuario, id_perfil) VALUES (?, ?)', [id, perfil.id_perfil]);
        }
      }
      await conexao.commit();
    } catch (erro) {
      await conexao.rollback();
      throw erro;
    }

    console.log('\nContas criadas. Para entrar:');
    for (const p of planejadas) {
      const onde = p.conta.finalidade === 'ASSISTENCIAL' ? 'app de campo (tablet)' : 'console da regulação';
      console.log(`  ${onde}: ${p.ds_email} — código ${p.conta.aparelho} — a senha que você digitou`);
    }
  } finally {
    await conexao.end();
  }
}

principal().catch((erro: unknown) => {
  console.error(`\n✗ ${erro instanceof Error ? erro.message : String(erro)}\n`);
  process.exit(1);
});
