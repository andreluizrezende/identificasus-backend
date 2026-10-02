import { Injectable, NotFoundException } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { BancoPorFinalidade } from '@/acesso/banco-por-finalidade.service';
import { AuditoriaService } from '@/modulos/auditoria/auditoria.service';

/** Estados em que o caso espera a Central de Regulação (ver ck_mob_caso_st_caso). */
export const ESTADOS_DA_FILA = ['ANALISE', 'ADJUDICACAO'] as const;

/** Teto da fila numa resposta: a central trabalha pelo topo, por prazo. */
export const LIMITE_DA_FILA = 500;

export interface ItemDaFila {
  coCaso: string;
  stCaso: string;
  noBase: string;
  dtOcorrencia: string;
  hrOcorrencia: string;
  qtCompletude: number;
  dtPrazo: string | null;
  /** Dias até o prazo (negativo = vencido); null sem prazo. Calculado pelo banco, em UTC. */
  diasParaPrazo: number | null;
}

export interface AtributoParaRegulacao {
  coAtributo: string;
  noAtributo: string;
  coGrupo: string;
  noGrupo: string;
  valor: string | null;
  coProcedencia: string;
  dsProcedencia: string;
  capturadoEm: string;
  noAutor: string;
}

export interface TransicaoParaRegulacao {
  stAnterior: string | null;
  stAtual: string;
  dsMotivo: string | null;
  ocorridaEm: string;
  noAutor: string | null;
}

export interface CasoParaRegulacao extends ItemDaFila {
  coOcorrenciaSamu: string | null;
  dsLocal: string | null;
  dsDestino: string | null;
  atributos: AtributoParaRegulacao[];
  historico: TransicaoParaRegulacao[];
}

interface LinhaFila extends RowDataPacket {
  co_caso: string;
  st_caso: string;
  no_base: string;
  dt_ocorrencia: string;
  hr_ocorrencia: string;
  qt_completude: number;
  dt_prazo: string | null;
  dias_para_prazo: number | null;
}

interface LinhaCaso extends LinhaFila {
  id_caso: number;
  co_ocorrencia_samu: string | null;
  ds_local: string | null;
  ds_destino: string | null;
}

interface LinhaAtributo extends RowDataPacket {
  co_atributo: string;
  no_atributo: string;
  co_grupo: string;
  no_grupo: string;
  ds_valor: string | null;
  vl_numerico: string | null;
  dt_valor: string | null;
  no_termo: string | null;
  co_procedencia: string;
  ds_procedencia: string;
  st_captura: string;
  no_usuario: string;
}

interface LinhaTransicao extends RowDataPacket {
  st_anterior: string | null;
  st_atual: string;
  ds_motivo: string | null;
  st_transicao: string;
  no_usuario: string | null;
}

/**
 * Fila da Central de Regulação: os casos que saíram do campo e esperam análise
 * ou adjudicação.
 *
 * (!) FINALIDADE ADJUDICACAO, POOL nri_adjudicacao. A fila enxerga casos de
 *     todas as bases, o que a captura em campo (ASSISTENCIAL) não pode; por
 *     isso a consulta não reaproveita `CasoService`, que filtra por turno.
 *
 * (!) MINIMIZAÇÃO (LGPD art. 6º, III). A fila mostra o que a regulação precisa
 *     para escolher por onde começar — código, estado, base, data, completude
 *     e prazo. Local da ocorrência e atributos ficam para o detalhe do caso,
 *     onde a leitura de cada um é registrada.
 *
 * (!) CADA CONSULTA VAI PARA A TRILHA. É leitura de dado de caso, de todas as
 *     bases, e a trilha é o que permite responder depois "quem viu o quê".
 */
@Injectable()
export class RegulacaoService {
  constructor(
    private readonly acesso: BancoPorFinalidade,
    private readonly auditoria: AuditoriaService,
  ) {}

  async fila(usuarioId: number): Promise<ItemDaFila[]> {
    const linhas = await this.acesso.consultar<LinhaFila>(
      'ADJUDICACAO',
      `SELECT c.co_caso, c.st_caso, b.no_base, c.dt_ocorrencia, c.hr_ocorrencia,
              c.qt_completude, c.dt_prazo,
              DATEDIFF(c.dt_prazo, UTC_DATE()) AS dias_para_prazo
         FROM mob_caso c
         JOIN mob_base b ON b.id_base = c.id_base
        WHERE c.st_caso IN (?, ?)
        ORDER BY (c.dt_prazo IS NULL), c.dt_prazo, c.dt_ocorrencia, c.hr_ocorrencia
        LIMIT ?`,
      [...ESTADOS_DA_FILA, LIMITE_DA_FILA],
    );

    await this.auditoria.registrar({
      usuarioId,
      finalidade: 'ADJUDICACAO',
      acao: 'regulacao_fila_consultada',
      recurso: 'regulacao/fila',
      detalhe: { quantidade: linhas.length },
    });

    return linhas.map(itemDaFila);
  }

  /**
   * Detalhe do caso para a regulação: o que a equipe registrou em campo, com
   * procedência e autor de cada atributo, e o histórico de estados.
   *
   * (!) SÓ CASO QUE ESTÁ NA FILA. Caso ainda em campo é da equipe que o
   *     captura; caso já decidido sai do trabalho da central. Os dois recebem
   *     a mesma resposta de "não existe", como no módulo de campo: um 403
   *     contaria que o caso existe.
   *
   * (!) A LEITURA VAI PARA A TRILHA COM O id_caso. É aqui que a regulação vê
   *     local e atributos; a trilha precisa responder "quem viu este caso".
   */
  async caso(coCaso: string, usuarioId: number): Promise<CasoParaRegulacao> {
    const linhas = await this.acesso.consultar<LinhaCaso>(
      'ADJUDICACAO',
      `SELECT c.id_caso, c.co_caso, c.st_caso, b.no_base, c.dt_ocorrencia, c.hr_ocorrencia,
              c.qt_completude, c.dt_prazo,
              DATEDIFF(c.dt_prazo, UTC_DATE()) AS dias_para_prazo,
              c.co_ocorrencia_samu, c.ds_local, c.ds_destino
         FROM mob_caso c
         JOIN mob_base b ON b.id_base = c.id_base
        WHERE c.co_caso = ? AND c.st_caso IN (?, ?)
        LIMIT 1`,
      [coCaso, ...ESTADOS_DA_FILA],
    );
    const caso = linhas[0];
    if (!caso) throw new NotFoundException({ mensagem: 'Caso não encontrado na fila da regulação.' });

    const [atributos, historico] = await Promise.all([
      this.atributosDe(caso.id_caso),
      this.historicoDe(caso.id_caso),
    ]);

    await this.auditoria.registrar({
      usuarioId,
      finalidade: 'ADJUDICACAO',
      acao: 'regulacao_caso_consultado',
      recurso: `regulacao/casos/${caso.co_caso}`,
      casoId: caso.id_caso,
      detalhe: { atributos: atributos.length },
    });

    return {
      ...itemDaFila(caso),
      coOcorrenciaSamu: caso.co_ocorrencia_samu,
      dsLocal: caso.ds_local,
      dsDestino: caso.ds_destino,
      atributos,
      historico,
    };
  }

  private async atributosDe(idCaso: number): Promise<AtributoParaRegulacao[]> {
    const linhas = await this.acesso.consultar<LinhaAtributo>(
      'ADJUDICACAO',
      `SELECT t.co_atributo, t.no_atributo, g.co_grupo, g.no_grupo,
              a.ds_valor, a.vl_numerico, a.dt_valor, v.ds_valor AS no_termo,
              p.co_procedencia, p.ds_procedencia, a.st_captura, u.no_usuario
         FROM mob_caso_atributo a
         JOIN mob_tipo_atributo  t ON t.id_tipo_atributo = a.id_tipo_atributo
         JOIN mob_grupo_atributo g ON g.id_grupo_atributo = t.id_grupo_atributo
         JOIN mob_procedencia    p ON p.id_procedencia = a.id_procedencia
         JOIN mob_usuario        u ON u.id_usuario = a.id_usuario
         LEFT JOIN mob_vocabulario v ON v.id_vocabulario = a.id_vocabulario
        WHERE a.id_caso = ? AND a.lg_vigente = 1
        ORDER BY g.nu_ordem, t.nu_ordem`,
      [idCaso],
    );
    return linhas.map((l) => ({
      coAtributo: l.co_atributo,
      noAtributo: l.no_atributo,
      coGrupo: l.co_grupo,
      noGrupo: l.no_grupo,
      // Mesma precedência do módulo de campo: termo controlado, texto, número, data.
      valor: l.no_termo ?? l.ds_valor ?? numeroLegivel(l.vl_numerico) ?? l.dt_valor,
      coProcedencia: l.co_procedencia,
      dsProcedencia: l.ds_procedencia,
      capturadoEm: l.st_captura,
      noAutor: l.no_usuario,
    }));
  }

  private async historicoDe(idCaso: number): Promise<TransicaoParaRegulacao[]> {
    const linhas = await this.acesso.consultar<LinhaTransicao>(
      'ADJUDICACAO',
      `SELECT e.st_anterior, e.st_atual, e.ds_motivo, e.st_transicao, u.no_usuario
         FROM mob_caso_estado e
         LEFT JOIN mob_usuario u ON u.id_usuario = e.id_usuario
        WHERE e.id_caso = ?
        ORDER BY e.st_transicao, e.id_caso_estado`,
      [idCaso],
    );
    return linhas.map((l) => ({
      stAnterior: l.st_anterior,
      stAtual: l.st_atual,
      dsMotivo: l.ds_motivo,
      ocorridaEm: l.st_transicao,
      noAutor: l.no_usuario,
    }));
  }
}

function itemDaFila(l: LinhaFila): ItemDaFila {
  return {
    coCaso: l.co_caso,
    stCaso: l.st_caso,
    noBase: l.no_base,
    dtOcorrencia: l.dt_ocorrencia,
    hrOcorrencia: l.hr_ocorrencia,
    qtCompletude: Number(l.qt_completude),
    dtPrazo: l.dt_prazo,
    diasParaPrazo: l.dias_para_prazo === null ? null : Number(l.dias_para_prazo),
  };
}

/**
 * DECIMAL(12,3) chega como "1.720". Na tela da regulação isso se lê "mil
 * setecentos e vinte": o número sai no formato brasileiro e sem zeros à
 * direita ("1,72").
 */
function numeroLegivel(vl: string | null): string | null {
  if (vl === null) return null;
  const n = Number(vl);
  return Number.isFinite(n) ? n.toLocaleString('pt-BR', { maximumFractionDigits: 3 }) : vl;
}
