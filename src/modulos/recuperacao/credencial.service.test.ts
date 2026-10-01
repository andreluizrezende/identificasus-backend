import { describe, expect, it, vi } from 'vitest';
import { conferirSenha } from '@/acesso/senha';
import { Credencial } from './credencial.service';
import type { BancoPorFinalidade } from '@/acesso/banco-por-finalidade.service';

function montar(executar = vi.fn().mockResolvedValue({ affectedRows: 1 })) {
  const acesso = { executar } as unknown as BancoPorFinalidade;
  return { credencial: new Credencial(acesso), executar };
}

describe('trocarSenha', () => {
  it('grava o hash, carimba a troca e zera o freio numa instrucao so', async () => {
    const { credencial, executar } = montar();
    const r = await credencial.trocarSenha(5, 'ana@x.br', 'senhaNova2027');
    expect(r).toEqual({ trocada: true });
    expect(executar).toHaveBeenCalledTimes(1);

    const [, sql, params] = executar.mock.calls[0] as [string, string, unknown[]];
    expect(sql).toMatch(/ds_senha_hash = \?/);
    expect(sql).toMatch(/st_credenciais_alteradas = NOW\(6\)/);
    expect(sql).toMatch(/qt_falhas_login = 0/);
    const [hash, id] = params as [string, number];
    expect(id).toBe(5);
    // O que vai ao banco e o hash, nunca a senha.
    expect(hash).not.toContain('senhaNova2027');
    expect(await conferirSenha('senhaNova2027', hash)).toBe(true);
  });

  it('recusa senha fora da politica sem tocar no banco', async () => {
    const { credencial, executar } = montar();
    const r = await credencial.trocarSenha(5, 'ana@x.br', 'ana@x.br');
    expect(r.trocada).toBe(false);
    expect(executar).not.toHaveBeenCalled();
  });

  it('usuario que sumiu entre a consulta e a troca nao conta como trocada', async () => {
    const { credencial } = montar(vi.fn().mockResolvedValue({ affectedRows: 0 }));
    expect(await credencial.trocarSenha(5, 'ana@x.br', 'senhaNova2027'))
      .toEqual({ trocada: false, motivo: 'usuario nao encontrado' });
  });

  it('nunca lanca: falha do banco vira resposta { trocada: false }', async () => {
    const { credencial } = montar(vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    expect(await credencial.trocarSenha(5, 'ana@x.br', 'senhaNova2027'))
      .toEqual({ trocada: false, motivo: 'banco: ECONNREFUSED' });
  });
});
