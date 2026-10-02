import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AutenticacaoIndisponivel, CredencialRecusada, DispositivoNaoAutorizado, SessaoEncerrada,
  SessaoService,
} from './sessao.service';
import { conferirSenha } from '@/acesso/senha';
import { AssinaturaIndisponivel, TokenRecusado } from '@/acesso/token.service';
import type { BancoPorFinalidade } from '@/acesso/banco-por-finalidade.service';
import type { AuditoriaService } from '@/modulos/auditoria/auditoria.service';
import type { TokenService } from '@/acesso/token.service';

/**
 * `conferirSenha` é mockado: o scrypt de verdade custa centenas de
 * milissegundos e já tem teste próprio em `acesso/senha.test.ts`. Aqui o que
 * importa é o que o serviço faz com o "confere" e o "não confere".
 */
vi.mock('@/acesso/senha', () => ({ conferirSenha: vi.fn() }));

// O token é simulado, mas a chave da fila deriva do segredo de verdade.
const SEGREDO_ANTES = process.env.JWT_SEGREDO;
beforeEach(() => {
  process.env.JWT_SEGREDO = 'segredo-de-teste-com-pelo-menos-trinta-e-dois-bytes';
});
afterEach(() => {
  vi.mocked(conferirSenha).mockReset();
  process.env.JWT_SEGREDO = SEGREDO_ANTES;
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
    expect(r.finalidade).toBe('ASSISTENCIAL');
    expect(emitir).toHaveBeenCalledWith({
      idUsuario: 5, finalidade: 'ASSISTENCIAL', dsEmail: 'ana@x.br', coSessao: r.coSessao,
    });
    expect(executar).toHaveBeenCalledTimes(1); // grava a sessao
    expect(auditoria.registrar).toHaveBeenCalledTimes(1);
  });

  describe('chave da fila local', () => {
    it('(!) conta de campo recebe a mesma chave em dois logins seguidos (sessoes diferentes)', async () => {
      const primeiro = await montar({}).servico.entrar(ENTRADA, '1.2.3.4');
      const segundo = await montar({}).servico.entrar(ENTRADA, '1.2.3.4');
      expect(primeiro.coSessao).not.toBe(segundo.coSessao);
      expect(primeiro.chaveFila).toBeTruthy();
      expect(segundo.chaveFila).toBe(primeiro.chaveFila);
    });

    it('conta da regulacao nao recebe chave: o console nao guarda nada no aparelho', async () => {
      const { servico } = montar({ usuarioLinhas: [{ ...USUARIO, co_finalidade: 'ADJUDICACAO' }] });
      const r = await servico.entrar(ENTRADA, '1.2.3.4');
      expect(r).not.toHaveProperty('chaveFila');
    });

    it('sem segredo para a chave: recusa antes de gravar a sessao', async () => {
      delete process.env.JWT_SEGREDO;
      const { servico, executar } = montar({});
      await expect(servico.entrar(ENTRADA, '1.2.3.4')).rejects.toBeInstanceOf(AutenticacaoIndisponivel);
      expect(executar).not.toHaveBeenCalled();
    });
  });
});

describe('renovar', () => {
  const RENOVAVEL = { idUsuario: 5, coSessao: 'sessao-1', emitidoEm: 2_000_000_000 };
  const CONTA = {
    ds_email: 'ana@x.br', co_finalidade: 'ASSISTENCIAL', st_ativo: 'A', st_credenciais_alteradas: null,
  };

  function montarRenovacao(opts: {
    renovavel?: unknown;
    conta?: unknown[];
    sessao?: unknown[];
  }) {
    const consultar = vi.fn().mockImplementation(async (_fin: string, sql: string) => {
      if (sql.includes('FROM mob_sessao')) return opts.sessao ?? [{ 1: 1 }];
      if (sql.includes('FROM mob_usuario')) return opts.conta ?? [CONTA];
      return [];
    });
    const acesso = { consultar, executar: vi.fn() } as unknown as BancoPorFinalidade;
    const verificarRenovacao = vi.fn(async () => {
      if (opts.renovavel instanceof Error) throw opts.renovavel;
      return opts.renovavel ?? RENOVAVEL;
    });
    const emitirAcesso = vi.fn().mockResolvedValue('acesso-novo');
    const token = { verificarRenovacao, emitirAcesso } as unknown as TokenService;
    const auditoria = { registrar: vi.fn() } as unknown as AuditoriaService;
    return { servico: new SessaoService(acesso, token, auditoria), consultar, emitirAcesso };
  }

  it('sessao viva: devolve token de acesso novo, com a finalidade atual do banco', async () => {
    const { servico, emitirAcesso } = montarRenovacao({
      conta: [{ ...CONTA, co_finalidade: 'AUDITORIA' }],
    });
    expect(await servico.renovar('r')).toEqual({ token: 'acesso-novo', expiraEmSegundos: 900 });
    expect(emitirAcesso).toHaveBeenCalledWith({
      idUsuario: 5, finalidade: 'AUDITORIA', dsEmail: 'ana@x.br', coSessao: 'sessao-1',
    });
  });

  it('token de renovacao invalido vira SessaoEncerrada, sem tocar no banco', async () => {
    const { servico, consultar } = montarRenovacao({ renovavel: new TokenRecusado('assinatura') });
    await expect(servico.renovar('r')).rejects.toBeInstanceOf(SessaoEncerrada);
    expect(consultar).not.toHaveBeenCalled();
  });

  it('conta desativada ou removida nao renova', async () => {
    await expect(montarRenovacao({ conta: [{ ...CONTA, st_ativo: 'I' }] }).servico.renovar('r'))
      .rejects.toBeInstanceOf(SessaoEncerrada);
    await expect(montarRenovacao({ conta: [] }).servico.renovar('r'))
      .rejects.toBeInstanceOf(SessaoEncerrada);
  });

  it('senha trocada depois do login nao renova', async () => {
    // Login em 2033-05-18 (emitidoEm 2e9 s); troca de senha em 2034.
    const { servico, emitirAcesso } = montarRenovacao({
      conta: [{ ...CONTA, st_credenciais_alteradas: '2034-01-01 00:00:00.000000' }],
    });
    await expect(servico.renovar('r')).rejects.toBeInstanceOf(SessaoEncerrada);
    expect(emitirAcesso).not.toHaveBeenCalled();
  });

  it('senha trocada ANTES do login nao atrapalha', async () => {
    const { servico } = montarRenovacao({
      conta: [{ ...CONTA, st_credenciais_alteradas: '2030-01-01 00:00:00.000000' }],
    });
    await expect(servico.renovar('r')).resolves.toMatchObject({ token: 'acesso-novo' });
  });

  it('sessao encerrada ("sair") ou vencida nao renova', async () => {
    const { servico, consultar } = montarRenovacao({ sessao: [] });
    await expect(servico.renovar('r')).rejects.toBeInstanceOf(SessaoEncerrada);
    const sql = String(consultar.mock.calls.find((c) => String(c[1]).includes('mob_sessao'))?.[1]);
    expect(sql).toMatch(/st_encerramento IS NULL/);
    expect(sql).toMatch(/st_expiracao > UTC_TIMESTAMP\(6\)/);
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
