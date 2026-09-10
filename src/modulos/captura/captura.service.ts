import { Injectable } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { BancoPorFinalidade } from '@/acesso/banco-por-finalidade.service';

export interface Atributo {
  idCaso: number;
  /** `co_atributo` do catálogo — SEXO_APARENTE, CALCADO, etc. */
  coAtributo: string;
  /** OBSERVADO, INFORMADO ou ESTIMADO. É o que pondera o escore na regulação. */
  coProcedencia: string;
  /** Termo do vocabulário controlado, quando o atributo tem lista fechada. */
  coValor?: string | null;
  /** Texto livre, quando não tem. */
  dsValor?: string | null;
  usuarioId: number;
}

export interface ValorVigente {
  idTipoAtributo: number;
  valor: string;
  idUsuario: number;
  noUsuario: string;
}

export class AtributoDesconhecido extends Error {}
export class TermoDesconhecido extends Error {}
export class ProcedenciaDesconhecida extends Error {}

interface LinhaTipo extends RowDataPacket { id_tipo_atributo: number; tp_dado: string }
interface LinhaId extends RowDataPacket { id: number }
interface LinhaVigente extends RowDataPacket {
  id_tipo_atributo: number;
  ds_valor: string | null;
  vl_numerico: string | null;
  no_termo: string | null;
  id_usuario: number;
  no_usuario: string;
}

/**
 * Gravação de atributo capturado em campo.
 *
 * (!) A ESCRITA PASSA POR `sp_mob_registra_atributo`, e não por INSERT direto.
 *     A procedure faz três coisas numa transação só: rebaixa a versão anterior
 *     para `lg_vigente = 0`, grava a nova e recalcula `qt_completude` com
 *     `fn_mob_calcula_completude`. Fazer isso da aplicação significaria três
 *     idas ao banco e uma janela em que a completude mente.
 *
 * (!) VERSÃO ANTERIOR NUNCA É APAGADA (RF-11.02). Corrigir "camisa azul" para
 *     "camisa verde" não elimina o registro de que alguém viu azul — e, num
 *     caso que pode virar perícia, o que foi visto primeiro é evidência.
 */
@Injectable()
export class CapturaService {
  constructor(private readonly acesso: BancoPorFinalidade) {}

  async registrarAtributo(a: Atributo): Promise<void> {
    const tipo = await this.tipoDe(a.coAtributo);
    const idProcedencia = await this.procedenciaDe(a.coProcedencia);
    const idVocabulario = a.coValor
      ? await this.termoDe(tipo.id_tipo_atributo, a.coValor)
      : null;

    // ck_mob_caso_atributo_valor exige que ao menos uma coluna de valor venha
    // preenchida. Se veio termo controlado, ds_valor fica nulo: guardar o
    // rótulo junto criaria duas fontes para o mesmo dado, e elas divergem no
    // dia em que o vocabulário muda.
    await this.acesso.executar(
      'ASSISTENCIAL',
      'CALL sp_mob_registra_atributo(?, ?, ?, ?, ?, ?)',
      [
        a.idCaso,
        tipo.id_tipo_atributo,
        idProcedencia,
        idVocabulario,
        idVocabulario === null ? (a.dsValor ?? null) : null,
        a.usuarioId,
      ],
    );
  }

  /**
   * O valor que o servidor já tem para um atributo do caso. É com isto que a
   * sincronização decide se o que chegou do aparelho é novidade ou conflito —
   * e um conflito nunca sobrescreve (RF-11.02).
   */
  async valorVigente(idCaso: number, coAtributo: string): Promise<ValorVigente | null> {
    const linhas = await this.acesso.consultar<LinhaVigente>(
      'ASSISTENCIAL',
      `SELECT a.id_tipo_atributo, a.ds_valor, a.vl_numerico,
              v.ds_valor AS no_termo, a.id_usuario, u.no_usuario
         FROM mob_caso_atributo a
         JOIN mob_tipo_atributo t ON t.id_tipo_atributo = a.id_tipo_atributo
         JOIN mob_usuario u ON u.id_usuario = a.id_usuario
         LEFT JOIN mob_vocabulario v ON v.id_vocabulario = a.id_vocabulario
        WHERE a.id_caso = ? AND t.co_atributo = ? AND a.lg_vigente = 1
        LIMIT 1`,
      [idCaso, coAtributo],
    );

    const l = linhas[0];
    if (!l) return null;
    const valor = l.no_termo ?? l.ds_valor ?? l.vl_numerico;
    if (valor === null) return null;
    return {
      idTipoAtributo: l.id_tipo_atributo,
      valor,
      idUsuario: l.id_usuario,
      noUsuario: l.no_usuario,
    };
  }

  async idDoTipo(coAtributo: string): Promise<number> {
    return (await this.tipoDe(coAtributo)).id_tipo_atributo;
  }

  private async tipoDe(coAtributo: string): Promise<LinhaTipo> {
    const linhas = await this.acesso.consultar<LinhaTipo>(
      'ASSISTENCIAL',
      `SELECT id_tipo_atributo, tp_dado FROM mob_tipo_atributo
        WHERE co_atributo = ? AND st_ativo = 'A' LIMIT 1`,
      [coAtributo],
    );
    const tipo = linhas[0];
    if (!tipo) throw new AtributoDesconhecido(coAtributo);
    return tipo;
  }

  private async procedenciaDe(co: string): Promise<number> {
    const linhas = await this.acesso.consultar<LinhaId>(
      'ASSISTENCIAL',
      'SELECT id_procedencia AS id FROM mob_procedencia WHERE co_procedencia = ? LIMIT 1',
      [co],
    );
    const id = linhas[0]?.id;
    if (id === undefined) throw new ProcedenciaDesconhecida(co);
    return id;
  }

  private async termoDe(idTipoAtributo: number, coValor: string): Promise<number> {
    const linhas = await this.acesso.consultar<LinhaId>(
      'ASSISTENCIAL',
      `SELECT id_vocabulario AS id FROM mob_vocabulario
        WHERE id_tipo_atributo = ? AND co_valor = ? AND st_ativo = 'A' LIMIT 1`,
      [idTipoAtributo, coValor],
    );
    const id = linhas[0]?.id;
    // (!) TERMO FORA DA LISTA É RECUSADO, e não convertido em texto livre. A
    //     conversão silenciosa é como um vocabulário controlado deixa de ser
    //     controlado sem ninguém decidir isso.
    if (id === undefined) throw new TermoDesconhecido(coValor);
    return id;
  }
}
