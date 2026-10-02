import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { CasoService } from './caso.service';
import type { BancoPorFinalidade } from '@/acesso/banco-por-finalidade.service';

const RESUMO = {
  id_caso: 1, co_caso: 'C1', st_caso: 'ABERTO', dt_ocorrencia: '2027-01-01', hr_ocorrencia: '10:00:00',
  ds_local: null, qt_completude: 50, dt_prazo: null, st_envio: null,
};

function bancoConsultar(...respostas: unknown[]) {
  const consultar = vi.fn();
  for (const r of respostas) consultar.mockResolvedValueOnce(r);
  return consultar;
}

describe('porCodigo', () => {
  it('lanca NotFoundException tanto para caso inexistente quanto para caso de outra pessoa', async () => {
    const acesso = { consultar: bancoConsultar([]) } as unknown as BancoPorFinalidade;
    await expect(new CasoService(acesso).porCodigo('C1', 1)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('junta atributos e historico no detalhe', async () => {
    const consultar = bancoConsultar(
      [{ ...RESUMO, co_ocorrencia_samu: null, ds_destino: null, no_base: 'Base 1' }],
      [{ co_atributo: 'A', no_atributo: 'Atributo', co_grupo: 'G', ds_valor: 'v', vl_numerico: null, dt_valor: null, no_termo: null, co_procedencia: 'OBSERVADO', st_captura: '2027-01-01', no_usuario: 'Ana' }],
      [{ st_anterior: null, st_atual: 'ABERTO', ds_motivo: null, st_transicao: '2027-01-01', no_usuario: 'Ana' }],
    );
    const acesso = { consultar } as unknown as BancoPorFinalidade;
    const detalhe = await new CasoService(acesso).porCodigo('C1', 1);
    expect(detalhe.noBase).toBe('Base 1');
    expect(detalhe.atributos).toHaveLength(1);
    expect(detalhe.historico).toHaveLength(1);
  });
});

describe('abrir', () => {
  it('e idempotente: caso ja existente devolve o mesmo id sem inserir de novo', async () => {
    const executar = vi.fn();
    const consultar = vi.fn().mockResolvedValue([{ id_caso: 42 }]);
    const acesso = {
      emTransacao: vi.fn(async (_f: string, corpo: (...a: unknown[]) => unknown) => corpo(executar, consultar)),
    } as unknown as BancoPorFinalidade;

    const id = await new CasoService(acesso).abrir(
      { coCaso: 'C1', idBase: 1, dtOcorrencia: '2027-01-01', hrOcorrencia: '10:00:00' },
      7,
    );
    expect(id).toBe(42);
    expect(executar).not.toHaveBeenCalled();
  });

  it('insere caso novo e o primeiro registro de estado', async () => {
    const executar = vi.fn().mockResolvedValue({ insertId: 99 });
    const consultar = vi.fn().mockResolvedValue([]);
    const acesso = {
      emTransacao: vi.fn(async (_f: string, corpo: (...a: unknown[]) => unknown) => corpo(executar, consultar)),
    } as unknown as BancoPorFinalidade;

    const id = await new CasoService(acesso).abrir(
      { coCaso: 'C1', idBase: 1, dtOcorrencia: '2027-01-01', hrOcorrencia: '10:00:00' },
      7,
    );
    expect(id).toBe(99);
    expect(executar).toHaveBeenCalledTimes(2);
    expect(String(executar.mock.calls[1]?.[0])).toContain('mob_caso_estado');
  });
});

describe('transitar', () => {
  it('nao escreve nada quando o novo estado e igual ao atual', async () => {
    const executar = vi.fn();
    const consultar = vi.fn().mockResolvedValue([{ st_caso: 'ABERTO' }]);
    const acesso = {
      emTransacao: vi.fn(async (_f: string, corpo: (...a: unknown[]) => unknown) => corpo(executar, consultar)),
    } as unknown as BancoPorFinalidade;

    await new CasoService(acesso).transitar(1, 'ABERTO', 7);
    expect(executar).not.toHaveBeenCalled();
  });

  function montarTransicao(estadoAtual: string) {
    const executar = vi.fn().mockResolvedValue({});
    const consultar = vi.fn().mockResolvedValue([{ st_caso: estadoAtual }]);
    const acesso = {
      emTransacao: vi.fn(async (_f: string, corpo: (...a: unknown[]) => unknown) => corpo(executar, consultar)),
    } as unknown as BancoPorFinalidade;
    return { servico: new CasoService(acesso), executar, sqls: () => executar.mock.calls.map((c) => String(c[0])) };
  }

  it('(!) informa autor e motivo ao gatilho, muda o estado e limpa as variaveis; nao grava historico em dobro', async () => {
    const { servico, executar, sqls } = montarTransicao('ABERTO');
    await expect(servico.transitar(1, 'ENCERRADO', 7, 'concluido em campo')).resolves.toBe(true);

    expect(sqls()).toEqual([
      'SET @mob_transicao_usuario = ?, @mob_transicao_motivo = ?',
      'UPDATE mob_caso SET st_caso = ? WHERE id_caso = ?',
      'SET @mob_transicao_usuario = NULL, @mob_transicao_motivo = NULL',
    ]);
    expect(executar.mock.calls[0]?.[1]).toEqual([7, 'concluido em campo']);
    expect(sqls().some((s) => s.includes('INSERT INTO mob_caso_estado'))).toBe(false);
  });

  it('as variaveis sao limpas mesmo se o UPDATE falhar (a conexao volta ao pool)', async () => {
    const { servico, executar, sqls } = montarTransicao('ABERTO');
    executar.mockImplementation(async (sql: string) => {
      if (sql.startsWith('UPDATE')) throw new Error('falhou');
      return {};
    });
    await expect(servico.transitar(1, 'ANALISE', 7)).rejects.toThrow('falhou');
    expect(sqls().at(-1)).toBe('SET @mob_transicao_usuario = NULL, @mob_transicao_motivo = NULL');
  });

  it('somenteDe: nao transita se o estado atual nao esta na lista', async () => {
    const { servico, executar } = montarTransicao('RESOLVIDO');
    await expect(servico.transitar(1, 'ANALISE', 7, undefined, ['ENRIQUECIMENTO'])).resolves.toBe(false);
    expect(executar).not.toHaveBeenCalled();
  });

  it('somenteDe: transita quando o estado atual esta na lista', async () => {
    const { servico } = montarTransicao('ENRIQUECIMENTO');
    await expect(servico.transitar(1, 'ANALISE', 7, undefined, ['ENRIQUECIMENTO'])).resolves.toBe(true);
  });
});

describe('idPorCodigo e confirmarEnvio', () => {
  it('idPorCodigo devolve null quando o codigo nao existe', async () => {
    const acesso = { consultar: bancoConsultar([]) } as unknown as BancoPorFinalidade;
    await expect(new CasoService(acesso).idPorCodigo('C-inexistente')).resolves.toBeNull();
  });

  it('confirmarEnvio so marca quando ainda nao havia envio (WHERE st_envio IS NULL)', async () => {
    const executar = vi.fn().mockResolvedValue({ affectedRows: 1 });
    const acesso = { executar } as unknown as BancoPorFinalidade;
    await new CasoService(acesso).confirmarEnvio(1);
    expect(String(executar.mock.calls[0]?.[1])).toContain('st_envio IS NULL');
  });
});
