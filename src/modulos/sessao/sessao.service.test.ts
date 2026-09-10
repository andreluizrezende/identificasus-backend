import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AutenticacaoIndisponivel, CredencialRecusada, DispositivoNaoAutorizado, SessaoService,
} from './sessao.service';
import type { BancoPorFinalidade } from '@/acesso/banco-por-finalidade.service';
import type { AuditoriaService } from '@/modulos/auditoria/auditoria.service';
import type { Portador, TokenService } from '@/acesso/token.service';

const ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ENV };
  vi.unstubAllGlobals();
});

const DISPOSITIVO = { id_dispositivo: 1, co_dispositivo: 'D1', id_base: 2, no_base: 'Base 1' };
const USUARIO = { id_usuario: 5, no_usuario: 'Ana', ds_email: 'ana@x.br', st_ativo: 'A' };
const PORTADOR: Portador = { sub: 'sub-1', emitidoEm: 100, purpose: 'ASSISTENCIAL', ds_email: 'ana@x.br' };

function montar(opts: {
  dispositivoLinhas?: unknown[];
  usuarioLinhas?: unknown[];
  perfilLinhas?: unknown[];
  portador?: Portador;
}) {
  const consultar = vi.fn()
    .mockImplementation(async (_fin: string, sql: string) => {
      if (sql.includes('FROM mob_dispositivo')) return opts.dispositivoLinhas ?? [DISPOSITIVO];
      if (sql.includes('FROM mob_usuario_perfil')) return opts.perfilLinhas ?? [{ co_perfil: 'CAMPO' }];
      if (sql.includes('FROM mob_usuario')) return opts.usuarioLinhas ?? [USUARIO];
      return [];
    });
  const executar = vi.fn().mockResolvedValue({ affectedRows: 1 });
  const acesso = { consultar, executar } as unknown as BancoPorFinalidade;
  const token = { verificar: vi.fn().mockResolvedValue(opts.portador ?? PORTADOR) } as unknown as TokenService;
  const auditoria = { registrar: vi.fn().mockResolvedValue('hash') } as unknown as AuditoriaService;
  return { acesso, token, auditoria, consultar, executar };
}

function fetchQue(respostas: Array<{ status: number; corpo: unknown }>) {
  let i = 0;
  vi.stubGlobal('fetch', vi.fn(async () => {
    const r = respostas[Math.min(i, respostas.length - 1)] as { status: number; corpo: unknown };
    i += 1;
    return {
      ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.corpo,
    } as Response;
  }));
}

describe('entrar', () => {
  it('recusa aparelho nao autorizado ANTES de checar a senha', async () => {
    process.env.OIDC_ISSUER = 'https://kc.local';
    const chamouFetch = vi.fn();
    vi.stubGlobal('fetch', chamouFetch);
    const { acesso, token, auditoria } = montar({ dispositivoLinhas: [] });

    await expect(
      new SessaoService(acesso, token, auditoria).entrar(
        { ds_email: 'ana@x.br', senha: 'x', coDispositivo: 'D1' }, '1.2.3.4',
      ),
    ).rejects.toBeInstanceOf(DispositivoNaoAutorizado);
    expect(chamouFetch).not.toHaveBeenCalled();
  });

  it('senha ou e-mail errados (400/401 do keycloak) viram CredencialRecusada', async () => {
    process.env.OIDC_ISSUER = 'https://kc.local';
    fetchQue([{ status: 401, corpo: {} }]);
    const { acesso, token, auditoria } = montar({});

    await expect(
      new SessaoService(acesso, token, auditoria).entrar(
        { ds_email: 'ana@x.br', senha: 'errada', coDispositivo: 'D1' }, '1.2.3.4',
      ),
    ).rejects.toBeInstanceOf(CredencialRecusada);
  });

  it('keycloak fora do ar (5xx) vira AutenticacaoIndisponivel, nao CredencialRecusada', async () => {
    process.env.OIDC_ISSUER = 'https://kc.local';
    fetchQue([{ status: 503, corpo: {} }]);
    const { acesso, token, auditoria } = montar({});

    await expect(
      new SessaoService(acesso, token, auditoria).entrar(
        { ds_email: 'ana@x.br', senha: 'x', coDispositivo: 'D1' }, '1.2.3.4',
      ),
    ).rejects.toBeInstanceOf(AutenticacaoIndisponivel);
  });

  it('falha de rede ao falar com o keycloak vira AutenticacaoIndisponivel', async () => {
    process.env.OIDC_ISSUER = 'https://kc.local';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    const { acesso, token, auditoria } = montar({});

    await expect(
      new SessaoService(acesso, token, auditoria).entrar(
        { ds_email: 'ana@x.br', senha: 'x', coDispositivo: 'D1' }, '1.2.3.4',
      ),
    ).rejects.toBeInstanceOf(AutenticacaoIndisponivel);
  });

  it('credencial boa no keycloak mas sem linha local: recusa como CredencialRecusada', async () => {
    process.env.OIDC_ISSUER = 'https://kc.local';
    fetchQue([{ status: 200, corpo: { access_token: 't', refresh_token: 'r', expires_in: 900 } }]);
    const { acesso, token, auditoria } = montar({ usuarioLinhas: [] });

    await expect(
      new SessaoService(acesso, token, auditoria).entrar(
        { ds_email: 'ana@x.br', senha: 'x', coDispositivo: 'D1' }, '1.2.3.4',
      ),
    ).rejects.toBeInstanceOf(CredencialRecusada);
  });

  it('abre a sessao e devolve o pacote completo quando tudo bate', async () => {
    process.env.OIDC_ISSUER = 'https://kc.local';
    fetchQue([{ status: 200, corpo: { access_token: 'tok', refresh_token: 'ref', expires_in: 900 } }]);
    const { acesso, token, auditoria, executar } = montar({});

    const r = await new SessaoService(acesso, token, auditoria).entrar(
      { ds_email: 'ana@x.br', senha: 'x', coDispositivo: 'D1' }, '1.2.3.4',
    );

    expect(r.token).toBe('tok');
    expect(r.renovacao).toBe('ref');
    expect(r.expiraEmSegundos).toBe(900);
    expect(r.usuario).toEqual({ id: 5, no_usuario: 'Ana', ds_email: 'ana@x.br', perfis: ['CAMPO'] });
    expect(r.dispositivo).toEqual({ co_dispositivo: 'D1', id_base: 2, no_base: 'Base 1' });
    expect(executar).toHaveBeenCalledTimes(1); // grava a sessao
    expect(auditoria.registrar).toHaveBeenCalledTimes(1);
  });
});

describe('sair', () => {
  it('so audita quando alguma sessao foi de fato encerrada', async () => {
    const { acesso, token, auditoria } = montar({});
    (acesso.executar as ReturnType<typeof vi.fn>).mockResolvedValue({ affectedRows: 0 });
    await new SessaoService(acesso, token, auditoria).sair(5, 'sessao-x');
    expect(auditoria.registrar).not.toHaveBeenCalled();
  });

  it('audita quando a sessao existia e foi encerrada', async () => {
    const { acesso, token, auditoria } = montar({});
    (acesso.executar as ReturnType<typeof vi.fn>).mockResolvedValue({ affectedRows: 1 });
    await new SessaoService(acesso, token, auditoria).sair(5, 'sessao-x');
    expect(auditoria.registrar).toHaveBeenCalledTimes(1);
  });
});
