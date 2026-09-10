import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import type { Finalidade } from './finalidade';

/**
 * Camada unica de acesso a dados (ADR-14). Nenhum modulo abre conexao propria:
 * a regra `modulo-nao-abre-conexao` no dependency-cruiser trava isso no build.
 *
 * Cada finalidade usa um usuario de banco distinto, com grants proprios. Como o
 * MySQL nao tem row-level security, a filtragem por linha continua sendo
 * responsabilidade da aplicacao — e por isso o teste de autorizacao por rota e
 * bloqueante em CI.
 */
@Injectable()
export class PrismaPorFinalidade implements OnModuleDestroy {
  private readonly log = new Logger('acesso');
  private readonly pools = new Map<Finalidade, PrismaClient>();

  constructor(private readonly config: ConfigService) {}

  para(finalidade: Finalidade): PrismaClient {
    const existente = this.pools.get(finalidade);
    if (existente) return existente;

    const url = this.urlDe(finalidade);
    const cliente = new PrismaClient({ datasources: { db: { url } } });
    this.pools.set(finalidade, cliente);
    this.log.log(`pool aberto para a finalidade ${finalidade}`);
    return cliente;
  }

  private urlDe(finalidade: Finalidade): string {
    const chave =
      finalidade === 'AUDITORIA' ? 'DATABASE_URL_AUDITORIA'
      : finalidade === 'PESQUISA' ? 'DATABASE_URL_PESQUISA'
      : 'DATABASE_URL';
    const url = this.config.get<string>(chave);
    if (!url) throw new Error(`Variavel ${chave} nao configurada.`);
    return url;
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.pools.values()].map((c) => c.$disconnect()));
  }
}
