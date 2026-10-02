import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { FinalidadeGuard } from './finalidade.guard';
import { CHAVE_FINALIDADE } from './finalidade.decorator';

function contexto(user: unknown): ExecutionContext {
  const req: Record<string, unknown> = { user };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

function guardCom(exigida: string | undefined): FinalidadeGuard {
  const reflector = new Reflector();
  vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(exigida);
  return new FinalidadeGuard(reflector);
}

/**
 * Este teste existe porque o MySQL nao tem row-level security. Ele e uma das
 * tres compensacoes do ADR-14 e e bloqueante em CI: desativa-lo remove uma
 * garantia que a arquitetura afirma ter.
 */
describe('guard de finalidade', () => {
  it('deixa passar quando a claim bate com a finalidade da rota', () => {
    expect(guardCom('ASSISTENCIAL').canActivate(contexto({ purpose: 'ASSISTENCIAL' }))).toBe(true);
  });

  it('nega quando a finalidade do token e outra', () => {
    expect(() => guardCom('ASSISTENCIAL').canActivate(contexto({ purpose: 'PESQUISA' }))).toThrow(
      ForbiddenException,
    );
  });

  it('nega quando o token nao declara finalidade', () => {
    expect(() => guardCom('ASSISTENCIAL').canActivate(contexto({}))).toThrow(ForbiddenException);
  });

  it('nega quando a rota nao declara finalidade: falha fechado', () => {
    expect(() => guardCom(undefined).canActivate(contexto({ purpose: 'ASSISTENCIAL' }))).toThrow(
      ForbiddenException,
    );
  });

  it('nega finalidade inventada', () => {
    expect(() => guardCom('ASSISTENCIAL').canActivate(contexto({ purpose: 'QUALQUER' }))).toThrow(
      ForbiddenException,
    );
  });
});

describe('rota com mais de uma finalidade aceita', () => {
  it('deixa passar qualquer uma das declaradas, e marca a do token na requisicao', () => {
    const reflector = new Reflector();
    vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((chave: unknown) =>
      chave === CHAVE_FINALIDADE ? ['ASSISTENCIAL', 'ADJUDICACAO'] : undefined);
    const req: Record<string, unknown> = { user: { purpose: 'ADJUDICACAO' } };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => undefined,
      getClass: () => undefined,
    } as unknown as ExecutionContext;
    expect(new FinalidadeGuard(reflector).canActivate(ctx)).toBe(true);
    expect(req.finalidade).toBe('ADJUDICACAO');
  });

  it('continua negando finalidade fora da lista', () => {
    const reflector = new Reflector();
    vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((chave: unknown) =>
      chave === CHAVE_FINALIDADE ? ['ASSISTENCIAL', 'ADJUDICACAO'] : undefined);
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ user: { purpose: 'PESQUISA' } }) }),
      getHandler: () => undefined,
      getClass: () => undefined,
    } as unknown as ExecutionContext;
    expect(() => new FinalidadeGuard(reflector).canActivate(ctx)).toThrow(ForbiddenException);
  });
});
