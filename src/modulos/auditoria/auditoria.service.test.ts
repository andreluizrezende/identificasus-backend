import { describe, expect, it, vi } from 'vitest';
import { ELO_GENESE, calcularElo } from '@/comum/hash-auditoria';
import type { EloAuditoria } from '@/comum/hash-auditoria';
import { AuditoriaService } from './auditoria.service';
import type { EventoAuditavel } from './auditoria.service';
import type { BancoPorFinalidade } from '@/acesso/banco-por-finalidade.service';

function bancoComTransacao(executar: ReturnType<typeof vi.fn>, consultar: ReturnType<typeof vi.fn>) {
  return {
    emTransacao: vi.fn(async (_fin: string, corpo: (...args: unknown[]) => unknown) =>
      corpo(executar, consultar)),
    consultar: vi.fn(),
  } as unknown as BancoPorFinalidade;
}

/** Os parâmetros do INSERT na trilha, pelo nome da coluna. */
const COLUNAS = [
  'co_elo', 'id_usuario', 'id_dispositivo', 'id_caso', 'co_finalidade', 'co_acao',
  'ds_recurso', 'ds_detalhe', 'co_hash_anterior', 'co_hash_atual', 'st_ocorrencia',
] as const;
type Gravado = Record<(typeof COLUNAS)[number], unknown>;

function gravado(executar: ReturnType<typeof vi.fn>): Gravado {
  const insert = executar.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO mob_auditoria'));
  const valores = (insert?.[1] ?? []) as unknown[];
  return Object.fromEntries(COLUNAS.map((c, i) => [c, valores[i]])) as Gravado;
}

async function registrarCom(anterior: string | null, evento: Partial<EventoAuditavel> = {}) {
  const executar = vi.fn().mockResolvedValue({});
  const consultar = vi.fn().mockResolvedValue([{ co_hash_atual: anterior }]);
  const atual = await new AuditoriaService(bancoComTransacao(executar, consultar)).registrar({
    usuarioId: 1, finalidade: 'ASSISTENCIAL', acao: 'CASO_CRIADO', recurso: 'mob_caso/1', detalhe: null, ...evento,
  });
  return { atual, linha: gravado(executar) };
}

/** A linha gravada como o banco a devolve (dateStrings, JSON como objeto). */
function comoOBancoDevolve(id: number, l: Gravado) {
  return {
    id_auditoria: id,
    co_elo: l.co_elo, id_usuario: l.id_usuario, id_dispositivo: l.id_dispositivo, id_caso: l.id_caso,
    co_finalidade: l.co_finalidade, co_acao: l.co_acao, ds_recurso: l.ds_recurso,
    ds_detalhe: l.ds_detalhe === null ? null : JSON.parse(String(l.ds_detalhe)),
    co_hash_anterior: l.co_hash_anterior, co_hash_atual: l.co_hash_atual,
    st_ocorrencia: `${String(l.st_ocorrencia)}000`, // DATETIME(6) devolve microssegundos
  };
}

function verificarSobre(linhas: unknown[]) {
  const acesso = { consultar: vi.fn().mockResolvedValue(linhas) } as unknown as BancoPorFinalidade;
  return new AuditoriaService(acesso).verificarCadeia();
}

describe('registrar', () => {
  it('encadeia a partir do elo anterior devolvido pela procedure', async () => {
    const { atual, linha } = await registrarCom('a'.repeat(64));
    expect(atual).toHaveLength(64);
    expect(linha.co_hash_anterior).toBe('a'.repeat(64));
  });

  it('usa ELO_GENESE quando ainda nao ha elo anterior', async () => {
    const { linha } = await registrarCom(null);
    expect(linha.co_hash_anterior).toBe(ELO_GENESE);
  });

  it('nao lanca quando a transacao falha: retorna null e nao derruba quem chamou', async () => {
    const acesso = { emTransacao: vi.fn().mockRejectedValue(new Error('deadlock')) } as unknown as BancoPorFinalidade;
    const r = await new AuditoriaService(acesso).registrar({
      usuarioId: 1, finalidade: 'ASSISTENCIAL', acao: 'X', recurso: 'y', detalhe: null,
    });
    expect(r).toBeNull();
  });

  it('detalhe null nao vira a string "null"', async () => {
    const { linha } = await registrarCom(null);
    expect(linha.ds_detalhe).toBeNull();
  });

  it('(!) grava o co_elo: o identificador que entra no hash', async () => {
    const { linha } = await registrarCom(null);
    expect(linha.co_elo).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('verificarCadeia — pela ordem', () => {
  function elo(id: string, extra: Partial<EloAuditoria> = {}): EloAuditoria {
    return {
      id, ocorridoEm: '2027-01-01T00:00:00.000Z', usuarioId: 1,
      finalidade: 'ASSISTENCIAL', acao: 'X', recurso: 'y', detalhe: null, ...extra,
    };
  }
  // Elos antigos (antes de db/09): sem co_elo, verificáveis só pela ordem.
  const antigo = (id: number, anterior: string, atual: string) =>
    ({ id_auditoria: id, co_elo: null, co_hash_anterior: anterior, co_hash_atual: atual });

  it('cadeia vazia e integra', async () => {
    await expect(verificarSobre([])).resolves.toEqual({
      integra: true, quebrouEm: null, motivo: null, elos: 0, peloConteudo: 0,
    });
  });

  it('reconhece uma cadeia integra de varios elos antigos', async () => {
    const e1 = calcularElo(ELO_GENESE, elo('1'));
    const e2 = calcularElo(e1, elo('2'));
    await expect(verificarSobre([antigo(1, ELO_GENESE, e1), antigo(2, e1, e2)])).resolves.toEqual({
      integra: true, quebrouEm: null, motivo: null, elos: 2, peloConteudo: 0,
    });
  });

  it('aponta onde a ordem quebra', async () => {
    const e1 = calcularElo(ELO_GENESE, elo('1'));
    await expect(verificarSobre([antigo(1, ELO_GENESE, e1), antigo(2, 'f'.repeat(64), 'g'.repeat(64))]))
      .resolves.toMatchObject({ integra: false, quebrouEm: 2, motivo: 'ordem' });
  });

  it('compara os hashes sem diferenciar maiusculas de minusculas', async () => {
    const e1 = calcularElo(ELO_GENESE, elo('1'));
    await expect(verificarSobre([antigo(1, ELO_GENESE.toUpperCase(), e1.toUpperCase())]))
      .resolves.toMatchObject({ integra: true });
  });
});

describe('verificarCadeia — pelo conteudo (elos com co_elo)', () => {
  async function doisElos() {
    const p = await registrarCom(null, { detalhe: { quantidade: 3, de: undefined }, dispositivoId: 4, casoId: 9 });
    const s = await registrarCom(String(p.atual), { usuarioId: 2, acao: 'regulacao_caso_consultado', casoId: 9 });
    return [comoOBancoDevolve(1, p.linha), comoOBancoDevolve(2, s.linha)] as const;
  }

  it('(!) o hash e recalculado a partir da propria linha gravada, e confere', async () => {
    await expect(verificarSobre([...await doisElos()])).resolves.toEqual({
      integra: true, quebrouEm: null, motivo: null, elos: 2, peloConteudo: 2,
    });
  });

  it.each([
    ['o autor', { id_usuario: 99 }],
    ['a acao', { co_acao: 'nada_aconteceu' }],
    ['o caso', { id_caso: 10 }],
    ['o aparelho', { id_dispositivo: 5 }],
    ['o detalhe', { ds_detalhe: { quantidade: 30 } }],
    ['o horario', { st_ocorrencia: '2020-01-01 00:00:00.000000' }],
  ])('(!) trocar %s de um evento e detectado, mesmo com a ordem intacta', async (_o, troca) => {
    const [primeiro, segundo] = await doisElos();
    await expect(verificarSobre([{ ...primeiro, ...troca }, segundo]))
      .resolves.toMatchObject({ integra: false, quebrouEm: 1, motivo: 'conteudo' });
  });

  it('cadeia mista: antigos so pela ordem, novos tambem pelo conteudo', async () => {
    const lAntigo = { id_auditoria: 0, co_elo: null, co_hash_anterior: ELO_GENESE, co_hash_atual: 'b'.repeat(64) };
    const p = await registrarCom('b'.repeat(64));
    await expect(verificarSobre([lAntigo, comoOBancoDevolve(1, p.linha)]))
      .resolves.toMatchObject({ integra: true, elos: 2, peloConteudo: 1 });
  });
});
