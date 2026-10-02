/**
 * Carrega o cadastro oficial da SMS (bases, viaturas, aparelhos) no dbsamu.
 *
 * Uso:
 *   node --import tsx scripts/importar-cadastro-sms.ts <pasta>                 # so mostra o plano
 *   node --import tsx scripts/importar-cadastro-sms.ts <pasta> --aplicar       # grava, depois de confirmar
 *   ... --aplicar --aposentar-homologacao                                      # e desativa os *-HOM-*
 *
 * Producao: scripts/importar-cadastro-sms-producao.ps1, que pede a senha do
 * banco. A pasta tem bases.csv, viaturas.csv e aparelhos.csv (modelo em
 * cadastro-sms/modelo; regras em scripts/cadastro-sms.ts).
 *
 * (!) SEM --aplicar NADA E GRAVADO. O padrao e mostrar o plano: o que entra,
 *     o que muda, o que fica igual. Gravar exige a opcao e um "s" no terminal.
 *
 * (!) TUDO OU NADA. Um erro na planilha ou no plano barra a carga inteira, e
 *     a gravacao e uma transacao so.
 *
 * (!) APOSENTAR NAO APAGA. Os *-HOM-* ficam com st_ativo = 'I' (e os
 *     aparelhos com st_revogacao): a trilha e os casos de teste referenciam
 *     base e aparelho. Aposentar tambem tranca as contas de teste, que entram
 *     por APAR-HOM-0001 e APAR-HOM-0005; por isso e opcao a parte.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createConnection } from 'mysql2/promise';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { perguntar } from './_terminal';
import { lerCadastro, planejar } from './cadastro-sms';
import type { Cadastro, NoBanco, Plano } from './cadastro-sms';

interface LinhaBase extends RowDataPacket {
  co_base: string; no_base: string; sg_base: string | null; ds_endereco: string | null;
  vl_latitude: string | null; vl_longitude: string | null; dt_implantacao: string | null; st_ativo: string;
}
interface LinhaViatura extends RowDataPacket { co_viatura: string; co_base: string; tp_viatura: string; st_ativo: string }
interface LinhaAparelho extends RowDataPacket {
  co_dispositivo: string; co_base: string; ds_modelo: string | null; st_ativo: string; st_revogacao: string | null;
}

const numero = (v: string | null): number | null => (v === null ? null : Number(v));

async function lerBanco(c: Connection): Promise<NoBanco> {
  const [bases] = await c.query<LinhaBase[]>(
    `SELECT co_base, no_base, sg_base, ds_endereco, vl_latitude, vl_longitude,
            DATE_FORMAT(dt_implantacao, '%Y-%m-%d') AS dt_implantacao, st_ativo
       FROM mob_base`,
  );
  const [viaturas] = await c.query<LinhaViatura[]>(
    `SELECT v.co_viatura, b.co_base, v.tp_viatura, v.st_ativo
       FROM mob_viatura v JOIN mob_base b ON b.id_base = v.id_base`,
  );
  const [aparelhos] = await c.query<LinhaAparelho[]>(
    `SELECT d.co_dispositivo, b.co_base, d.ds_modelo, d.st_ativo,
            DATE_FORMAT(d.st_revogacao, '%Y-%m-%d %H:%i') AS st_revogacao
       FROM mob_dispositivo d JOIN mob_base b ON b.id_base = d.id_base`,
  );
  return {
    bases: new Map(bases.map((b) => [b.co_base, {
      nome: b.no_base, sigla: b.sg_base, endereco: b.ds_endereco, latitude: numero(b.vl_latitude),
      longitude: numero(b.vl_longitude), implantacao: b.dt_implantacao, ativo: b.st_ativo === 'A',
    }])),
    viaturas: new Map(viaturas.map((v) => [v.co_viatura, { base: v.co_base, tipo: v.tp_viatura, ativo: v.st_ativo === 'A' }])),
    aparelhos: new Map(aparelhos.map((a) => [a.co_dispositivo, {
      base: a.co_base, modelo: a.ds_modelo, ativo: a.st_ativo === 'A', revogadoEm: a.st_revogacao,
    }])),
  };
}

function mostrar(plano: Plano, aposentar: boolean): void {
  const lista = (rotulo: string, itens: string[]) => {
    console.log(`  ${rotulo}: ${itens.length}${itens.length > 0 ? ` (${itens.join(', ')})` : ''}`);
  };
  console.log('\nBases');
  lista('novas', plano.bases.novas); lista('alteradas', plano.bases.alteradas); lista('iguais', plano.bases.iguais);
  console.log('Viaturas');
  lista('novas', plano.viaturas.novas); lista('alteradas', plano.viaturas.alteradas); lista('iguais', plano.viaturas.iguais);
  console.log('Aparelhos');
  lista('novos', plano.aparelhos.novos); lista('alterados', plano.aparelhos.alterados); lista('iguais', plano.aparelhos.iguais);
  if (plano.aparelhos.mudamDeBase.length > 0) lista('(!) mudam de base', plano.aparelhos.mudamDeBase);
  const hom = plano.homologacao;
  const totalHom = hom.bases.length + hom.viaturas.length + hom.aparelhos.length;
  if (aposentar) {
    console.log('Homologacao a aposentar (st_ativo = I; aparelhos revogados)');
    lista('bases', hom.bases); lista('viaturas', hom.viaturas); lista('aparelhos', hom.aparelhos);
    console.log('  (!) As contas de teste deixam de entrar: elas usam APAR-HOM-0001 e APAR-HOM-0005.');
  } else if (totalHom > 0) {
    console.log(`Homologacao: ${totalHom} cadastro(s) *-HOM-* continuam ativos (use --aposentar-homologacao para desativar).`);
  }
}

async function gravar(c: Connection, cad: Cadastro, aposentar: boolean): Promise<void> {
  await c.beginTransaction();
  try {
    for (const b of cad.bases) {
      await c.query(
        `INSERT INTO mob_base (co_base, no_base, sg_base, ds_endereco, vl_latitude, vl_longitude, dt_implantacao, st_ativo)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'A')
         ON DUPLICATE KEY UPDATE no_base = VALUES(no_base), sg_base = VALUES(sg_base),
           ds_endereco = VALUES(ds_endereco), vl_latitude = VALUES(vl_latitude),
           vl_longitude = VALUES(vl_longitude), dt_implantacao = VALUES(dt_implantacao), st_ativo = 'A'`,
        [b.codigo, b.nome, b.sigla, b.endereco, b.latitude, b.longitude, b.implantacao],
      );
    }
    // (!) id_base buscado antes, e INSERT ... VALUES: num INSERT ... SELECT
    //     FROM mob_base, o id_base do ON DUPLICATE KEY UPDATE fica ambiguo
    //     (as duas tabelas tem a coluna) e o MySQL recusa.
    const idDaBase = async (co: string): Promise<number> => {
      const [linhas] = await c.query<(RowDataPacket & { id_base: number })[]>(
        'SELECT id_base FROM mob_base WHERE co_base = ?', [co],
      );
      const id = linhas[0]?.id_base;
      if (id === undefined) throw new Error(`base ${co} nao encontrada na gravacao`);
      return id;
    };
    for (const v of cad.viaturas) {
      await c.query(
        `INSERT INTO mob_viatura (id_base, co_viatura, tp_viatura, st_ativo)
         VALUES (?, ?, ?, 'A')
         ON DUPLICATE KEY UPDATE id_base = VALUES(id_base), tp_viatura = VALUES(tp_viatura), st_ativo = 'A'`,
        [await idDaBase(v.base), v.codigo, v.tipo],
      );
    }
    for (const a of cad.aparelhos) {
      // (!) `st_revogacao IS NULL` tambem aqui, alem do plano: entre ler e
      //     gravar, alguem pode ter revogado o aparelho.
      await c.query(
        `INSERT INTO mob_dispositivo (id_base, co_dispositivo, ds_modelo, st_ativo)
         VALUES (?, ?, ?, 'A')
         ON DUPLICATE KEY UPDATE
           id_base   = IF(st_revogacao IS NULL, VALUES(id_base), id_base),
           ds_modelo = IF(st_revogacao IS NULL, VALUES(ds_modelo), ds_modelo),
           st_ativo  = IF(st_revogacao IS NULL, 'A', st_ativo)`,
        [await idDaBase(a.base), a.codigo, a.modelo],
      );
    }
    if (aposentar) {
      await c.query(
        `UPDATE mob_dispositivo SET st_ativo = 'I', st_revogacao = COALESCE(st_revogacao, CURRENT_TIMESTAMP(6))
          WHERE co_dispositivo LIKE '%-HOM-%'`,
      );
      await c.query(`UPDATE mob_viatura SET st_ativo = 'I' WHERE co_viatura LIKE '%-HOM-%'`);
      await c.query(`UPDATE mob_base SET st_ativo = 'I' WHERE co_base LIKE '%-HOM-%'`);
    }
    await c.commit();
  } catch (erro) {
    await c.rollback();
    throw erro;
  }
}

async function principal(): Promise<void> {
  const args = process.argv.slice(2);
  const pasta = args.find((a) => !a.startsWith('--'));
  const aplicar = args.includes('--aplicar');
  const aposentar = args.includes('--aposentar-homologacao');
  if (!pasta) throw new Error('Informe a pasta com bases.csv, viaturas.csv e aparelhos.csv.');
  if (aposentar && !aplicar) throw new Error('--aposentar-homologacao so vale junto com --aplicar.');

  const ler = (nome: string) => {
    try { return readFileSync(join(pasta, nome), 'utf8'); } catch { throw new Error(`Nao achei ${join(pasta, nome)}.`); }
  };
  const leitura = lerCadastro({ bases: ler('bases.csv'), viaturas: ler('viaturas.csv'), aparelhos: ler('aparelhos.csv') });
  const { cadastro } = leitura;
  console.log(`Planilha: ${cadastro.bases.length} base(s), ${cadastro.viaturas.length} viatura(s), ${cadastro.aparelhos.length} aparelho(s).`);
  if (leitura.erros.length > 0) {
    console.log('\nA planilha tem erros. Nada foi gravado.');
    for (const e of leitura.erros) console.log(`  - ${e}`);
    process.exitCode = 1;
    return;
  }

  const url = process.env.DATABASE_URL_ADMINISTRACAO;
  if (!url) throw new Error('DATABASE_URL_ADMINISTRACAO nao configurada.');
  const conexao = await createConnection({ uri: url });
  try {
    const plano = planejar(cadastro, await lerBanco(conexao));
    mostrar(plano, aposentar);
    if (plano.erros.length > 0) {
      console.log('\nO plano tem erros. Nada foi gravado.');
      for (const e of plano.erros) console.log(`  - ${e}`);
      process.exitCode = 1;
      return;
    }
    if (!aplicar) {
      console.log('\nSo o plano: nada foi gravado. Para gravar, rode de novo com --aplicar.');
      return;
    }
    if ((await perguntar('\nGravar este plano? (s/N): ')).toLowerCase() !== 's') {
      console.log('Nada foi gravado.');
      return;
    }
    await gravar(conexao, cadastro, aposentar);
    console.log('Cadastro gravado.');
  } finally {
    await conexao.end();
  }
}

principal().catch((erro: unknown) => {
  console.error(`\nErro: ${erro instanceof Error ? erro.message : String(erro)}\n`);
  process.exit(1);
});
