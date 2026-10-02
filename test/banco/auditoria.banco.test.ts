import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection } from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2/promise';
import { AuditoriaService } from '@/modulos/auditoria/auditoria.service';
import type { BancoPorFinalidade } from '@/acesso/banco-por-finalidade.service';
import { URL_TESTE, acessoDeTeste, conexao, limparCenario, montarCenario } from './apoio';
import type { Cenario } from './apoio';

/**
 * Trilha verificável pelo conteúdo (db/09), contra o banco de verdade.
 *
 * (!) SÓ O BANCO PROVA ISTO. O hash é recalculado a partir da linha como o
 *     banco a devolve: JSON que o MySQL reordena e o MariaDB guarda como texto,
 *     DATETIME(6) com microssegundos. Um dublê devolveria o que o teste
 *     mandou, e a verificação conferiria a si mesma.
 */
let acesso: BancoPorFinalidade;
let cen: Cenario;
let auditoria: AuditoriaService;

beforeAll(async () => {
  cen = await montarCenario('trilha');
  acesso = acessoDeTeste();
  auditoria = new AuditoriaService(acesso);
});

afterAll(async () => {
  await limparCenario(cen);
  await acesso.onModuleDestroy();
});

describe('trilha de auditoria contra o banco', () => {
  it('(!) os elos novos gravam co_elo e conferem pelo conteudo, e a cadeia inteira continua integra', async () => {
    await auditoria.registrar({
      usuarioId: cen.idUsuarioA, finalidade: 'ASSISTENCIAL', acao: 'teste_trilha', recurso: 'teste/1',
      detalhe: { z: 1, a: { lista: [3, 2, 1], texto: 'acentuação' }, vazio: null }, dispositivoId: cen.idDispositivo,
    });
    await auditoria.registrar({
      usuarioId: cen.idUsuarioB, finalidade: 'ADJUDICACAO', acao: 'teste_trilha', recurso: 'teste/2', detalhe: null,
    });

    const c = await conexao();
    try {
      const [ultimos] = await c.query<RowDataPacket[]>(
        "SELECT co_elo FROM mob_auditoria WHERE co_acao = 'teste_trilha' ORDER BY id_auditoria DESC LIMIT 2",
      );
      expect(ultimos.every((l) => typeof l.co_elo === 'string' && l.co_elo.length === 36)).toBe(true);
    } finally {
      await c.end();
    }

    const r = await auditoria.verificarCadeia();
    expect(r).toMatchObject({ integra: true, quebrouEm: null, motivo: null });
    expect(r.peloConteudo).toBeGreaterThanOrEqual(2);
  });

  it('(!) quem e vigiado continua sem ler a trilha: a verificacao roda pela finalidade AUDITORIA', async () => {
    const vigiado = await createConnection({ uri: URL_TESTE });
    try {
      await expect(vigiado.query('SELECT co_elo FROM mob_auditoria LIMIT 1')).rejects.toThrow(/denied/i);
    } finally {
      await vigiado.end();
    }
  });
});
