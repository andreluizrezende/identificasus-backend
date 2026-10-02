import { describe, expect, it, vi } from 'vitest';
import { ESTADOS_DA_FILA, LIMITE_DA_FILA, RegulacaoService } from './regulacao.service';
import type { BancoPorFinalidade } from '@/acesso/banco-por-finalidade.service';
import type { AuditoriaService } from '@/modulos/auditoria/auditoria.service';

function montar(linhas: unknown[]) {
  const consultar = vi.fn().mockResolvedValue(linhas);
  const acesso = { consultar } as unknown as BancoPorFinalidade;
  const registrar = vi.fn().mockResolvedValue('hash');
  const auditoria = { registrar } as unknown as AuditoriaService;
  return { servico: new RegulacaoService(acesso, auditoria), consultar, registrar };
}

const LINHA = {
  co_caso: 'NN-2026-ABCDEFGH', st_caso: 'ANALISE', no_base: 'Base Centro',
  dt_ocorrencia: '2026-09-30', hr_ocorrencia: '22:15:00', qt_completude: '64',
  dt_prazo: '2026-10-03', dias_para_prazo: '2',
};

describe('fila da regulacao', () => {
  it('consulta pelo pool de ADJUDICACAO, so os estados da fila, por prazo e com teto', async () => {
    const { servico, consultar } = montar([]);
    await servico.fila(7);
    const [finalidade, sql, params] = consultar.mock.calls[0] as [string, string, unknown[]];
    expect(finalidade).toBe('ADJUDICACAO');
    expect(params).toEqual([...ESTADOS_DA_FILA, LIMITE_DA_FILA]);
    expect(sql).toMatch(/ORDER BY \(c\.dt_prazo IS NULL\), c\.dt_prazo/);
    // Prazo em dias calculado em UTC, como o resto das datas comparadas.
    expect(sql).toMatch(/UTC_DATE\(\)/);
  });

  it('nao traz local da ocorrencia nem atributos (minimizacao)', async () => {
    const { servico, consultar } = montar([]);
    await servico.fila(7);
    const sql = String(consultar.mock.calls[0]?.[1]);
    expect(sql).not.toMatch(/ds_local|mob_caso_atributo|vl_latitude/);
  });

  it('converte a linha do banco no item da fila, com numeros de verdade', async () => {
    const { servico } = montar([LINHA, { ...LINHA, co_caso: 'NN-2026-SEMPRAZO', dt_prazo: null, dias_para_prazo: null }]);
    const fila = await servico.fila(7);
    expect(fila[0]).toEqual({
      coCaso: 'NN-2026-ABCDEFGH', stCaso: 'ANALISE', noBase: 'Base Centro',
      dtOcorrencia: '2026-09-30', hrOcorrencia: '22:15:00', qtCompletude: 64,
      dtPrazo: '2026-10-03', diasParaPrazo: 2,
    });
    expect(fila[1]).toMatchObject({ dtPrazo: null, diasParaPrazo: null });
  });

  it('cada consulta vai para a trilha, com quem consultou e quantos casos viu', async () => {
    const { servico, registrar } = montar([LINHA, LINHA, LINHA]);
    await servico.fila(7);
    expect(registrar).toHaveBeenCalledWith({
      usuarioId: 7,
      finalidade: 'ADJUDICACAO',
      acao: 'regulacao_fila_consultada',
      recurso: 'regulacao/fila',
      detalhe: { quantidade: 3 },
    });
  });
});

describe('detalhe do caso para a regulacao', () => {
  const CASO = {
    ...LINHA, id_caso: 42, co_ocorrencia_samu: 'OC-123', ds_local: 'Av. Sete, 100', ds_destino: 'HGE',
  };
  const ATRIBUTO = {
    co_atributo: 'SEXO', no_atributo: 'Sexo', co_grupo: 'FISICO', no_grupo: 'Características físicas',
    ds_valor: null, vl_numerico: null, dt_valor: null, no_termo: 'Masculino',
    co_procedencia: 'OBSERVADO', ds_procedencia: 'Observado pela equipe',
    st_captura: '2026-09-30 22:20:00.000000', no_usuario: 'Ana',
  };
  const TRANSICAO = {
    st_anterior: 'ENRIQUECIMENTO', st_atual: 'ANALISE', ds_motivo: null,
    st_transicao: '2026-09-30 23:00:00.000000', no_usuario: null,
  };

  function montarDetalhe(caso: unknown[], atributos: unknown[] = [], historico: unknown[] = []) {
    const consultar = vi.fn()
      .mockResolvedValueOnce(caso)
      .mockResolvedValueOnce(atributos)
      .mockResolvedValueOnce(historico);
    const acesso = { consultar } as unknown as BancoPorFinalidade;
    const registrar = vi.fn().mockResolvedValue('hash');
    const auditoria = { registrar } as unknown as AuditoriaService;
    return { servico: new RegulacaoService(acesso, auditoria), consultar, registrar };
  }

  it('so abre caso que esta na fila, e tudo pelo pool de ADJUDICACAO', async () => {
    const { servico, consultar } = montarDetalhe([CASO]);
    await servico.caso('NN-2026-ABCDEFGH', 7);
    const [finalidade, sql, params] = consultar.mock.calls[0] as [string, string, unknown[]];
    expect(finalidade).toBe('ADJUDICACAO');
    expect(sql).toMatch(/c\.st_caso IN \(\?, \?\)/);
    expect(params).toEqual(['NN-2026-ABCDEFGH', ...ESTADOS_DA_FILA]);
    expect(consultar.mock.calls.every((c) => c[0] === 'ADJUDICACAO')).toBe(true);
  });

  it('caso inexistente ou fora da fila da a mesma resposta, e nao vai para a trilha', async () => {
    const { servico, registrar } = montarDetalhe([]);
    await expect(servico.caso('NN-2026-NAOEXISTE', 7)).rejects.toMatchObject({ status: 404 });
    expect(registrar).not.toHaveBeenCalled();
  });

  it('monta atributos com procedencia e autor, e o historico', async () => {
    const { servico } = montarDetalhe([CASO], [ATRIBUTO, { ...ATRIBUTO, no_termo: null, vl_numerico: '1.720' }, { ...ATRIBUTO, no_termo: null, vl_numerico: '1250.000' }], [TRANSICAO]);
    const caso = await servico.caso('NN-2026-ABCDEFGH', 7);
    expect(caso).toMatchObject({
      coCaso: 'NN-2026-ABCDEFGH', qtCompletude: 64, diasParaPrazo: 2,
      coOcorrenciaSamu: 'OC-123', dsLocal: 'Av. Sete, 100', dsDestino: 'HGE',
    });
    expect(caso.atributos[0]).toEqual({
      coAtributo: 'SEXO', noAtributo: 'Sexo', coGrupo: 'FISICO', noGrupo: 'Características físicas',
      valor: 'Masculino', coProcedencia: 'OBSERVADO', dsProcedencia: 'Observado pela equipe',
      capturadoEm: '2026-09-30 22:20:00.000000', noAutor: 'Ana',
    });
    // DECIMAL cru ("1.720") se leria como mil e setecentos: sai no formato brasileiro.
    expect(caso.atributos[1]?.valor).toBe('1,72');
    expect(caso.atributos[2]?.valor).toBe('1.250');
    expect(caso.historico).toEqual([{
      stAnterior: 'ENRIQUECIMENTO', stAtual: 'ANALISE', dsMotivo: null,
      ocorridaEm: '2026-09-30 23:00:00.000000', noAutor: null,
    }]);
  });

  it('a leitura vai para a trilha com o caso lido', async () => {
    const { servico, registrar } = montarDetalhe([CASO], [ATRIBUTO]);
    await servico.caso('NN-2026-ABCDEFGH', 7);
    expect(registrar).toHaveBeenCalledWith({
      usuarioId: 7,
      finalidade: 'ADJUDICACAO',
      acao: 'regulacao_caso_consultado',
      recurso: 'regulacao/casos/NN-2026-ABCDEFGH',
      casoId: 42,
      detalhe: { atributos: 1 },
    });
  });
});
