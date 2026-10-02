import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AdministracaoService } from './administracao.service';
import type { BancoPorFinalidade } from '@/acesso/banco-por-finalidade.service';
import type { AuditoriaService } from '@/modulos/auditoria/auditoria.service';

const LINHA_PROFISSIONAL = {
  id_usuario: 5, no_usuario: 'Pessoa de Teste', ds_email: 'p@exemplo.org', nu_cpf: '52998224725',
  ds_cargo: null, co_conselho: null, co_finalidade: 'ASSISTENCIAL', st_ativo: 'A', tem_senha: 0, perfis: 'CAMPO,SUPERVISAO',
};

/** Banco falso: `respostas` em ordem para consultar; executar devolve affectedRows/insertId. */
function montar(respostas: unknown[][] = [], afetadas = 1) {
  const consultar = vi.fn();
  for (const r of respostas) consultar.mockResolvedValueOnce(r);
  consultar.mockResolvedValue([]);
  const executar = vi.fn(async (_sql: string, _p?: unknown[]) => ({ affectedRows: afetadas, insertId: 77 }));
  const emTransacao = vi.fn(async (_f: string, fn: (e: typeof executar, c: typeof consultar) => unknown) => fn(executar, consultar));
  const acesso = { consultar, executar, emTransacao } as unknown as BancoPorFinalidade;
  const registrar = vi.fn().mockResolvedValue('hash');
  return {
    servico: new AdministracaoService(acesso, { registrar } as unknown as AuditoriaService),
    consultar, executar, emTransacao, registrar,
  };
}

const NOVO = {
  nome: 'Pessoa Nova', cpf: '52998224725', email: 'nova@exemplo.org', cargo: null, conselho: null,
  finalidade: 'ASSISTENCIAL' as const, perfis: ['CAMPO'],
};

describe('profissionais', () => {
  it('(!) a lista mostra o CPF mascarado e se o primeiro acesso já foi feito', async () => {
    const { servico, consultar } = montar([[LINHA_PROFISSIONAL]]);
    const [p] = await servico.profissionais();
    expect(p).toEqual({
      id: 5, nome: 'Pessoa de Teste', email: 'p@exemplo.org', cpf: '***.982.247-**', cargo: null, conselho: null,
      finalidade: 'ASSISTENCIAL', perfis: ['CAMPO', 'SUPERVISAO'], ativo: true, temSenha: false,
    });
    expect(consultar.mock.calls[0]?.[0]).toBe('ADMINISTRACAO');
  });

  it('(!) cria a conta SEM senha, com os perfis, e registra na trilha sem CPF', async () => {
    const { servico, executar, registrar } = montar([[], [{ id_perfil: 1, co_perfil: 'CAMPO', ds_perfil: 'Campo' }]]);
    expect(await servico.criarProfissional(NOVO, 9)).toEqual({ id: 77 });

    const insert = executar.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO mob_usuario '));
    expect(insert?.[0]).not.toMatch(/ds_senha_hash/);
    expect(executar.mock.calls.some(([sql, p]) => sql.startsWith('INSERT INTO mob_usuario_perfil') && p?.[1] === 1)).toBe(true);
    expect(registrar).toHaveBeenCalledWith(expect.objectContaining({ usuarioId: 9, acao: 'admin_profissional_criado' }));
    expect(JSON.stringify(registrar.mock.calls)).not.toMatch(/52998224725/);
  });

  it('CPF ou e-mail repetido: 409 dizendo qual, e nada gravado', async () => {
    const { servico, executar } = montar([[{ campo: 'email' }]]);
    await expect(servico.criarProfissional(NOVO, 9)).rejects.toThrow(ConflictException);
    expect(executar).not.toHaveBeenCalled();
  });

  it('perfil que não existe: 400, e nada gravado', async () => {
    const { servico, executar } = montar([[], []]);
    await expect(servico.criarProfissional({ ...NOVO, perfis: ['DIRETOR'] }, 9)).rejects.toThrow(BadRequestException);
    expect(executar).not.toHaveBeenCalled();
  });

  it('(!) ninguém desativa a própria conta nem tira de si a administração', async () => {
    const { servico, emTransacao } = montar();
    await expect(servico.alterarProfissional(9, { ativo: false }, 9)).rejects.toThrow(BadRequestException);
    await expect(servico.alterarProfissional(9, { finalidade: 'ASSISTENCIAL' }, 9)).rejects.toThrow(BadRequestException);
    expect(emTransacao).not.toHaveBeenCalled();
  });

  it('desativar outra pessoa: grava e registra antes e depois', async () => {
    const { servico, executar, registrar } = montar([[LINHA_PROFISSIONAL]]);
    await servico.alterarProfissional(5, { ativo: false }, 9);
    const update = executar.mock.calls.find(([sql]) => sql.startsWith('UPDATE mob_usuario'));
    expect(update?.[1]).toEqual(['I', null, 5]);
    expect(registrar).toHaveBeenCalledWith(expect.objectContaining({
      acao: 'admin_profissional_alterado',
      detalhe: expect.objectContaining({ antes: { ativo: true, finalidade: 'ASSISTENCIAL', perfis: ['CAMPO', 'SUPERVISAO'] } }),
    }));
  });

  it('trocar perfis apaga os antigos e grava os novos', async () => {
    const { servico, executar } = montar([[LINHA_PROFISSIONAL], [{ id_perfil: 3, co_perfil: 'SUPERVISAO', ds_perfil: 'S' }]]);
    await servico.alterarProfissional(5, { perfis: ['SUPERVISAO'] }, 9);
    const sqls = executar.mock.calls.map(([sql]) => sql);
    expect(sqls).toEqual(['DELETE FROM mob_usuario_perfil WHERE id_usuario = ?', 'INSERT INTO mob_usuario_perfil (id_usuario, id_perfil) VALUES (?, ?)']);
  });

  it('profissional inexistente: 404', async () => {
    const { servico } = montar([[]]);
    await expect(servico.alterarProfissional(404, { ativo: true }, 9)).rejects.toThrow(NotFoundException);
  });
});

describe('aparelhos', () => {
  it('cadastra numa base ativa', async () => {
    const { servico, executar, registrar } = montar([[{ id_base: 2, co_base: 'SAMU-01', no_base: 'Norte', st_ativo: 'A' }], []]);
    await servico.cadastrarAparelho({ codigo: 'TAB-0001', base: 'SAMU-01', modelo: null }, 9);
    expect(executar.mock.calls[0]?.[1]).toEqual([2, 'TAB-0001', null]);
    expect(registrar).toHaveBeenCalledWith(expect.objectContaining({ acao: 'admin_aparelho_cadastrado' }));
  });

  it('base inativa ou inexistente: 400; código repetido: 409', async () => {
    await expect(montar([[{ id_base: 2, co_base: 'X', no_base: 'X', st_ativo: 'I' }]]).servico
      .cadastrarAparelho({ codigo: 'TAB-1', base: 'X', modelo: null }, 9)).rejects.toThrow(BadRequestException);
    await expect(montar([[{ id_base: 2, co_base: 'X', no_base: 'X', st_ativo: 'A' }], [{ 1: 1 }]]).servico
      .cadastrarAparelho({ codigo: 'TAB-1', base: 'X', modelo: null }, 9)).rejects.toThrow(ConflictException);
  });

  it('(!) revogar só vale para aparelho ainda não revogado, e o motivo vai para a trilha', async () => {
    const { servico, executar, registrar } = montar();
    await servico.revogarAparelho('TAB-0001', { motivo: 'Tablet roubado na base.' }, 9);
    // Fora de transacao: acesso.executar(finalidade, sql, params).
    expect(executar.mock.calls[0]?.[0]).toBe('ADMINISTRACAO');
    expect(String(executar.mock.calls[0]?.[1])).toMatch(/AND st_revogacao IS NULL/);
    expect(registrar).toHaveBeenCalledWith(expect.objectContaining({
      acao: 'admin_aparelho_revogado', detalhe: { codigo: 'TAB-0001', motivo: 'Tablet roubado na base.' },
    }));

    const jaRevogado = montar([], 0);
    await expect(jaRevogado.servico.revogarAparelho('TAB-0001', { motivo: 'De novo, por engano.' }, 9)).rejects.toThrow(NotFoundException);
  });
});
