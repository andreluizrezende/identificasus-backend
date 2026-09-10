import { afterEach, describe, expect, it, vi } from 'vitest';
import { Credencial } from './credencial.service';

const ENV = { ...process.env };
const CONFIGURADO = {
  OIDC_ISSUER: 'https://kc.local/realms/identificasus',
  KEYCLOAK_ADMIN_CLIENT_ID: 'admin-cli',
  KEYCLOAK_ADMIN_CLIENT_SECRET: 'segredo',
};

afterEach(() => {
  process.env = { ...ENV };
  vi.unstubAllGlobals();
});

function comFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(impl));
}

function resposta(status: number, corpo: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => corpo,
  } as Response;
}

describe('configurado', () => {
  it('exige emissor e credencial administrativa completos', () => {
    process.env = { ...ENV };
    expect(new Credencial().configurado()).toBe(false);
    Object.assign(process.env, CONFIGURADO);
    expect(new Credencial().configurado()).toBe(true);
  });
});

describe('trocarSenha', () => {
  it('recusa sem credencial administrativa no ambiente, sem chamar a rede', async () => {
    process.env = { ...ENV };
    const chamou = vi.fn();
    comFetch(async (...args) => { chamou(...args); return resposta(200, {}); });
    const r = await new Credencial().trocarSenha('sub-1', 'novaSenha123');
    expect(r).toEqual({ trocada: false, motivo: 'keycloak sem credencial administrativa no ambiente' });
    expect(chamou).not.toHaveBeenCalled();
  });

  it('recusa quando o keycloak nao concede o token administrativo', async () => {
    Object.assign(process.env, CONFIGURADO);
    comFetch(async () => resposta(401, {}));
    const r = await new Credencial().trocarSenha('sub-1', 'novaSenha123');
    expect(r).toEqual({ trocada: false, motivo: 'keycloak recusou a credencial administrativa' });
  });

  it('recusa quando a resposta do token nao tem access_token', async () => {
    Object.assign(process.env, CONFIGURADO);
    comFetch(async () => resposta(200, { token_type: 'bearer' }));
    const r = await new Credencial().trocarSenha('sub-1', 'novaSenha123');
    expect(r).toEqual({ trocada: false, motivo: 'keycloak recusou a credencial administrativa' });
  });

  it('recusa quando o reset de senha falha no keycloak', async () => {
    Object.assign(process.env, CONFIGURADO);
    let chamada = 0;
    comFetch(async () => {
      chamada += 1;
      return chamada === 1 ? resposta(200, { access_token: 'tok' }) : resposta(404, {});
    });
    const r = await new Credencial().trocarSenha('sub-1', 'novaSenha123');
    expect(r).toEqual({ trocada: false, motivo: 'keycloak respondeu 404' });
  });

  it('troca a senha quando o keycloak confirma', async () => {
    Object.assign(process.env, CONFIGURADO);
    let chamada = 0;
    comFetch(async () => {
      chamada += 1;
      return chamada === 1 ? resposta(200, { access_token: 'tok' }) : resposta(204, {});
    });
    const r = await new Credencial().trocarSenha('sub-1', 'novaSenha123');
    expect(r).toEqual({ trocada: true });
  });

  it('nunca lanca: falha de rede vira resposta { trocada: false }', async () => {
    Object.assign(process.env, CONFIGURADO);
    comFetch(async () => { throw new Error('ECONNREFUSED'); });
    const r = await new Credencial().trocarSenha('sub-1', 'novaSenha123');
    expect(r).toEqual({ trocada: false, motivo: 'keycloak: ECONNREFUSED' });
  });
});
