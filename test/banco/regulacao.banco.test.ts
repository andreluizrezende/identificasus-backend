import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { AuditoriaService } from '@/modulos/auditoria/auditoria.service';
import { RegulacaoService } from '@/modulos/regulacao/regulacao.service';
import type { BancoPorFinalidade } from '@/acesso/banco-por-finalidade.service';
import { acessoDeTeste, conexao, limparCenario, montarCenario } from './apoio';
import type { Cenario } from './apoio';

/**
 * Fila da regulação contra o banco de verdade.
 *
 * (!) A CONSULTA RODA COMO nri_adjudicacao, com os grants de db/08. Um grant
 *     faltando aparece aqui como falha, e não no console em produção.
 */
let acesso: BancoPorFinalidade;
let cen: Cenario;
let regulacao: RegulacaoService;
const casos: Record<string, string> = {};

async function criarCaso(rotulo: string, stCaso: string, dtPrazo: string | null): Promise<void> {
  const coCaso = `RG-${cen.sufixo}-${rotulo}`.slice(0, 20);
  const c = await conexao();
  try {
    await c.query<ResultSetHeader>(
      `INSERT INTO mob_caso (co_caso, id_base, id_usuario_abertura, st_caso,
                             dt_ocorrencia, hr_ocorrencia, dt_prazo)
       VALUES (?, ?, ?, ?, '2026-09-30', '22:00:00', ?)`,
      [coCaso, cen.idBase, cen.idUsuarioA, stCaso, dtPrazo],
    );
  } finally {
    await c.end();
  }
  casos[rotulo] = coCaso;
}

/** Um atributo controlado e uma transição de estado no caso, como o campo deixaria. */
async function enriquecer(coCaso: string): Promise<void> {
  const c = await conexao();
  try {
    await c.query(
      `INSERT INTO mob_caso_atributo (id_caso, id_tipo_atributo, id_procedencia, id_vocabulario, id_usuario)
       SELECT ca.id_caso, v.id_tipo_atributo, (SELECT MIN(id_procedencia) FROM mob_procedencia),
              v.id_vocabulario, ?
         FROM mob_caso ca, mob_vocabulario v
        WHERE ca.co_caso = ?
        ORDER BY v.id_vocabulario LIMIT 1`,
      [cen.idUsuarioA, coCaso],
    );
    await c.query(
      `INSERT INTO mob_caso_estado (id_caso, st_anterior, st_atual, id_usuario, ds_motivo)
       SELECT id_caso, 'ENRIQUECIMENTO', 'ANALISE', ?, 'enviado para a regulacao'
         FROM mob_caso WHERE co_caso = ?`,
      [cen.idUsuarioA, coCaso],
    );
  } finally {
    await c.end();
  }
}

/** Quantos eventos desta ação, deste usuário, a trilha tem. */
async function naTrilha(acao: string): Promise<number> {
  const c = await conexao();
  try {
    const [l] = await c.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM mob_auditoria
        WHERE id_usuario = ? AND co_finalidade = 'ADJUDICACAO' AND co_acao = ?`,
      [cen.idUsuarioA, acao],
    );
    return Number(l[0]?.n);
  } finally {
    await c.end();
  }
}

beforeAll(async () => {
  cen = await montarCenario('regul');
  acesso = acessoDeTeste();
  regulacao = new RegulacaoService(acesso, new AuditoriaService(acesso));
  await criarCaso('A', 'ANALISE', '2030-01-10');
  await criarCaso('B', 'ADJUDICACAO', '2030-01-05');
  await criarCaso('C', 'ANALISE', null);
  await criarCaso('D', 'ABERTO', '2030-01-01'); // ainda no campo: fora da fila
  await criarCaso('E', 'RESOLVIDO', '2030-01-01'); // já decidido: fora da fila
  await enriquecer(casos.A ?? '');
});

afterAll(async () => {
  await limparCenario(cen);
  await acesso.onModuleDestroy();
});

describe('fila da regulação contra o banco', () => {
  it('traz só ANALISE e ADJUDICACAO, por prazo, sem prazo por último', async () => {
    const fila = (await regulacao.fila(cen.idUsuarioA))
      .filter((i) => Object.values(casos).includes(i.coCaso));
    expect(fila.map((i) => i.coCaso)).toEqual([casos.B, casos.A, casos.C]);
    expect(fila[0]).toMatchObject({ stCaso: 'ADJUDICACAO', noBase: `Base de teste ${cen.sufixo}` });
    expect(typeof fila[0]?.diasParaPrazo).toBe('number');
    expect(fila[2]?.diasParaPrazo).toBeNull();
  });

  it('a consulta da fila fica na trilha', async () => {
    const antes = await naTrilha('regulacao_fila_consultada');
    await regulacao.fila(cen.idUsuarioA);
    expect(await naTrilha('regulacao_fila_consultada')).toBe(antes + 1);
  });
});

describe('detalhe do caso contra o banco', () => {
  it('traz atributo com procedência e autor, e o histórico, só com os grants de db/08', async () => {
    const caso = await regulacao.caso(casos.A ?? '', cen.idUsuarioA);
    expect(caso).toMatchObject({ coCaso: casos.A, stCaso: 'ANALISE' });
    expect(caso.atributos).toHaveLength(1);
    expect(caso.atributos[0]).toMatchObject({ valor: expect.any(String), coProcedencia: expect.any(String) });
    expect(caso.atributos[0]?.noAutor).toBeTruthy();
    expect(caso.historico).toEqual([
      expect.objectContaining({ stAnterior: 'ENRIQUECIMENTO', stAtual: 'ANALISE', dsMotivo: 'enviado para a regulacao' }),
    ]);
  });

  it('caso fora da fila não abre', async () => {
    await expect(regulacao.caso(casos.D ?? '', cen.idUsuarioA)).rejects.toMatchObject({ status: 404 });
    await expect(regulacao.caso(casos.E ?? '', cen.idUsuarioA)).rejects.toMatchObject({ status: 404 });
  });

  it('a leitura do caso fica na trilha', async () => {
    const antes = await naTrilha('regulacao_caso_consultado');
    await regulacao.caso(casos.B ?? '', cen.idUsuarioA);
    expect(await naTrilha('regulacao_caso_consultado')).toBe(antes + 1);
  });
});
