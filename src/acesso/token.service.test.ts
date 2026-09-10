import { afterEach, describe, expect, it, vi } from 'vitest';
import { TokenRecusado, TokenService } from './token.service';

const jwtVerify = vi.fn();
vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => 'jwks-fake'),
  jwtVerify: (...args: unknown[]) => jwtVerify(...args),
}));

const ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ENV };
  jwtVerify.mockReset();
});

describe('verificacao de token', () => {
  it('recusa sem OIDC_ISSUER configurado', async () => {
    delete process.env.OIDC_ISSUER;
    await expect(new TokenService().verificar('t')).rejects.toBeInstanceOf(TokenRecusado);
  });

  it('recusa payload sem sub', async () => {
    process.env.OIDC_ISSUER = 'https://kc.local/realms/x';
    jwtVerify.mockResolvedValue({ payload: { iat: 100 } });
    await expect(new TokenService().verificar('t')).rejects.toThrow(/sub/);
  });

  it('recusa payload sem iat', async () => {
    process.env.OIDC_ISSUER = 'https://kc.local/realms/x';
    jwtVerify.mockResolvedValue({ payload: { sub: 'abc' } });
    await expect(new TokenService().verificar('t')).rejects.toThrow(/iat/);
  });

  it('devolve o portador quando o token e valido', async () => {
    process.env.OIDC_ISSUER = 'https://kc.local/realms/x';
    jwtVerify.mockResolvedValue({
      payload: { sub: 'abc', iat: 1000, purpose: 'ASSISTENCIAL', email: 'a@x.br' },
    });
    const portador = await new TokenService().verificar('t');
    expect(portador).toEqual({
      sub: 'abc', emitidoEm: 1000, purpose: 'ASSISTENCIAL', ds_email: 'a@x.br',
    });
  });

  it('ds_email fica null quando a claim nao e string', async () => {
    process.env.OIDC_ISSUER = 'https://kc.local/realms/x';
    jwtVerify.mockResolvedValue({ payload: { sub: 'abc', iat: 1000, email: 42 } });
    const portador = await new TokenService().verificar('t');
    expect(portador.ds_email).toBeNull();
  });

  it('embrulha qualquer falha de verificacao em TokenRecusado, sem vazar detalhe', async () => {
    process.env.OIDC_ISSUER = 'https://kc.local/realms/x';
    jwtVerify.mockRejectedValue(new Error('signature verification failed'));
    await expect(new TokenService().verificar('t')).rejects.toBeInstanceOf(TokenRecusado);
  });
});
