import { HttpStatus } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { SessaoController } from './sessao.controller';
import { AutenticacaoIndisponivel, CredencialRecusada, DispositivoNaoAutorizado } from './sessao.service';

const controller = new SessaoController({} as never);
const traduzir = (erro: unknown) =>
  (controller as unknown as { traduzir(e: unknown): { getStatus(): number } }).traduzir(erro);

describe('traducao de erros de entrada', () => {
  it('aparelho nao autorizado sai como 403', () => {
    expect(traduzir(new DispositivoNaoAutorizado()).getStatus()).toBe(HttpStatus.FORBIDDEN);
  });

  it('credencial recusada sai como 401', () => {
    expect(traduzir(new CredencialRecusada()).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('autenticacao indisponivel sai como 503', () => {
    expect(traduzir(new AutenticacaoIndisponivel()).getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
  });

  it('erro nao mapeado sai como 500 generico', () => {
    expect(traduzir(new Error('outra coisa')).getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
  });
});
