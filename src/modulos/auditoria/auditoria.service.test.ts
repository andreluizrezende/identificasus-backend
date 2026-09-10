import { describe, expect, it, vi } from 'vitest';
import { ELO_GENESE, calcularElo } from '@/comum/hash-auditoria';
import type { EloAuditoria } from '@/comum/hash-auditoria';
import { AuditoriaService } from './auditoria.service';
import type { BancoPorFinalidade } from '@/acesso/banco-por-finalidade.service';

function bancoComTransacao(executar: ReturnType<typeof vi.fn>, consultar: ReturnType<typeof vi.fn>) {
  return {
    emTransacao: vi.fn(async (_fin: string, corpo: (...args: unknown[]) => unknown) =>
      corpo(executar, consultar)),
    consultar: vi.fn(),
  } as unknown as BancoPorFinalidade;
}

describe('registrar', () => {
  it('encadeia a partir do elo anterior devolvido pela procedure', async () => {
    const executar = vi.fn().mockResolvedValue({});
    const consultar = vi.fn().mockResolvedValue([{ co_hash_atual: 'a'.repeat(64) }]);
    const acesso = bancoComTransacao(executar, consultar);

    const atual = await new AuditoriaService(acesso).registrar({
      usuarioId: 1, finalidade: 'ASSISTENCIAL', acao: 'CASO_CRIADO', recurso: 'mob_caso/1', detalhe: null,
    });

    expect(atual).toHaveLength(64);
    const insert = executar.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO mob_auditoria'));
    expect(insert?.[1][7]).toBe('a'.repeat(64)); // co_hash_anterior gravado é o que veio da procedure
  });

  it('usa ELO_GENESE quando ainda nao ha elo anterior', async () => {
    const executar = vi.fn().mockResolvedValue({});
    const consultar = vi.fn().mockResolvedValue([{ co_hash_atual: null }]);
    const acesso = bancoComTransacao(executar, consultar);

    await new AuditoriaService(acesso).registrar({
      usuarioId: 1, finalidade: 'ASSISTENCIAL', acao: 'CASO_CRIADO', recurso: 'mob_caso/1', detalhe: null,
    });

    const insert = executar.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO mob_auditoria'));
    expect(insert?.[1][7]).toBe(ELO_GENESE);
  });

  it('nao lanca quando a transacao falha: retorna null e nao derruba quem chamou', async () => {
    const acesso = {
      emTransacao: vi.fn().mockRejectedValue(new Error('deadlock')),
    } as unknown as BancoPorFinalidade;

    const r = await new AuditoriaService(acesso).registrar({
      usuarioId: 1, finalidade: 'ASSISTENCIAL', acao: 'X', recurso: 'y', detalhe: null,
    });
    expect(r).toBeNull();
  });

  it('detalhe null nao vira a string "null"', async () => {
    const executar = vi.fn().mockResolvedValue({});
    const consultar = vi.fn().mockResolvedValue([{ co_hash_atual: null }]);
    const acesso = bancoComTransacao(executar, consultar);

    await new AuditoriaService(acesso).registrar({
      usuarioId: 1, finalidade: 'ASSISTENCIAL', acao: 'X', recurso: 'y', detalhe: null,
    });

    const insert = executar.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO mob_auditoria'));
    expect(insert?.[1][6]).toBeNull();
  });
});

describe('verificarCadeia', () => {
  function elo(id: string, extra: Partial<EloAuditoria> = {}): EloAuditoria {
    return {
      id, ocorridoEm: '2027-01-01T00:00:00.000Z', usuarioId: 1,
      finalidade: 'ASSISTENCIAL', acao: 'X', recurso: 'y', detalhe: null, ...extra,
    };
  }

  it('cadeia vazia e integra', async () => {
    const acesso = { consultar: vi.fn().mockResolvedValue([]) } as unknown as BancoPorFinalidade;
    await expect(new AuditoriaService(acesso).verificarCadeia()).resolves.toEqual({
      integra: true, quebrouEm: null, elos: 0,
    });
  });

  it('reconhece uma cadeia integra de varios elos', async () => {
    const e1 = calcularElo(ELO_GENESE, elo('1'));
    const e2 = calcularElo(e1, elo('2'));
    const acesso = {
      consultar: vi.fn().mockResolvedValue([
        { id_auditoria: 1, co_hash_anterior: ELO_GENESE, co_hash_atual: e1 },
        { id_auditoria: 2, co_hash_anterior: e1, co_hash_atual: e2 },
      ]),
    } as unknown as BancoPorFinalidade;

    await expect(new AuditoriaService(acesso).verificarCadeia()).resolves.toEqual({
      integra: true, quebrouEm: null, elos: 2,
    });
  });

  it('aponta onde a cadeia quebra', async () => {
    const e1 = calcularElo(ELO_GENESE, elo('1'));
    const acesso = {
      consultar: vi.fn().mockResolvedValue([
        { id_auditoria: 1, co_hash_anterior: ELO_GENESE, co_hash_atual: e1 },
        { id_auditoria: 2, co_hash_anterior: 'f'.repeat(64), co_hash_atual: 'g'.repeat(64) },
      ]),
    } as unknown as BancoPorFinalidade;

    await expect(new AuditoriaService(acesso).verificarCadeia()).resolves.toEqual({
      integra: false, quebrouEm: 2, elos: 2,
    });
  });

  it('compara os hashes sem diferenciar maiusculas de minusculas', async () => {
    const e1 = calcularElo(ELO_GENESE, elo('1'));
    const acesso = {
      consultar: vi.fn().mockResolvedValue([
        { id_auditoria: 1, co_hash_anterior: ELO_GENESE.toUpperCase(), co_hash_atual: e1.toUpperCase() },
      ]),
    } as unknown as BancoPorFinalidade;

    await expect(new AuditoriaService(acesso).verificarCadeia()).resolves.toEqual({
      integra: true, quebrouEm: null, elos: 1,
    });
  });
});
