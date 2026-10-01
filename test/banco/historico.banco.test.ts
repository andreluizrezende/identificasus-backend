import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RowDataPacket } from 'mysql2/promise';
import { Credencial } from '@/modulos/recuperacao/credencial.service';
import type { BancoPorFinalidade } from '@/acesso/banco-por-finalidade.service';
import { acessoDeTeste, conexao, limparCenario, montarCenario } from './apoio';
import type { Cenario } from './apoio';

/**
 * Histórico de senhas contra o banco de verdade (db/07).
 *
 * (!) O QUE SÓ O BANCO PROVA: a troca roda como `nri_assistencial`, que só
 *     tem SELECT, INSERT e DELETE em mob_senha_historico e UPDATE por coluna
 *     em mob_usuario. Um grant faltando faz a transação inteira voltar — e a
 *     senha não muda, sem que um teste com banco simulado perceba.
 */
let acesso: BancoPorFinalidade;
let cen: Cenario;
let credencial: Credencial;
let email: string;

beforeAll(async () => {
  cen = await montarCenario('historico');
  email = `b-${cen.sufixo}@teste.local`;
  acesso = acessoDeTeste();
  credencial = new Credencial(acesso);
});

afterAll(async () => {
  await limparCenario(cen);
  await acesso.onModuleDestroy();
});

async function linhasNoHistorico(): Promise<number> {
  const c = await conexao();
  try {
    const [l] = await c.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS n FROM mob_senha_historico WHERE id_usuario = ?', [cen.idUsuarioB],
    );
    return Number((l[0] as { n: number }).n);
  } finally {
    await c.end();
  }
}

describe('histórico de senhas contra o banco', { timeout: 60_000 }, () => {
  it('a primeira senha não deixa nada no histórico', async () => {
    expect(await credencial.trocarSenha(cen.idUsuarioB, email, 'senha-um-2027')).toEqual({ trocada: true });
    expect(await linhasNoHistorico()).toBe(0);
  });

  it('cada troca guarda a que saiu, até o teto de 2 anteriores', async () => {
    expect(await credencial.trocarSenha(cen.idUsuarioB, email, 'senha-dois-2027')).toEqual({ trocada: true });
    expect(await linhasNoHistorico()).toBe(1);
    expect(await credencial.trocarSenha(cen.idUsuarioB, email, 'senha-tres-2027')).toEqual({ trocada: true });
    expect(await linhasNoHistorico()).toBe(2);
  });

  it('recusa a atual e as 2 anteriores', async () => {
    for (const repetida of ['senha-tres-2027', 'senha-dois-2027', 'senha-um-2027']) {
      expect(await credencial.trocarSenha(cen.idUsuarioB, email, repetida))
        .toMatchObject({ trocada: false, repetida: true });
    }
  });

  it('a quarta troca apaga a mais velha, que volta a ser aceita', async () => {
    expect(await credencial.trocarSenha(cen.idUsuarioB, email, 'senha-quatro-2027')).toEqual({ trocada: true });
    expect(await linhasNoHistorico()).toBe(2);
    // "um" saiu do histórico; "dois" e "três" continuam lá.
    expect(await credencial.trocarSenha(cen.idUsuarioB, email, 'senha-dois-2027'))
      .toMatchObject({ repetida: true });
    expect(await credencial.trocarSenha(cen.idUsuarioB, email, 'senha-um-2027')).toEqual({ trocada: true });
  });
});
