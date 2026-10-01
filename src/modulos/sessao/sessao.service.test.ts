import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AutenticacaoIndisponivel, CredencialRecusada, DispositivoNaoAutorizado, SessaoService,
} from './sessao.service';
import { conferirSenha } from '@/acesso/senha';
import { AssinaturaIndisponivel } from '@/acesso/token.service';
import type { BancoPorFinalidade } from '@/acesso/banco-por-finalidade.service';
import type { AuditoriaService } from '@/modulos/auditoria/auditoria.service';
import type { TokenService } from '@/acesso/token.service';

/**
 * `conferirSenha` é mockado: o scrypt de verdade custa centenas de
 * milissegundos e já tem teste próprio em `acesso/senha.test.ts`. Aqui o que
 * importa é o que o serviço faz com o "confere" e o "não confere".
 */
vi.mock('@/acesso/senha', () => ({ conferirSenha: vi.fn() }));

afterEach(() => {
  vi.mocked(conferirSenha).mockReset();
});

const DISPOSITIVO = { id_dispositivo: 1, co_dispositivo: 'D1', id_base: 2, no_base: 'Base 1' };
const USUARIO = {
  id_usuario: 5, no_usuario: 'Ana', ds_email: 'ana@x.br', st_ativo: 'A',
  ds_senha_hash: 'scrypt$hash', co_finalidade: 'ASSISTENCIAL', qt_falhas_login: 0, lg_bloqueado: 0,
};
const ENTRADA = { ds_email: 'ana@x.br', senha: 'CampoSamu2027!Ba', coDispositivo: 'D1' };

function montar(opts: {
  dispositivoLinhas?: unknown[];
  usuarioLinhas?: unknown[];
  perfilLinhas?: unknown[];
  senhaConfere?: boolean;
  emitir?: () => Promise<unknown>;
}) {
  vi.mocked(conferirSenha).mockResolvedValue(opts.senhaConfere ?? true);
  const consultar = vi.fn()
    .mockImplementation(async (_fin: string, sql: string) => {
      if (sql.includes('FROM mob_dispositivo')) return opts.dispositivoLinhas ?? [DISPOSITIVO];
      if (sql.includes('FROM mob_usuario_perfil')) return opts.perfilLinhas ?? [{ co_perfil: 'CAMPO' }];
      if (sql.includes('FROM mob_usuario')) return opts.usuarioLinhas ?? [USUARIO];
      return [];
    });
  const executar = vi.fn().mockResolvedValue({ affectedRows: 1 });
  const acesso = { consultar, executar } as unknown as BancoPorFinalidade;
  const emitir = vi.fn(opts.emitir ?? (async () => ({
    acesso: 'tok', renovacao: 'ref', expiraEmSegundos: 900,
  })));
  const token = { emitir } as unknown as TokenService;
  const auditoria = { registrar: vi.fn().mockResolvedValue('hash') } as unknown as AuditoriaService;
  const servico = new SessaoService(acesso, token, auditoria);
  return { servico, auditoria, consultar, executar, emitir };
}

function sqls(executar: ReturnType<typeof vi.fn>): string[] {
  return executar.mock.calls.map((c) => String(c[1]));
}

describe('entrar', () => {
  it('recusa aparelho nao autorizado ANTES de checar a senha', async () => {
    const { servico } = montar({ dispositivoLinhas: [] });
    await expect(servico.entrar(ENTRADA, '1.2.3.4')).rejects.toBeInstanceOf(DispositivoNaoAutorizado);
    expect(conferirSenha).not.toHaveBeenCalled();
  });

  it('senha errada vira CredencialRecusada e conta uma falha', async () => {
    const { servico, executar, emitir } = montar({ senhaConfere: false });
    await expect(servico.entrar(ENTRADA, '1.2.3.4')).rejects.toBeInstanceOf(CredencialRecusada);
    expect(sqls(executar)).toEqual([expect.stringMatching(/qt_falhas_login = LEAST/)]);
    expect(emitir).not.toHaveBeenCalled();
  });

  it('e-mail desconhecido: mesma recusa, e o hash e calculado mesmo assim', async () => {
    const { servico, executar } = montar({ usuarioLinhas: [], senhaConfere: false });
    await expect(servico.entrar(ENTRADA, '1.2.3.4')).rejects.toBeInstanceOf(CredencialRecusada);
    // Sem isto, o tempo de resposta separaria conta inexistente de senha errada.
    expect(conferirSenha).toHaveBeenCalledWith(ENTRADA.senha, null);
    expect(executar).not.toHaveBeenCalled();
  });

  it('conta bloqueada recusa ate a senha certa, sem contar falha nova', async () => {
    const { servico, executar } = montar({
      usuarioLinhas: [{ ...USUARIO, lg_bloqueado: 1 }], senhaConfere: true,
    });
    await expect(servico.entrar(ENTRADA, '1.2.3.4')).rejects.toBeInstanceOf(CredencialRecusada);
    expect(executar).not.toHaveBeenCalled();
  });

  it('conta inativa recusa com a mesma resposta da senha errada', async () => {
    const { servico } = montar({ usuarioLinhas: [{ ...USUARIO, st_ativo: 'I' }] });
    await expect(servico.entrar(ENTRADA, '1.2.3.4')).rejects.toBeInstanceOf(CredencialRecusada);
  });

  it('sem JWT_SEGREDO vira AutenticacaoIndisponivel, e nenhuma sessao e gravada', async () => {
    const { servico, executar } = montar({
      emitir: async () => { throw new AssinaturaIndisponivel('sem segredo'); },
    });
    await expect(servico.entrar(ENTRADA, '1.2.3.4')).rejects.toBeInstanceOf(AutenticacaoIndisponivel);
    expect(sqls(executar).some((s) => s.includes('mob_sessao'))).toBe(false);
  });

  it('acerto depois de erros zera o contador de falhas', async () => {
    const { servico, executar } = montar({ usuarioLinhas: [{ ...USUARIO, qt_falhas_login: 3 }] });
    await servico.entrar(ENTRADA, '1.2.3.4');
    expect(sqls(executar)[0]).toMatch(/qt_falhas_login = 0/);
  });

  it('abre a sessao e devolve o pacote completo quando tudo bate', async () => {
    const { servico, auditoria, executar, emitir } = montar({});
    const r = await servico.entrar(ENTRADA, '1.2.3.4');

    expect(r.token).toBe('tok');
    expect(r.renovacao).toBe('ref');
    expect(r.expiraEmSegundos).toBe(900);
    expect(r.usuario).toEqual({ id: 5, no_usuario: 'Ana', ds_email: 'ana@x.br', perfis: ['CAMPO'] });
    expect(r.dispositivo).toEqual({ co_dispositivo: 'D1', id_base: 2, no_base: 'Base 1' });
    expect(emitir).toHaveBeenCalledWith({
      idUsuario: 5, finalidade: 'ASSISTENCIAL', dsEmail: 'ana@x.br', coSessao: r.coSessao,
    });
    expect(executar).toHaveBeenCalledTimes(1); // grava a sessao
    expect(auditoria.registrar).toHaveBeenCalledTimes(1);
  });
});

describe('sair', () => {
  it('so audita quando alguma sessao foi de fato encerrada', async () => {
    const { servico, auditoria, executar } = montar({});
    executar.mockResolvedValue({ affectedRows: 0 });
    await servico.sair(5, 'sessao-x');
    expect(auditoria.registrar).not.toHaveBeenCalled();
  });

  it('audita quando a sessao existia e foi encerrada', async () => {
    const { servico, auditoria, executar } = montar({});
    executar.mockResolvedValue({ affectedRows: 1 });
    await servico.sair(5, 'sessao-x');
    expect(auditoria.registrar).toHaveBeenCalledTimes(1);
  });
});
