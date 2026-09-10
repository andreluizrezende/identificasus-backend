import { describe, expect, it, vi } from 'vitest';
import { compare } from 'bcryptjs';
import { CanalIndisponivel, CodigoRecusado, MuitosPedidos, RecuperacaoService } from './recuperacao.service';
import { PEDIDOS_POR_JANELA, RESPOSTA_NEUTRA } from './recuperacao.esquemas';
import type { BancoPorFinalidade } from '@/acesso/banco-por-finalidade.service';
import type { Correio } from '@/comum/correio';
import type { Credencial } from './credencial.service';
import type { AuditoriaService } from '@/modulos/auditoria/auditoria.service';

/**
 * Só `compare` é mockado; `hash` continua real. `pedirCodigo` grava um hash de
 * verdade e `confirmar` só precisa controlar se o código "bate" ou não — sem
 * pagar o custo de gerar um hash real a cada teste desse lado.
 */
vi.mock('bcryptjs', async (importarOriginal) => {
  const real = await importarOriginal<{ default?: typeof import('bcryptjs') } & typeof import('bcryptjs')>();
  const mod = real.default ?? real;
  return { ...mod, compare: vi.fn() };
});

const USUARIO = {
  id_usuario: 1, no_usuario: 'Ana', ds_email: 'ana@x.br', co_usuario_idp: 'idp-1', st_ativo: 'A',
};

function montar(opts: {
  correioConfigurado?: boolean;
  usuarioLinhas?: unknown[];
  recuperacaoLinhas?: unknown[];
  trocaOk?: boolean;
}) {
  const consultar = vi.fn().mockImplementation(async (_fin: string, sql: string) => {
    if (sql.includes('FROM mob_usuario')) return opts.usuarioLinhas ?? [USUARIO];
    if (sql.includes('FROM mob_recuperacao')) return opts.recuperacaoLinhas ?? [];
    return [];
  });
  const executar = vi.fn().mockResolvedValue({});
  const acesso = { consultar, executar } as unknown as BancoPorFinalidade;

  const correio = {
    configurado: vi.fn().mockReturnValue(opts.correioConfigurado ?? true),
    enviar: vi.fn().mockResolvedValue({ entregue: true }),
  } as unknown as Correio;

  const credencial = {
    trocarSenha: vi.fn().mockResolvedValue(
      opts.trocaOk === false ? { trocada: false, motivo: 'keycloak fora' } : { trocada: true },
    ),
  } as unknown as Credencial;

  const auditoria = { registrar: vi.fn().mockResolvedValue('hash') } as unknown as AuditoriaService;

  return { acesso, correio, credencial, auditoria, consultar, executar };
}

describe('pedirCodigo', () => {
  it('recusa antes de tocar no banco quando o canal de e-mail nao esta configurado', async () => {
    const { acesso, correio, credencial, auditoria, consultar } = montar({ correioConfigurado: false });
    const servico = new RecuperacaoService(acesso, correio, credencial, auditoria);
    await expect(
      servico.pedirCodigo({ ds_email: 'ana@x.br' }, '1.2.3.4'),
    ).rejects.toBeInstanceOf(CanalIndisponivel);
    expect(consultar).not.toHaveBeenCalled();
  });

  it('aplica o freio de pedidos por e-mail', async () => {
    const { acesso, correio, credencial, auditoria } = montar({});
    const servico = new RecuperacaoService(acesso, correio, credencial, auditoria);
    for (let i = 0; i < PEDIDOS_POR_JANELA; i += 1) {
      await servico.pedirCodigo({ ds_email: 'ana@x.br' }, '1.2.3.4');
    }
    await expect(
      servico.pedirCodigo({ ds_email: 'ana@x.br' }, '1.2.3.4'),
    ).rejects.toBeInstanceOf(MuitosPedidos);
  });

  it('conta inexistente devolve a resposta neutra sem gravar nem enviar nada', async () => {
    const { acesso, correio, credencial, auditoria, executar } = montar({ usuarioLinhas: [] });
    const servico = new RecuperacaoService(acesso, correio, credencial, auditoria);
    const r = await servico.pedirCodigo({ ds_email: 'ninguem@x.br' }, '1.2.3.4');
    expect(r).toEqual(RESPOSTA_NEUTRA);
    expect(executar).not.toHaveBeenCalled();
    expect(correio.enviar).not.toHaveBeenCalled();
  });

  it('conta inativa recebe a mesma resposta neutra de conta inexistente', async () => {
    const { acesso, correio, credencial, auditoria } = montar({
      usuarioLinhas: [{ ...USUARIO, st_ativo: 'I' }],
    });
    const servico = new RecuperacaoService(acesso, correio, credencial, auditoria);
    await expect(servico.pedirCodigo({ ds_email: 'ana@x.br' }, '1.2.3.4')).resolves.toEqual(RESPOSTA_NEUTRA);
  });

  it('conta valida: invalida pedidos anteriores, grava o codigo e envia — sempre resposta neutra', async () => {
    const { acesso, correio, credencial, auditoria, executar } = montar({});
    const servico = new RecuperacaoService(acesso, correio, credencial, auditoria);
    const r = await servico.pedirCodigo({ ds_email: 'ana@x.br' }, '1.2.3.4');
    expect(r).toEqual(RESPOSTA_NEUTRA);
    expect(executar).toHaveBeenCalledTimes(2); // invalida anteriores + insere o novo
    expect(correio.enviar).toHaveBeenCalledTimes(1);
    expect(auditoria.registrar).toHaveBeenCalledTimes(1);
  });

  it('falha ao entregar o e-mail nao muda a resposta (continua neutra)', async () => {
    const { acesso, correio, credencial, auditoria } = montar({});
    (correio.enviar as ReturnType<typeof vi.fn>).mockResolvedValue({ entregue: false, motivo: 'smtp fora' });
    const servico = new RecuperacaoService(acesso, correio, credencial, auditoria);
    await expect(servico.pedirCodigo({ ds_email: 'ana@x.br' }, '1.2.3.4')).resolves.toEqual(RESPOSTA_NEUTRA);
  });
});

describe('confirmar', () => {
  const dados = { ds_email: 'ana@x.br', co_codigo: '123456', nova_senha: 'senhaNova2027' };

  it('recusa quando o e-mail nao corresponde a conta ativa', async () => {
    const { acesso, correio, credencial, auditoria } = montar({ usuarioLinhas: [] });
    const servico = new RecuperacaoService(acesso, correio, credencial, auditoria);
    await expect(servico.confirmar(dados)).rejects.toBeInstanceOf(CodigoRecusado);
  });

  it('recusa quando nao ha pedido pendente e valido', async () => {
    const { acesso, correio, credencial, auditoria } = montar({ recuperacaoLinhas: [] });
    const servico = new RecuperacaoService(acesso, correio, credencial, auditoria);
    await expect(servico.confirmar(dados)).rejects.toBeInstanceOf(CodigoRecusado);
  });

  it('teto de tentativas esgotado queima o codigo e recusa', async () => {
    const { acesso, correio, credencial, auditoria, executar } = montar({
      recuperacaoLinhas: [{ id_recuperacao: 9, co_codigo_hash: 'hash', qt_tentativas: 5 }],
    });
    const servico = new RecuperacaoService(acesso, correio, credencial, auditoria);
    await expect(servico.confirmar(dados)).rejects.toBeInstanceOf(CodigoRecusado);
    expect(executar).toHaveBeenCalledTimes(1); // so o "queimar"
    expect(credencial.trocarSenha).not.toHaveBeenCalled();
  });

  it('codigo errado incrementa tentativas e recusa, sem trocar a senha', async () => {
    vi.mocked(compare).mockResolvedValue(false as never);
    const { acesso, correio, credencial, auditoria, executar } = montar({
      recuperacaoLinhas: [{ id_recuperacao: 9, co_codigo_hash: 'hash-nao-bate', qt_tentativas: 0 }],
    });
    const servico = new RecuperacaoService(acesso, correio, credencial, auditoria);
    await expect(servico.confirmar(dados)).rejects.toBeInstanceOf(CodigoRecusado);
    expect(executar).toHaveBeenCalledTimes(1); // incrementa tentativas
    expect(credencial.trocarSenha).not.toHaveBeenCalled();
  });

  it('quando a troca de senha falha no keycloak, sai como CanalIndisponivel', async () => {
    vi.mocked(compare).mockResolvedValue(true as never);
    const { acesso, correio, credencial, auditoria } = montar({
      recuperacaoLinhas: [{ id_recuperacao: 9, co_codigo_hash: 'hash-ok', qt_tentativas: 0 }],
      trocaOk: false,
    });
    const servico = new RecuperacaoService(acesso, correio, credencial, auditoria);
    await expect(servico.confirmar(dados)).rejects.toBeInstanceOf(CanalIndisponivel);
  });

  it('sucesso: queima o codigo, troca a senha e derruba sessoes antigas', async () => {
    vi.mocked(compare).mockResolvedValue(true as never);
    const { acesso, correio, credencial, auditoria, executar } = montar({
      recuperacaoLinhas: [{ id_recuperacao: 9, co_codigo_hash: 'hash-ok', qt_tentativas: 0 }],
      trocaOk: true,
    });
    const servico = new RecuperacaoService(acesso, correio, credencial, auditoria);
    const r = await servico.confirmar(dados);
    expect(r.sucesso).toBe(true);
    expect(credencial.trocarSenha).toHaveBeenCalledWith('idp-1', dados.nova_senha);
    // queimar (1) + st_credenciais_alteradas (1)
    expect(executar).toHaveBeenCalledTimes(2);
  });
});
