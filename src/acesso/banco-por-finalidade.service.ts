import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPool } from 'mysql2/promise';
import type { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import type { Finalidade } from './finalidade';

/** Valores aceitos como parametro posicional pelo driver. */
export type Parametros = Array<string | number | boolean | Date | null>;

/**
 * Camada unica de acesso a dados (ADR-14). Nenhum modulo abre conexao propria:
 * a regra `modulo-nao-abre-conexao` no dependency-cruiser trava isso no build.
 *
 * Cada finalidade usa um usuario de banco distinto, com grants proprios. Como o
 * MySQL nao tem row-level security, a filtragem por linha continua sendo
 * responsabilidade da aplicacao — e por isso o teste de autorizacao por rota e
 * bloqueante em CI.
 *
 * (!) mysql2 E NAO PRISMA. O Prisma saiu depois de uma constatacao simples:
 *     todas as consultas deste servico sao SQL cru — cadeia de hash da
 *     auditoria, chaves de blocking, CALL de procedure, views por finalidade.
 *     Nenhuma usava o construtor de consultas. Prisma virava um binario de
 *     engine baixado por ambiente para servir de cano de SQL, e o esquema ja
 *     tem uma fonte da verdade: os arquivos em db/. Ver o README.
 */
@Injectable()
export class BancoPorFinalidade implements OnModuleDestroy {
  private readonly log = new Logger('acesso');
  private readonly pools = new Map<Finalidade, Pool>();

  constructor(private readonly config: ConfigService) {}

  para(finalidade: Finalidade): Pool {
    const existente = this.pools.get(finalidade);
    if (existente) return existente;

    const pool = createPool({
      uri: this.urlDe(finalidade),
      waitForConnections: true,
      connectionLimit: Number(process.env.BANCO_CONEXOES ?? 10),
      // Datas voltam como string: converter para Date aqui esconderia o fuso
      // do servidor num lugar onde ninguem procura.
      dateStrings: true,
      timezone: 'Z',
      namedPlaceholders: false,
    });
    this.pools.set(finalidade, pool);
    this.log.log(`pool aberto para a finalidade ${finalidade}`);
    return pool;
  }

  /** Consulta que devolve linhas. */
  async consultar<T extends RowDataPacket>(
    finalidade: Finalidade,
    sql: string,
    parametros: Parametros = [],
  ): Promise<T[]> {
    const [linhas] = await this.para(finalidade).query<T[]>(sql, parametros);
    return linhas;
  }

  /** Escrita; devolve quantas linhas foram afetadas. */
  async executar(
    finalidade: Finalidade,
    sql: string,
    parametros: Parametros = [],
  ): Promise<ResultSetHeader> {
    const [r] = await this.para(finalidade).query<ResultSetHeader>(sql, parametros);
    return r;
  }

  /**
   * Transacao numa conexao so. Necessaria onde a ordem das escritas e a
   * garantia — o elo da auditoria e a troca de senha, por exemplo.
   */
  async emTransacao<T>(
    finalidade: Finalidade,
    corpo: (executar: (sql: string, p?: Parametros) => Promise<ResultSetHeader>,
            consultar: <R extends RowDataPacket>(sql: string, p?: Parametros) => Promise<R[]>) => Promise<T>,
  ): Promise<T> {
    const conexao = await this.para(finalidade).getConnection();
    try {
      await conexao.beginTransaction();
      const resultado = await corpo(
        async (sql, p = []) => {
          const [r] = await conexao.query<ResultSetHeader>(sql, p);
          return r;
        },
        async <R extends RowDataPacket>(sql: string, p: Parametros = []) => {
          const [linhas] = await conexao.query<R[]>(sql, p);
          return linhas;
        },
      );
      await conexao.commit();
      return resultado;
    } catch (erro) {
      await conexao.rollback();
      throw erro;
    } finally {
      conexao.release();
    }
  }

  private urlDe(finalidade: Finalidade): string {
    // (!) CADA FINALIDADE TEM A SUA VARIAVEL, E NENHUMA CAI NA DE OUTRA. Antes
    //     daqui, ADMINISTRACAO caia no `else` e usava a conexao assistencial —
    //     um `switch` incompleto desfazendo em silencio a separacao que o resto
    //     do ADR-14 constroi. Finalidade sem URL configurada agora falha alto.
    const chave =
      finalidade === 'AUDITORIA' ? 'DATABASE_URL_AUDITORIA'
      : finalidade === 'PESQUISA' ? 'DATABASE_URL_PESQUISA'
      : finalidade === 'ADMINISTRACAO' ? 'DATABASE_URL_ADMINISTRACAO'
      : 'DATABASE_URL';
    const url = this.config.get<string>(chave) ?? process.env[chave];
    if (!url) throw new Error(`Variavel ${chave} nao configurada.`);
    return url;
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.pools.values()].map((p) => p.end()));
  }
}
