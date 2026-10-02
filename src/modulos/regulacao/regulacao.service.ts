import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import { BancoPorFinalidade } from '@/acesso/banco-por-finalidade.service';
import { AuditoriaService } from '@/modulos/auditoria/auditoria.service';
import { valorDoAtributo } from '@/comum/numero';

/** Estados em que o caso espera a Central de Regulação (ver ck_mob_caso_st_caso). */
export const ESTADOS_DA_FILA = ['ANALISE', 'ADJUDICACAO'] as const;

/** Teto da fila numa resposta: a central trabalha pelo topo, por prazo. */
export const LIMITE_DA_FILA = 500;

/** Decisões que a regulação já pode registrar (ver `decidir`). */
export const DECISOES = ['NAO_RESOLVIDO', 'PERICIA'] as const;
export const MOTIVO_MINIMO = 10;

export const esquemaDecisao = z.object({
  decisao: z.enum(DECISOES),
  // Cabe em mob_caso_estado.ds_motivo (300). Mínimo para não virar "ok".
  motivo: z.string().trim().min(MOTIVO_MINIMO).max(300),
});
export type Decisao = z.infer<typeof esquemaDecisao>;

interface LinhaIdDoCaso extends RowDataPacket {
  id_caso: number;
  co_caso: string;
  st_caso: string;
}

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
  tp_dado: string;
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

  /**
   * Decisão do caso pela regulação (US-31): tira o caso da fila com autor e
   * motivo.
   *
   * (!) SÓ "NÃO RESOLVIDO" E "PERÍCIA", POR ENQUANTO. "Resolvido" exige dizer
   *     a quem o caso foi vinculado, e isso só existe com a comparação de
   *     candidatos (US-29) e a dupla conferência (US-30). Perícia aqui é o
   *     registro da decisão; o envio ao IML continua fora do sistema (US-33).
   *
   * (!) MOTIVO OBRIGATÓRIO, NO HISTÓRICO, E NÃO NA TRILHA. O motivo vai para
   *     mob_caso_estado pelo gatilho (db/09), com o autor. A trilha registra
   *     quem decidiu o quê; o texto do motivo pode citar a pessoa, e a trilha
   *     não é lugar de dado de caso.
   *
   * (!) A MUDANÇA SÓ ACONTECE SE O CASO AINDA ESTIVER NA FILA, e isso é
   *     conferido no próprio UPDATE (`affectedRows`). Duas estações decidindo
   *     o mesmo caso ao mesmo tempo: a segunda recebe "já não está na fila".
   */
  async decidir(coCaso: string, usuarioId: number, dados: Decisao): Promise<{ coCaso: string; stCaso: string }> {
    const caso = await this.acesso.emTransacao('ADJUDICACAO', async (executar, consultar) => {
      const linhas = await consultar<LinhaIdDoCaso>(
        'SELECT id_caso, co_caso, st_caso FROM mob_caso WHERE co_caso = ? LIMIT 1',
        [coCaso],
      );
      const atual = linhas[0];
      if (!atual || !ESTADOS_DA_FILA.some((e) => e === atual.st_caso)) {
        throw new NotFoundException({ mensagem: 'Caso não encontrado na fila da regulação.' });
      }
      await executar('SET @mob_transicao_usuario = ?, @mob_transicao_motivo = ?', [usuarioId, dados.motivo]);
      try {
        const r: ResultSetHeader = await executar(
          'UPDATE mob_caso SET st_caso = ? WHERE id_caso = ? AND st_caso IN (?, ?)',
          [dados.decisao, atual.id_caso, ...ESTADOS_DA_FILA],
        );
        if (r.affectedRows !== 1) {
          throw new ConflictException({ mensagem: 'Este caso acabou de sair da fila: outra pessoa já o decidiu.' });
        }
      } finally {
        await executar('SET @mob_transicao_usuario = NULL, @mob_transicao_motivo = NULL');
      }
      return atual;
    });

    await this.auditoria.registrar({
      usuarioId,
      finalidade: 'ADJUDICACAO',
      acao: 'regulacao_caso_decidido',
      recurso: `regulacao/casos/${caso.co_caso}`,
      casoId: caso.id_caso,
      detalhe: { de: caso.st_caso, para: dados.decisao },
    });

    return { coCaso: caso.co_caso, stCaso: dados.decisao };
  }

  private async atributosDe(idCaso: number): Promise<AtributoParaRegulacao[]> {
    const linhas = await this.acesso.consultar<LinhaAtributo>(
      'ADJUDICACAO',
      `SELECT t.co_atributo, t.no_atributo, t.tp_dado, g.co_grupo, g.no_grupo,
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
      valor: valorDoAtributo(l),
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

