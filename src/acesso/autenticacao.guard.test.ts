import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { AutenticacaoGuard } from './autenticacao.guard';
import type { BancoPorFinalidade } from './banco-por-finalidade.service';
import type { Portador, TokenService } from './token.service';

function criarContexto(headers: Record<string, unknown> = {}): {
  ctx: ExecutionContext;
  req: Record<string, unknown>;
} {
  const req: Record<string, unknown> = { headers };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
  return { ctx, req };
}

const PORTADOR: Portador = { sub: 'idp-1', emitidoEm: 1_000, purpose: 'ASSISTENCIAL', ds_email: null };

function montar(opts: {
  publico?: boolean;
  portador?: Portador;
  linhas?: Array<Record<string, unknown>>;
}) {
  const reflector = new Reflector();
  vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(opts.publico);

  const token = { verificar: vi.fn().mockResolvedValue(opts.portador ?? PORTADOR) } as unknown as TokenService;
  const acesso = {
    consultar: vi.fn().mockResolvedValue(opts.linhas ?? []),
  } as unknown as BancoPorFinalidade;

  return { guard: new AutenticacaoGuard(reflector, token, acesso), token, acesso };
}

describe('guard de autenticacao', () => {
  it('deixa passar sem checar token quando a rota e publica', async () => {
    const { guard, token } = montar({ publico: true });
    const { ctx } = criarContexto();
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(token.verificar).not.toHaveBeenCalled();
  });

  it('recusa sem cabecalho authorization', async () => {
    const { guard } = montar({ publico: false });
    const { ctx } = criarContexto();
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('recusa cabecalho que nao comeca com Bearer', async () => {
    const { guard } = montar({ publico: false });
    const { ctx } = criarContexto({ authorization: 'Basic xyz' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('aceita cabecalho vindo como array, usando o primeiro valor', async () => {
    const linhas = [{ id_usuario: 9, no_usuario: 'Ana', st_ativo: 'A', st_credenciais_alteradas: null }];
    const { guard, token } = montar({ publico: false, linhas });
    const { ctx } = criarContexto({ authorization: ['Bearer abc', 'Bearer outro'] });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(token.verificar).toHaveBeenCalledWith('abc');
  });

  it('recusa quando o usuario nao existe em mob_usuario', async () => {
    const { guard } = montar({ publico: false, linhas: [] });
    const { ctx } = criarContexto({ authorization: 'Bearer abc' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('recusa quando o usuario existe mas esta inativo', async () => {
    const linhas = [{ id_usuario: 1, no_usuario: 'Ana', st_ativo: 'I', st_credenciais_alteradas: null }];
    const { guard } = montar({ publico: false, linhas });
    const { ctx } = criarContexto({ authorization: 'Bearer abc' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('preenche req.user e deixa passar quando tudo bate', async () => {
    const linhas = [{ id_usuario: 7, no_usuario: 'Ana', st_ativo: 'A', st_credenciais_alteradas: null }];
    const { guard } = montar({ publico: false, linhas });
    const { ctx, req } = criarContexto({ authorization: 'Bearer abc' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.user).toEqual({
      sub: 'idp-1', purpose: 'ASSISTENCIAL', usuarioId: 7, noUsuario: 'Ana',
    });
  });

  it('recusa quando a senha foi trocada depois da emissao do token', async () => {
    const portador: Portador = { ...PORTADOR, emitidoEm: 1_000_000 };
    const linhas = [{
      id_usuario: 1, no_usuario: 'Ana', st_ativo: 'A',
      st_credenciais_alteradas: '2033-01-01 00:00:00.000000',
    }];
    const { guard } = montar({ publico: false, portador, linhas });
    const { ctx } = criarContexto({ authorization: 'Bearer abc' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('da um segundo de folga: token emitido no mesmo segundo da troca ainda vale', async () => {
    const alteradaEm = Date.parse('2030-01-01T00:00:00.500Z');
    const portador: Portador = { ...PORTADOR, emitidoEm: Math.floor(alteradaEm / 1000) };
    const linhas = [{
      id_usuario: 1, no_usuario: 'Ana', st_ativo: 'A',
      st_credenciais_alteradas: '2030-01-01 00:00:00.500000',
    }];
    const { guard } = montar({ publico: false, portador, linhas });
    const { ctx } = criarContexto({ authorization: 'Bearer abc' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});
