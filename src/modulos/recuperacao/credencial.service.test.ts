import { describe, expect, it, vi } from 'vitest';
import { cifrarSenha, conferirSenha } from '@/acesso/senha';
import { Credencial } from './credencial.service';
import type { BancoPorFinalidade } from '@/acesso/banco-por-finalidade.service';

/**
 * Banco simulado com o estado que importa: o hash atual de mob_usuario e as
 * linhas de mob_senha_historico. As escritas da transação mexem nesse estado,
 * para os testes conferirem o resultado, e não a lista de SQL.
 */
function montar(opts: { atual?: string | null; anteriores?: string[]; falha?: Error } = {}) {
  const estado = {
    existe: true,
    atual: opts.atual ?? null,
    historico: (opts.anteriores ?? []).map((h, i) => ({ id_senha_historico: i + 1, ds_senha_hash: h })),
    carimbou: false,
  };
  let proximoId = estado.historico.length + 1;

  async function consultar(sql: string, p: unknown[] = []): Promise<unknown[]> {
    if (opts.falha) throw opts.falha;
    if (sql.includes('FROM mob_usuario')) return estado.existe ? [{ ds_senha_hash: estado.atual }] : [];
    if (sql.includes('FROM mob_senha_historico')) {
      const ordenado = [...estado.historico].sort((a, b) => b.id_senha_historico - a.id_senha_historico);
      return sql.includes('LIMIT') ? ordenado.slice(0, Number(p[1])) : ordenado;
    }
    return [];
  }
  async function executar(sql: string, p: unknown[] = []) {
    if (sql.startsWith('INSERT INTO mob_senha_historico')) {
      estado.historico.push({ id_senha_historico: proximoId++, ds_senha_hash: String(p[1]) });
    } else if (sql.includes('UPDATE mob_usuario')) {
      estado.atual = String(p[0]);
      estado.carimbou = sql.includes('st_credenciais_alteradas = UTC_TIMESTAMP(6)') && sql.includes('qt_falhas_login = 0');
    } else if (sql.includes('DELETE FROM mob_senha_historico')) {
      estado.historico = estado.historico.filter((l) => !p.includes(l.id_senha_historico));
    }
    return { affectedRows: 1 };
  }

  const acesso = {
    consultar: vi.fn((_f: string, sql: string, p?: unknown[]) => consultar(sql, p)),
    emTransacao: vi.fn((_f: string, corpo: (e: typeof executar, c: typeof consultar) => Promise<unknown>) =>
      corpo(executar, consultar)),
  } as unknown as BancoPorFinalidade;
  return { credencial: new Credencial(acesso), estado };
}

// Scrypt de verdade (centenas de ms por hash): o limite padrao de 5 s nao basta.
describe('trocarSenha', { timeout: 30_000 }, () => {
  it('grava o hash novo, carimba a troca, zera o freio e guarda a senha que saiu', async () => {
    const velha = await cifrarSenha('senhaAntiga2026');
    const { credencial, estado } = montar({ atual: velha });

    expect(await credencial.trocarSenha(5, 'ana@x.br', 'senhaNova2027')).toEqual({ trocada: true });

    expect(await conferirSenha('senhaNova2027', estado.atual)).toBe(true);
    expect(estado.atual).not.toContain('senhaNova2027');
    expect(estado.carimbou).toBe(true);
    expect(estado.historico.map((l) => l.ds_senha_hash)).toEqual([velha]);
  });

  it('recusa a senha atual como "nova"', async () => {
    const { credencial, estado } = montar({ atual: await cifrarSenha('mesmaSenha2027') });
    const r = await credencial.trocarSenha(5, 'ana@x.br', 'mesmaSenha2027');
    expect(r).toMatchObject({ trocada: false, repetida: true });
    expect(estado.historico).toEqual([]);
  });

  it('recusa qualquer uma das 2 anteriores guardadas', async () => {
    const { credencial } = montar({
      atual: await cifrarSenha('atual-2027-xyz'),
      anteriores: [await cifrarSenha('antiga-1-xyzw'), await cifrarSenha('antiga-2-xyzw')],
    });
    expect(await credencial.trocarSenha(5, 'ana@x.br', 'antiga-1-xyzw')).toMatchObject({ repetida: true });
    expect(await credencial.trocarSenha(5, 'ana@x.br', 'antiga-2-xyzw')).toMatchObject({ repetida: true });
  });

  it('guarda so as 2 anteriores: a mais velha sai a cada troca', async () => {
    const { credencial, estado } = montar({
      atual: await cifrarSenha('senha-c-2027'),
      anteriores: [await cifrarSenha('senha-a-2027'), await cifrarSenha('senha-b-2027')],
    });

    expect(await credencial.trocarSenha(5, 'ana@x.br', 'senha-d-2027')).toEqual({ trocada: true });

    expect(estado.historico).toHaveLength(2);
    // Saiu a "a"; ficaram "b" e "c" (a que acabou de sair).
    expect(await conferirSenha('senha-a-2027', estado.historico[0]?.ds_senha_hash ?? null)).toBe(false);
    const restantes = await Promise.all(estado.historico.map(async (l) => (
      (await conferirSenha('senha-b-2027', l.ds_senha_hash)) ? 'b'
        : (await conferirSenha('senha-c-2027', l.ds_senha_hash)) ? 'c' : '?'
    )));
    expect(restantes.sort()).toEqual(['b', 'c']);
    // E a "a", que saiu do historico, volta a ser aceita.
    expect(await credencial.trocarSenha(5, 'ana@x.br', 'senha-a-2027')).toEqual({ trocada: true });
  });

  it('conta que nunca teve senha nao deixa nada no historico', async () => {
    const { credencial, estado } = montar({ atual: null });
    expect(await credencial.trocarSenha(5, 'ana@x.br', 'primeiraSenha27')).toEqual({ trocada: true });
    expect(estado.historico).toEqual([]);
  });

  it('recusa senha fora da politica sem tocar no banco', async () => {
    const { credencial, estado } = montar();
    const r = await credencial.trocarSenha(5, 'ana@x.br', 'ana@x.br');
    expect(r.trocada).toBe(false);
    expect(estado.atual).toBeNull();
  });

  it('usuario que sumiu entre preparar e aplicar nao conta como trocada', async () => {
    const { credencial, estado } = montar();
    const preparo = await credencial.preparar(5, 'ana@x.br', 'senhaNova2027');
    estado.existe = false;
    expect(preparo.pronta).toBe(true);
    if (preparo.pronta) {
      expect(await credencial.aplicar(5, preparo.hash))
        .toEqual({ trocada: false, motivo: 'usuario nao encontrado' });
    }
  });

  it('nunca lanca: falha do banco vira resposta { trocada: false }', async () => {
    const { credencial } = montar({ falha: new Error('ECONNREFUSED') });
    expect(await credencial.trocarSenha(5, 'ana@x.br', 'senhaNova2027'))
      .toEqual({ trocada: false, motivo: 'banco: ECONNREFUSED' });
  });
});
