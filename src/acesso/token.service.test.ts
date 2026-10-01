import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { AssinaturaIndisponivel, TokenRecusado, TokenService } from './token.service';

const ENV = { ...process.env };
const SEGREDO = 'segredo-de-teste-com-mais-de-32-bytes-de-comprimento';

beforeEach(() => {
  process.env.JWT_SEGREDO = SEGREDO;
});
afterEach(() => {
  process.env = { ...ENV };
});

const TITULAR = {
  idUsuario: 7, finalidade: 'ASSISTENCIAL', dsEmail: 'ana@x.br', coSessao: 'sessao-1',
};

/** Token montado à mão, para exercitar o que `emitir` nunca produziria. */
async function forjar(
  claims: Record<string, unknown>,
  opts: { segredo?: string; sub?: string | null; iat?: boolean } = {},
): Promise<string> {
  let jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('identificasus-api')
    .setAudience('identificasus-api')
    .setExpirationTime('10m');
  if (opts.sub !== null) jwt = jwt.setSubject(opts.sub ?? '7');
  if (opts.iat !== false) jwt = jwt.setIssuedAt();
  return jwt.sign(new TextEncoder().encode(opts.segredo ?? SEGREDO));
}

describe('emissao', () => {
  it('recusa emitir sem JWT_SEGREDO', async () => {
    delete process.env.JWT_SEGREDO;
    await expect(new TokenService().emitir(TITULAR)).rejects.toBeInstanceOf(AssinaturaIndisponivel);
  });

  it('recusa emitir com segredo curto demais', async () => {
    process.env.JWT_SEGREDO = 'curto';
    await expect(new TokenService().emitir(TITULAR)).rejects.toBeInstanceOf(AssinaturaIndisponivel);
  });

  it('o token de acesso emitido volta como portador', async () => {
    const servico = new TokenService();
    const { acesso, expiraEmSegundos } = await servico.emitir(TITULAR);
    expect(expiraEmSegundos).toBe(900);
    const portador = await servico.verificar(acesso);
    expect(portador).toMatchObject({ sub: '7', purpose: 'ASSISTENCIAL', ds_email: 'ana@x.br' });
    expect(typeof portador.emitidoEm).toBe('number');
  });

  it('usuario sem finalidade recebe token sem purpose — e o guard de finalidade recusa', async () => {
    const servico = new TokenService();
    const { acesso } = await servico.emitir({ ...TITULAR, finalidade: null });
    expect((await servico.verificar(acesso)).purpose).toBeUndefined();
  });
});

describe('renovacao', () => {
  it('o token de renovacao do login volta com usuario, sessao e emissao', async () => {
    const servico = new TokenService();
    const { renovacao } = await servico.emitir(TITULAR);
    const r = await servico.verificarRenovacao(renovacao);
    expect(r).toMatchObject({ idUsuario: 7, coSessao: 'sessao-1' });
    expect(typeof r.emitidoEm).toBe('number');
  });

  it('token de acesso nao serve como renovacao', async () => {
    const servico = new TokenService();
    const { acesso } = await servico.emitir(TITULAR);
    await expect(servico.verificarRenovacao(acesso)).rejects.toThrow(/renova/);
  });

  it('renovacao sem sid e recusada', async () => {
    const token = await forjar({ typ: 'renovacao' });
    await expect(new TokenService().verificarRenovacao(token)).rejects.toThrow(/sid/);
  });

  it('renovacao assinada com outro segredo e recusada', async () => {
    const token = await forjar(
      { typ: 'renovacao', sid: 's' },
      { segredo: 'outro-segredo-tambem-com-mais-de-32-bytes' },
    );
    await expect(new TokenService().verificarRenovacao(token)).rejects.toBeInstanceOf(TokenRecusado);
  });

  it('emitirAcesso devolve so um token de acesso, valido no guard', async () => {
    const servico = new TokenService();
    const acesso = await servico.emitirAcesso(TITULAR);
    expect(await servico.verificar(acesso)).toMatchObject({ sub: '7', purpose: 'ASSISTENCIAL' });
  });
});

describe('verificacao', () => {
  it('o token de renovacao nao abre rota', async () => {
    const servico = new TokenService();
    const { renovacao } = await servico.emitir(TITULAR);
    await expect(servico.verificar(renovacao)).rejects.toThrow(/acesso/);
  });

  it('recusa assinatura com outro segredo', async () => {
    const token = await forjar({ typ: 'acesso' }, { segredo: 'outro-segredo-tambem-com-mais-de-32-bytes' });
    await expect(new TokenService().verificar(token)).rejects.toBeInstanceOf(TokenRecusado);
  });

  it('recusa token sem assinatura (alg none)', async () => {
    const agora = Math.floor(Date.now() / 1000);
    const corpo = Buffer.from(JSON.stringify({
      sub: '7', typ: 'acesso', iss: 'identificasus-api', aud: 'identificasus-api',
      iat: agora, exp: agora + 600,
    })).toString('base64url');
    const cabecalho = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
    await expect(new TokenService().verificar(`${cabecalho}.${corpo}.`))
      .rejects.toBeInstanceOf(TokenRecusado);
  });

  it('recusa sub que nao e id_usuario', async () => {
    const token = await forjar({ typ: 'acesso' }, { sub: 'abc' });
    await expect(new TokenService().verificar(token)).rejects.toThrow(/sub/);
  });

  it('recusa payload sem sub', async () => {
    const token = await forjar({ typ: 'acesso' }, { sub: null });
    await expect(new TokenService().verificar(token)).rejects.toThrow(/sub/);
  });

  it('recusa payload sem iat', async () => {
    const token = await forjar({ typ: 'acesso' }, { iat: false });
    await expect(new TokenService().verificar(token)).rejects.toThrow(/iat/);
  });

  it('ds_email fica null quando a claim nao e string', async () => {
    const token = await forjar({ typ: 'acesso', email: 42 });
    expect((await new TokenService().verificar(token)).ds_email).toBeNull();
  });

  it('sem JWT_SEGREDO, qualquer token e recusado', async () => {
    const token = await forjar({ typ: 'acesso' });
    delete process.env.JWT_SEGREDO;
    await expect(new TokenService().verificar(token)).rejects.toBeInstanceOf(TokenRecusado);
  });
});
