import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ESTADOS_DA_FILA, RegulacaoService } from './regulacao.service';
import type { BancoPorFinalidade } from '@/acesso/banco-por-finalidade.service';
import type { AuditoriaService } from '@/modulos/auditoria/auditoria.service';

const CASO = { id_caso: 42, co_caso: 'NN-2026-ABCDEFGH', st_caso: 'ANALISE' };
const DECISAO = { decisao: 'NAO_RESOLVIDO' as const, motivo: 'Buscas esgotadas sem candidato.' };

function montar(caso: unknown[], afetadas = 1) {
  const executar = vi.fn(async (sql: string, _params?: unknown[]) => (sql.startsWith('UPDATE') ? { affectedRows: afetadas } : {}));
  const consultar = vi.fn().mockResolvedValue(caso);
  const emTransacao = vi.fn(async (_f: string, fn: (e: typeof executar, c: typeof consultar) => unknown) => fn(executar, consultar));
  const acesso = { emTransacao } as unknown as BancoPorFinalidade;
  const registrar = vi.fn().mockResolvedValue('hash');
  const auditoria = { registrar } as unknown as AuditoriaService;
  return { servico: new RegulacaoService(acesso, auditoria), executar, emTransacao, registrar };
}

describe('decisão do caso pela regulação', () => {
  it('muda o estado pelo pool de ADJUDICACAO, só se o caso ainda estiver na fila', async () => {
    const { servico, executar, emTransacao } = montar([CASO]);
    expect(await servico.decidir('NN-2026-ABCDEFGH', 9, DECISAO)).toEqual({ coCaso: 'NN-2026-ABCDEFGH', stCaso: 'NAO_RESOLVIDO' });

    expect(emTransacao.mock.calls[0]?.[0]).toBe('ADJUDICACAO');
    const update = executar.mock.calls.find(([sql]) => String(sql).startsWith('UPDATE'));
    expect(update?.[0]).toMatch(/WHERE id_caso = \? AND st_caso IN \(\?, \?\)/);
    expect(update?.[1]).toEqual(['NAO_RESOLVIDO', 42, ...ESTADOS_DA_FILA]);
  });

  it('(!) autor e motivo vão ao gatilho do histórico, e voltam a nulo depois', async () => {
    const { servico, executar } = montar([CASO]);
    await servico.decidir('NN-2026-ABCDEFGH', 9, DECISAO);
    const sets = executar.mock.calls.filter(([sql]) => String(sql).startsWith('SET'));
    expect(sets[0]).toEqual(['SET @mob_transicao_usuario = ?, @mob_transicao_motivo = ?', [9, DECISAO.motivo]]);
    expect(sets[1]?.[0]).toBe('SET @mob_transicao_usuario = NULL, @mob_transicao_motivo = NULL');
  });

  it('(!) a trilha registra quem decidiu o quê, sem o texto do motivo', async () => {
    const { servico, registrar } = montar([CASO]);
    await servico.decidir('NN-2026-ABCDEFGH', 9, { decisao: 'PERICIA', motivo: 'Tatuagem rara, encaminhar ao IML.' });
    expect(registrar).toHaveBeenCalledWith(expect.objectContaining({
      usuarioId: 9, finalidade: 'ADJUDICACAO', acao: 'regulacao_caso_decidido', casoId: 42,
      detalhe: { de: 'ANALISE', para: 'PERICIA' },
    }));
    expect(JSON.stringify(registrar.mock.calls)).not.toMatch(/Tatuagem/);
  });

  it.each([[[]], [[{ ...CASO, st_caso: 'ABERTO' }]], [[{ ...CASO, st_caso: 'NAO_RESOLVIDO' }]]])(
    'caso inexistente, em campo ou já decidido: "não está na fila", sem mexer em nada',
    async (linhas) => {
      const { servico, executar, registrar } = montar(linhas);
      await expect(servico.decidir('NN-2026-ABCDEFGH', 9, DECISAO)).rejects.toBeInstanceOf(NotFoundException);
      expect(executar).not.toHaveBeenCalled();
      expect(registrar).not.toHaveBeenCalled();
    },
  );

  it('(!) duas estações ao mesmo tempo: a segunda recebe conflito, e as variáveis voltam a nulo', async () => {
    const { servico, executar, registrar } = montar([CASO], 0);
    await expect(servico.decidir('NN-2026-ABCDEFGH', 9, DECISAO)).rejects.toBeInstanceOf(ConflictException);
    expect(executar.mock.calls.at(-1)?.[0]).toBe('SET @mob_transicao_usuario = NULL, @mob_transicao_motivo = NULL');
    expect(registrar).not.toHaveBeenCalled();
  });
});
