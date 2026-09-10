import { BadRequestException, HttpStatus } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { FiltroExcecao } from './filtro-excecao';

function host() {
  const resposta = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  const ctx = {
    switchToHttp: () => ({ getResponse: () => resposta }),
  } as unknown as ArgumentsHost;
  return { ctx, resposta };
}

describe('filtro de excecao', () => {
  it('devolve o status e o corpo de uma HttpException, sem alterar', () => {
    const { ctx, resposta } = host();
    const erro = new BadRequestException({ mensagem: 'Requisicao invalida.', campos: [] });
    new FiltroExcecao().catch(erro, ctx);
    expect(resposta.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(resposta.json).toHaveBeenCalledWith(erro.getResponse());
  });

  it('erro nao tratado vira 500 generico, sem detalhe interno na resposta (RNF-07.05)', () => {
    const { ctx, resposta } = host();
    new FiltroExcecao().catch(new Error('detalhe interno sensivel: senha=123'), ctx);
    expect(resposta.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    const corpo = resposta.json.mock.calls[0]?.[0];
    expect(JSON.stringify(corpo)).not.toContain('senha=123');
    expect(JSON.stringify(corpo)).not.toContain('detalhe interno');
  });

  it('erro que nao e Error tambem vira 500 generico', () => {
    const { ctx, resposta } = host();
    new FiltroExcecao().catch('string jogada como erro', ctx);
    expect(resposta.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
  });
});
