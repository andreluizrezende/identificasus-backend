import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { SincronizacaoService } from './sincronizacao.service';
import type { BancoPorFinalidade } from '@/acesso/banco-por-finalidade.service';
import type { AuditoriaService } from '@/modulos/auditoria/auditoria.service';
import type { CapturaService, ValorVigente } from '@/modulos/captura/captura.service';
import type { CasoService } from '@/modulos/caso/caso.service';
import type { TurnoService } from '@/modulos/turno/turno.service';
import type { Lote } from './sincronizacao.esquemas';

const DISPOSITIVO = { id_dispositivo: 1, id_base: 10 };

function erroDuplicado(): Error {
  return Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
}

function montar(opts: {
  dispositivoLinhas?: unknown[];
  eventoDuplicadoDe?: Set<string>; // co_idempotencia que ja existem
  eventoExistente?: (coIdempotencia: string) => { id_evento: number; st_evento: string };
  idPorCodigo?: number | null;
  valorVigente?: ValorVigente | null;
  divergenciasPendentes?: unknown[];
  divergenciaParaResolver?: unknown[];
}) {
  let proximoId = 100;
  const executar = vi.fn().mockImplementation(async (_fin: string, sql: string, params: unknown[] = []) => {
    if (sql.includes('INSERT INTO mob_evento_sincronizacao')) {
      const coIdempotencia = params[2] as string;
      if (opts.eventoDuplicadoDe?.has(coIdempotencia)) throw erroDuplicado();
      proximoId += 1;
      return { insertId: proximoId };
    }
    return {};
  });
  const consultar = vi.fn().mockImplementation(async (_fin: string, sql: string, params: unknown[] = []) => {
    if (sql.includes('FROM mob_dispositivo')) return opts.dispositivoLinhas ?? [DISPOSITIVO];
    if (sql.includes('FROM mob_divergencia') && sql.includes('FOR UPDATE')) {
      return opts.divergenciaParaResolver ?? [];
    }
    if (sql.includes('FROM mob_divergencia')) return opts.divergenciasPendentes ?? [];
    if (sql.includes('FROM mob_evento_sincronizacao')) {
      const coIdempotencia = params[0] as string;
      const existente = opts.eventoExistente?.(coIdempotencia);
      return existente ? [existente] : [];
    }
    return [];
  });
  const emTransacao = vi.fn().mockImplementation(
    async (
      _fin: string,
      corpo: (
        exec: (sql: string, p?: unknown[]) => Promise<unknown>,
        cons: (sql: string, p?: unknown[]) => Promise<unknown[]>,
      ) => Promise<unknown>,
    ) => corpo(
      (sql: string, p: unknown[] = []) => executar('ASSISTENCIAL', sql, p),
      (sql: string, p: unknown[] = []) => consultar('ASSISTENCIAL', sql, p),
    ),
  );
  const acesso = { executar, consultar, emTransacao } as unknown as BancoPorFinalidade;

  const casos = {
    idPorCodigo: vi.fn().mockResolvedValue('idPorCodigo' in opts ? opts.idPorCodigo : 1),
    abrir: vi.fn().mockResolvedValue(1),
    transitar: vi.fn().mockResolvedValue(undefined),
    confirmarEnvio: vi.fn().mockResolvedValue(undefined),
  } as unknown as CasoService;

  const captura = {
    valorVigente: vi.fn().mockResolvedValue(opts.valorVigente ?? null),
    registrarAtributo: vi.fn().mockResolvedValue(undefined),
  } as unknown as CapturaService;

  const turnos = { ativoDe: vi.fn().mockResolvedValue(null) } as unknown as TurnoService;
  const auditoria = { registrar: vi.fn().mockResolvedValue('hash') } as unknown as AuditoriaService;

  return { acesso, casos, captura, turnos, auditoria, executar, consultar, emTransacao };
}

function eventoEstado(coIdempotencia: string, coCaso = 'C1'): Lote['eventos'][number] {
  return {
    coIdempotencia, tipo: 'ESTADO', coCaso,
    conteudo: { stAtual: 'ABERTO' }, capturadoEm: '2027-01-01T10:00:00.000Z',
  };
}

function eventoAtributo(coIdempotencia: string, conteudo: Record<string, unknown>): Lote['eventos'][number] {
  return {
    coIdempotencia, tipo: 'ATRIBUTO', coCaso: 'C1', conteudo,
    capturadoEm: '2027-01-01T10:00:00.000Z',
  };
}

describe('aparelho nao autorizado', () => {
  it('recusa o lote inteiro quando o aparelho nao existe ou esta revogado', async () => {
    const { acesso, casos, captura, turnos, auditoria } = montar({ dispositivoLinhas: [] });
    const servico = new SincronizacaoService(acesso, casos, captura, turnos, auditoria);
    await expect(
      servico.aplicarLote({ coDispositivo: 'D1', eventos: [eventoEstado('a')] }, 1),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('idempotencia', () => {
  it('reenvio de evento ja APLICADO volta em aplicados sem reaplicar', async () => {
    const co = '123e4567-e89b-12d3-a456-426614174000';
    const { acesso, casos, captura, turnos, auditoria } = montar({
      eventoDuplicadoDe: new Set([co]),
      eventoExistente: () => ({ id_evento: 1, st_evento: 'APLICADO' }),
    });
    const servico = new SincronizacaoService(acesso, casos, captura, turnos, auditoria);
    const r = await servico.aplicarLote({ coDispositivo: 'D1', eventos: [eventoEstado(co)] }, 1);
    expect(r.aplicados).toEqual([co]);
    expect(casos.transitar).not.toHaveBeenCalled();
  });

  it('reenvio de evento DIVERGENTE volta em recusados, sem reabrir a divergencia', async () => {
    const co = '123e4567-e89b-12d3-a456-426614174000';
    const { acesso, casos, captura, turnos, auditoria } = montar({
      eventoDuplicadoDe: new Set([co]),
      eventoExistente: () => ({ id_evento: 1, st_evento: 'DIVERGENTE' }),
    });
    const servico = new SincronizacaoService(acesso, casos, captura, turnos, auditoria);
    const r = await servico.aplicarLote({ coDispositivo: 'D1', eventos: [eventoEstado(co)] }, 1);
    expect(r.recusados).toEqual([{ coIdempotencia: co, motivo: 'Este registro está em divergência e aguarda decisão.' }]);
    expect(r.aplicados).toEqual([]);
  });

  it('reenvio de evento ainda PENDENTE nao e reaplicado (evita duplicar o efeito)', async () => {
    const co = '123e4567-e89b-12d3-a456-426614174000';
    const { acesso, casos, captura, turnos, auditoria } = montar({
      eventoDuplicadoDe: new Set([co]),
      eventoExistente: () => ({ id_evento: 1, st_evento: 'PENDENTE' }),
    });
    const servico = new SincronizacaoService(acesso, casos, captura, turnos, auditoria);
    const r = await servico.aplicarLote({ coDispositivo: 'D1', eventos: [eventoEstado(co)] }, 1);
    expect(r.recusados[0]?.coIdempotencia).toBe(co);
    expect(casos.transitar).not.toHaveBeenCalled();
  });
});

describe('evento CASO', () => {
  it('abre o caso e marca aplicado', async () => {
    const evento: Lote['eventos'][number] = {
      coIdempotencia: '123e4567-e89b-12d3-a456-426614174000', tipo: 'CASO', coCaso: 'C1',
      conteudo: { dtOcorrencia: '2027-01-01', hrOcorrencia: '10:00' },
      capturadoEm: '2027-01-01T10:00:00.000Z',
    };
    const { acesso, casos, captura, turnos, auditoria } = montar({});
    const servico = new SincronizacaoService(acesso, casos, captura, turnos, auditoria);
    const r = await servico.aplicarLote({ coDispositivo: 'D1', eventos: [evento] }, 1);
    expect(r.aplicados).toEqual([evento.coIdempotencia]);
    expect(casos.abrir).toHaveBeenCalledTimes(1);
  });

  it('conteudo invalido recusa o evento sem derrubar o lote', async () => {
    const evento: Lote['eventos'][number] = {
      coIdempotencia: '123e4567-e89b-12d3-a456-426614174000', tipo: 'CASO', coCaso: 'C1',
      conteudo: { dtOcorrencia: 'data-invalida', hrOcorrencia: '10:00' },
      capturadoEm: '2027-01-01T10:00:00.000Z',
    };
    const { acesso, casos, captura, turnos, auditoria } = montar({});
    const servico = new SincronizacaoService(acesso, casos, captura, turnos, auditoria);
    const r = await servico.aplicarLote({ coDispositivo: 'D1', eventos: [evento] }, 1);
    expect(r.aplicados).toEqual([]);
    expect(r.recusados).toHaveLength(1);
    // a mensagem que volta nunca expoe o motivo interno (RNF-07.05)
    expect(r.recusados[0]?.motivo).not.toMatch(/dtOcorrencia|zod|invalid/i);
  });
});

describe('evento ATRIBUTO — regra de divergencia', () => {
  const conteudo = { coAtributo: 'SEXO_APARENTE', coProcedencia: 'OBSERVADO' as const, coValor: 'MASCULINO' };

  it('sem valor previo no servidor, grava direto', async () => {
    const { acesso, casos, captura, turnos, auditoria } = montar({ valorVigente: null });
    const servico = new SincronizacaoService(acesso, casos, captura, turnos, auditoria);
    const r = await servico.aplicarLote(
      { coDispositivo: 'D1', eventos: [eventoAtributo('123e4567-e89b-12d3-a456-426614174000', conteudo)] }, 1,
    );
    expect(r.aplicados).toHaveLength(1);
    expect(captura.registrarAtributo).toHaveBeenCalledTimes(1);
  });

  it('mesmo profissional corrigindo o proprio registro NAO e divergencia', async () => {
    const { acesso, casos, captura, turnos, auditoria } = montar({
      valorVigente: { idTipoAtributo: 1, valor: 'FEMININO', idUsuario: 1, noUsuario: 'Ana' },
    });
    const servico = new SincronizacaoService(acesso, casos, captura, turnos, auditoria);
    const r = await servico.aplicarLote(
      { coDispositivo: 'D1', eventos: [eventoAtributo('123e4567-e89b-12d3-a456-426614174000', conteudo)] }, 1,
    );
    expect(r.divergentes).toEqual([]);
    expect(r.aplicados).toHaveLength(1);
    expect(captura.registrarAtributo).toHaveBeenCalledTimes(1);
  });

  it('valor diferente gravado por OUTRO profissional gera divergencia e nao sobrescreve', async () => {
    const { acesso, casos, captura, turnos, auditoria, executar } = montar({
      valorVigente: { idTipoAtributo: 1, valor: 'FEMININO', idUsuario: 2, noUsuario: 'Beto' },
    });
    const servico = new SincronizacaoService(acesso, casos, captura, turnos, auditoria);
    const r = await servico.aplicarLote(
      { coDispositivo: 'D1', eventos: [eventoAtributo('123e4567-e89b-12d3-a456-426614174000', conteudo)] }, 1,
    );
    expect(r.divergentes).toHaveLength(1);
    expect(r.divergentes[0]).toMatchObject({ valorDispositivo: 'MASCULINO', valorServidor: 'FEMININO' });
    expect(r.aplicados).toEqual([]); // nao entra em aplicados: fila local se mantem
    expect(captura.registrarAtributo).not.toHaveBeenCalled();
    expect(executar).toHaveBeenCalledWith(
      'ASSISTENCIAL', expect.stringContaining('INSERT INTO mob_divergencia'), expect.anything(),
    );
  });

  it('mesmo valor de outro profissional nao e divergencia', async () => {
    const { acesso, casos, captura, turnos, auditoria } = montar({
      valorVigente: { idTipoAtributo: 1, valor: 'MASCULINO', idUsuario: 2, noUsuario: 'Beto' },
    });
    const servico = new SincronizacaoService(acesso, casos, captura, turnos, auditoria);
    const r = await servico.aplicarLote(
      { coDispositivo: 'D1', eventos: [eventoAtributo('123e4567-e89b-12d3-a456-426614174000', conteudo)] }, 1,
    );
    expect(r.divergentes).toEqual([]);
    expect(r.aplicados).toHaveLength(1);
  });
});

describe('evento ESTADO', () => {
  it('transita o caso e, se o novo estado e ENCERRADO, confirma o envio', async () => {
    const evento = eventoEstado('123e4567-e89b-12d3-a456-426614174000');
    evento.conteudo = { stAtual: 'ENCERRADO' };
    const { acesso, casos, captura, turnos, auditoria } = montar({});
    const servico = new SincronizacaoService(acesso, casos, captura, turnos, auditoria);
    await servico.aplicarLote({ coDispositivo: 'D1', eventos: [evento] }, 1);
    expect(casos.transitar).toHaveBeenCalledWith(1, 'ENCERRADO', 1, undefined);
    expect(casos.confirmarEnvio).toHaveBeenCalledWith(1);
  });

  it('estado que nao e ENCERRADO nao confirma envio', async () => {
    const { acesso, casos, captura, turnos, auditoria } = montar({});
    const servico = new SincronizacaoService(acesso, casos, captura, turnos, auditoria);
    await servico.aplicarLote({ coDispositivo: 'D1', eventos: [eventoEstado('123e4567-e89b-12d3-a456-426614174000')] }, 1);
    expect(casos.confirmarEnvio).not.toHaveBeenCalled();
  });

  it('atributo ou estado para um caso que o servidor ainda nao conhece fica recusado, nao derruba o lote', async () => {
    const { acesso, casos, captura, turnos, auditoria } = montar({ idPorCodigo: null });
    const servico = new SincronizacaoService(acesso, casos, captura, turnos, auditoria);
    const r = await servico.aplicarLote(
      { coDispositivo: 'D1', eventos: [eventoEstado('123e4567-e89b-12d3-a456-426614174000')] }, 1,
    );
    expect(r.aplicados).toEqual([]);
    expect(r.recusados).toHaveLength(1);
  });
});

describe('lote misto', () => {
  it('um evento recusado nao impede os outros de serem aplicados', async () => {
    const bom = eventoEstado('123e4567-e89b-12d3-a456-426614174000', 'C1');
    const ruim = eventoEstado('223e4567-e89b-12d3-a456-426614174000', 'C-nao-existe');
    const { acesso, casos, captura, turnos, auditoria } = montar({});
    (casos.idPorCodigo as ReturnType<typeof vi.fn>).mockImplementation(
      async (coCaso: string) => (coCaso === 'C1' ? 1 : null),
    );
    const servico = new SincronizacaoService(acesso, casos, captura, turnos, auditoria);
    const r = await servico.aplicarLote({ coDispositivo: 'D1', eventos: [bom, ruim] }, 1);
    expect(r.aplicados).toEqual([bom.coIdempotencia]);
    expect(r.recusados.map((x) => x.coIdempotencia)).toEqual([ruim.coIdempotencia]);
  });

  it('audita o resumo do lote com as contagens certas', async () => {
    const bom = eventoEstado('123e4567-e89b-12d3-a456-426614174000', 'C1');
    const ruim = eventoEstado('223e4567-e89b-12d3-a456-426614174000', 'C-nao-existe');
    const { acesso, casos, captura, turnos, auditoria } = montar({});
    (casos.idPorCodigo as ReturnType<typeof vi.fn>).mockImplementation(
      async (coCaso: string) => (coCaso === 'C1' ? 1 : null),
    );
    const servico = new SincronizacaoService(acesso, casos, captura, turnos, auditoria);
    await servico.aplicarLote({ coDispositivo: 'D1', eventos: [bom, ruim] }, 1);
    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        acao: 'lote_sincronizado',
        detalhe: { recebidos: 2, aplicados: 1, divergentes: 0, recusados: 1 },
      }),
    );
  });
});

describe('listarPendentes', () => {
  it('devolve as divergencias pendentes visiveis ao profissional', async () => {
    const linha = {
      id_divergencia: 5, co_idempotencia: '123e4567-e89b-12d3-a456-426614174000',
      co_caso: 'C1', co_atributo: 'SEXO_APARENTE', no_atributo: 'Sexo aparente',
      ds_valor_dispositivo: 'MASCULINO', ds_valor_servidor: 'FEMININO',
      no_autor_servidor: 'Beto', st_deteccao: '2027-01-01 10:00:00.000000',
    };
    const { acesso, casos, captura, turnos, auditoria } = montar({ divergenciasPendentes: [linha] });
    const servico = new SincronizacaoService(acesso, casos, captura, turnos, auditoria);

    const r = await servico.listarPendentes(1);

    expect(r).toEqual([{
      idDivergencia: 5,
      coIdempotencia: linha.co_idempotencia,
      coCaso: 'C1',
      coAtributo: 'SEXO_APARENTE',
      noAtributo: 'Sexo aparente',
      valorDispositivo: 'MASCULINO',
      valorServidor: 'FEMININO',
      autorServidor: 'Beto',
      detectadaEm: linha.st_deteccao,
    }]);
  });

  it('sem divergencias pendentes, devolve lista vazia', async () => {
    const { acesso, casos, captura, turnos, auditoria } = montar({ divergenciasPendentes: [] });
    const servico = new SincronizacaoService(acesso, casos, captura, turnos, auditoria);
    expect(await servico.listarPendentes(1)).toEqual([]);
  });
});

describe('resolver divergencia (RF-11.02)', () => {
  const linhaBase = {
    id_divergencia: 5, id_caso: 1, st_resolucao: 'PENDENTE', co_atributo: 'SEXO_APARENTE',
    ds_payload: JSON.stringify({ coAtributo: 'SEXO_APARENTE', coProcedencia: 'OBSERVADO', coValor: 'MASCULINO' }),
  };

  it('DISPOSITIVO relê o payload original do evento e regrava com a procedencia correta', async () => {
    const { acesso, casos, captura, turnos, auditoria, executar } = montar({
      divergenciaParaResolver: [linhaBase],
    });
    const servico = new SincronizacaoService(acesso, casos, captura, turnos, auditoria);

    await servico.resolver(5, 9, { resolucao: 'DISPOSITIVO' });

    expect(captura.registrarAtributo).toHaveBeenCalledWith({
      idCaso: 1, coAtributo: 'SEXO_APARENTE', coProcedencia: 'OBSERVADO',
      coValor: 'MASCULINO', dsValor: null, usuarioId: 9,
    });
    expect(executar).toHaveBeenCalledWith(
      'ASSISTENCIAL', expect.stringContaining('UPDATE mob_divergencia'), ['DISPOSITIVO', 9, null, 5],
    );
  });

  it('SERVIDOR nao regrava atributo: o valor vigente do servidor ja e o que vale', async () => {
    const { acesso, casos, captura, turnos, auditoria } = montar({ divergenciaParaResolver: [linhaBase] });
    const servico = new SincronizacaoService(acesso, casos, captura, turnos, auditoria);

    await servico.resolver(5, 9, { resolucao: 'SERVIDOR' });

    expect(captura.registrarAtributo).not.toHaveBeenCalled();
  });

  it('AMBOS tambem nao regrava atributo, so registra a duvida para a regulacao revisar', async () => {
    const { acesso, casos, captura, turnos, auditoria, executar } = montar({
      divergenciaParaResolver: [linhaBase],
    });
    const servico = new SincronizacaoService(acesso, casos, captura, turnos, auditoria);

    await servico.resolver(5, 9, { resolucao: 'AMBOS', justificativa: 'nao tenho certeza de qual esta certo' });

    expect(captura.registrarAtributo).not.toHaveBeenCalled();
    expect(executar).toHaveBeenCalledWith(
      'ASSISTENCIAL', expect.stringContaining('UPDATE mob_divergencia'),
      ['AMBOS', 9, 'nao tenho certeza de qual esta certo', 5],
    );
  });

  it('divergencia inexistente ou de outro profissional devolve NotFound', async () => {
    const { acesso, casos, captura, turnos, auditoria } = montar({ divergenciaParaResolver: [] });
    const servico = new SincronizacaoService(acesso, casos, captura, turnos, auditoria);

    await expect(servico.resolver(999, 9, { resolucao: 'SERVIDOR' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('divergencia ja resolvida recusa nova decisao', async () => {
    const { acesso, casos, captura, turnos, auditoria } = montar({
      divergenciaParaResolver: [{ ...linhaBase, st_resolucao: 'DISPOSITIVO' }],
    });
    const servico = new SincronizacaoService(acesso, casos, captura, turnos, auditoria);

    await expect(servico.resolver(5, 9, { resolucao: 'SERVIDOR' })).rejects.toBeInstanceOf(ConflictException);
    expect(captura.registrarAtributo).not.toHaveBeenCalled();
  });

  it('audita a resolucao', async () => {
    const { acesso, casos, captura, turnos, auditoria } = montar({ divergenciaParaResolver: [linhaBase] });
    const servico = new SincronizacaoService(acesso, casos, captura, turnos, auditoria);

    await servico.resolver(5, 9, { resolucao: 'SERVIDOR' });

    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        acao: 'divergencia_resolvida',
        detalhe: { idDivergencia: 5, resolucao: 'SERVIDOR' },
      }),
    );
  });
});
