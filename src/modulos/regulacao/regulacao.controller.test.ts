import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { CHAVE_FINALIDADE } from '@/acesso/finalidade.decorator';
import { FinalidadeGuard } from '@/acesso/finalidade.guard';
import { ZodValidacaoPipe } from '@/comum/zod-validacao.pipe';
import { RegulacaoController, RegulacaoFotosController } from './regulacao.controller';
import { esquemaDecisao } from './regulacao.service';
import type { RegulacaoService } from './regulacao.service';

/**
 * (!) TODA ROTA DA REGULAÇÃO É SÓ ADJUDICACAO. Elas leem casos de todas as
 *     bases; aceitar ASSISTENCIAL aqui daria à equipe de campo o que o
 *     CasoService, filtrado por turno, existe para negar. A lista de rotas sai
 *     do protótipo do controller: rota nova entra no teste sem ninguém lembrar.
 */
const ROTAS = Object.getOwnPropertyNames(RegulacaoController.prototype)
  .filter((nome) => nome !== 'constructor');

function finalidadesDe(rota: string): unknown {
  const handler = (RegulacaoController.prototype as unknown as Record<string, unknown>)[rota];
  return Reflect.getMetadata(CHAVE_FINALIDADE, handler as object);
}

function contexto(rota: string, purpose: string): ExecutionContext {
  const handler = (RegulacaoController.prototype as unknown as Record<string, () => unknown>)[rota];
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: { purpose } }) }),
    getHandler: () => handler,
    getClass: () => RegulacaoController,
  } as unknown as ExecutionContext;
}

describe('autorização das rotas da regulação', () => {
  it('o controller tem as rotas esperadas', () => {
    expect(ROTAS.sort()).toEqual(['caso', 'decidir', 'fila']);
  });

  it.each(ROTAS)('%s declara só ADJUDICACAO', (rota) => {
    expect(finalidadesDe(rota)).toEqual(['ADJUDICACAO']);
  });

  it.each(ROTAS)('%s recusa token de campo, pesquisa e administração', (rota) => {
    const guard = new FinalidadeGuard(new Reflector());
    for (const purpose of ['ASSISTENCIAL', 'PESQUISA', 'ADMINISTRACAO', 'AUDITORIA']) {
      expect(() => guard.canActivate(contexto(rota, purpose))).toThrow(ForbiddenException);
    }
    expect(guard.canActivate(contexto(rota, 'ADJUDICACAO'))).toBe(true);
  });
});

describe('o controller repassa quem pediu', () => {
  function montar() {
    const servico = {
      fila: vi.fn().mockResolvedValue([]),
      caso: vi.fn().mockResolvedValue({}),
    };
    return { controller: new RegulacaoController(servico as unknown as RegulacaoService), servico };
  }

  it('fila e caso vão ao serviço com o usuário do token', async () => {
    const { controller, servico } = montar();
    await controller.fila({ user: { usuarioId: 9 } });
    await controller.caso('NN-2026-ABCDEFGH', { user: { usuarioId: 9 } });
    expect(servico.fila).toHaveBeenCalledWith(9);
    expect(servico.caso).toHaveBeenCalledWith('NN-2026-ABCDEFGH', 9);
  });

  it('a decisão leva o autor do token, nunca do corpo', async () => {
    const decidir = vi.fn().mockResolvedValue({ coCaso: 'NN-2026-ABCDEFGH', stCaso: 'PERICIA' });
    const controller = new RegulacaoController({ decidir } as unknown as RegulacaoService);
    const dados = { decisao: 'PERICIA' as const, motivo: 'Sem documento e sem candidato plausível.' };
    await controller.decidir('NN-2026-ABCDEFGH', dados, { user: { usuarioId: 9 } });
    expect(decidir).toHaveBeenCalledWith('NN-2026-ABCDEFGH', 9, dados);
  });
});

describe('rota das fotos', () => {
  it('também é só ADJUDICACAO', () => {
    const handler = RegulacaoFotosController.prototype.fotos;
    expect(Reflect.getMetadata(CHAVE_FINALIDADE, handler)).toEqual(['ADJUDICACAO']);
  });
});

describe('validação do corpo da decisão', () => {
  const pipe = new ZodValidacaoPipe(esquemaDecisao);

  it('aceita não resolvido e perícia, com motivo de pelo menos 10 caracteres', () => {
    expect(pipe.transform({ decisao: 'NAO_RESOLVIDO', motivo: '  Esgotadas as buscas.  ' }))
      .toEqual({ decisao: 'NAO_RESOLVIDO', motivo: 'Esgotadas as buscas.' });
  });

  it.each([
    [{ decisao: 'RESOLVIDO', motivo: 'Vinculado ao registro X.' }],
    [{ decisao: 'PERICIA', motivo: 'ok' }],
    [{ decisao: 'PERICIA', motivo: 'x'.repeat(301) }],
    [{ decisao: 'PERICIA' }],
  ])('(!) recusa %j: "resolvido" ainda não existe, e motivo é obrigatório', (corpo) => {
    expect(() => pipe.transform(corpo)).toThrow(BadRequestException);
  });
});
