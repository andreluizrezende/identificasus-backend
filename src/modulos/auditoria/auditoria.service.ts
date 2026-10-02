import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { RowDataPacket } from 'mysql2/promise';
import { BancoPorFinalidade } from '@/acesso/banco-por-finalidade.service';
import { ELO_GENESE, calcularElo } from '@/comum/hash-auditoria';
import type { EloAuditoria } from '@/comum/hash-auditoria';

interface LinhaUltimoElo extends RowDataPacket {
  co_hash_atual: string | null;
}

export interface EventoAuditavel {
  usuarioId: number;
  finalidade: string;
  acao: string;
  recurso: string;
  detalhe: unknown;
  dispositivoId?: number | null;
  casoId?: number | null;
}

/**
 * Modulo-folha: todos dependem dele, ele nao depende de ninguem.
 *
 * (!) O ELO E CALCULADO E GRAVADO NA MESMA TRANSACAO, com a leitura do elo
 *     anterior travada por FOR UPDATE. Sem a trava, dois eventos simultaneos
 *     leriam o mesmo anterior e a cadeia se bifurcaria — e uma cadeia
 *     bifurcada nao prova nada.
 *
 * (!) REGISTRAR AUDITORIA NAO PODE DERRUBAR A REQUISICAO QUE A ORIGINOU. Perder
 *     o registro e ruim; perder o atendimento e pior. A falha vai para o log
 *     e segue — mesma regra de fiocruz-backend/utils/auditoria.js.
 */
@Injectable()
export class AuditoriaService {
  private readonly log = new Logger('auditoria');

  constructor(private readonly acesso: BancoPorFinalidade) {}

  async registrar(evento: EventoAuditavel): Promise<string | null> {
    try {
      return await this.acesso.emTransacao('ASSISTENCIAL', async (executar, consultar) => {
        // (!) O ELO ANTERIOR VEM POR PROCEDURE, E NAO POR SELECT. O usuario
        //     `nri_assistencial` tem apenas INSERT em mob_auditoria, de
        //     proposito: quem e vigiado pela trilha nao le a trilha. A
        //     procedure roda com SQL SECURITY DEFINER, devolve UMA linha e
        //     mantem o FOR UPDATE dentro desta transacao — ver
        //     db/05_cadeia_de_auditoria.sql.
        await executar('CALL sp_mob_ultimo_elo(@co_hash_anterior)');
        const ultimo = await consultar<LinhaUltimoElo>(
          'SELECT @co_hash_anterior AS co_hash_atual',
        );
        const anterior = ultimo[0]?.co_hash_atual ?? ELO_GENESE;

        // (!) O HASH E CALCULADO SOBRE O QUE VAI PARA O BANCO. O detalhe passa
        //     por um ciclo JSON antes: um campo `undefined` entraria no hash e
        //     sumiria na gravacao, e o elo nunca mais conferiria.
        const detalhe: unknown = evento.detalhe === undefined || evento.detalhe === null
          ? null
          : JSON.parse(JSON.stringify(evento.detalhe));
        const elo: EloAuditoria = {
          id: randomUUID(),
          ocorridoEm: new Date().toISOString(),
          usuarioId: evento.usuarioId,
          finalidade: evento.finalidade,
          acao: evento.acao,
          recurso: evento.recurso,
          detalhe,
          dispositivoId: evento.dispositivoId ?? null,
          casoId: evento.casoId ?? null,
        };
        const atual = calcularElo(anterior, elo);

        // `co_elo` grava o identificador que entra no hash (db/09): sem ele, a
        // verificacao conferia so a ordem da cadeia, e nao o conteudo.
        await executar(
          `INSERT INTO mob_auditoria
             (co_elo, id_usuario, id_dispositivo, id_caso, co_finalidade, co_acao,
              ds_recurso, ds_detalhe, co_hash_anterior, co_hash_atual, st_ocorrencia)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            elo.id,
            evento.usuarioId,
            elo.dispositivoId ?? null,
            elo.casoId ?? null,
            evento.finalidade,
            evento.acao,
            evento.recurso,
            detalhe === null ? null : JSON.stringify(detalhe),
            anterior,
            atual,
            elo.ocorridoEm.replace('T', ' ').replace('Z', ''),
          ],
        );
        return atual;
      });
    } catch (erro) {
      const motivo = erro instanceof Error ? erro.message : 'falha desconhecida';
      this.log.error(`falhou ao registrar ${evento.acao} em ${evento.recurso}: ${motivo}`);
      return null;
    }
  }

  /**
   * Recalcula a cadeia inteira e devolve onde ela quebra, se quebrar. A rota
   * de verificacao noturna (AuditoriaController) chama isto.
   *
   * Duas conferencias por elo:
   *  - ORDEM: o anterior de cada elo e o hash do elo antes dele;
   *  - CONTEUDO: o hash recalculado a partir da propria linha bate com o
   *    gravado. So para elos com `co_elo` (db/09); os anteriores nao gravavam
   *    o identificador que entra no hash e ficam verificaveis so pela ordem.
   */
  async verificarCadeia(): Promise<ResultadoDaVerificacao> {
    const linhas = await this.acesso.consultar<LinhaDaTrilha>(
      'AUDITORIA',
      `SELECT id_auditoria, co_elo, id_usuario, id_dispositivo, id_caso, co_finalidade,
              co_acao, ds_recurso, ds_detalhe, co_hash_anterior, co_hash_atual, st_ocorrencia
         FROM mob_auditoria ORDER BY id_auditoria`,
    );

    let esperado = ELO_GENESE;
    let peloConteudo = 0;
    for (const linha of linhas) {
      const quebra = (motivo: MotivoDaQuebra): ResultadoDaVerificacao => ({
        integra: false, quebrouEm: linha.id_auditoria, motivo, elos: linhas.length, peloConteudo,
      });
      if (linha.co_hash_anterior.toLowerCase() !== esperado.toLowerCase()) return quebra('ordem');
      if (linha.co_elo) {
        if (calcularElo(linha.co_hash_anterior, eloDaLinha(linha)).toLowerCase() !== linha.co_hash_atual.toLowerCase()) {
          return quebra('conteudo');
        }
        peloConteudo += 1;
      }
      esperado = linha.co_hash_atual.toLowerCase();
    }
    return { integra: true, quebrouEm: null, motivo: null, elos: linhas.length, peloConteudo };
  }
}

export type MotivoDaQuebra = 'ordem' | 'conteudo';

export interface ResultadoDaVerificacao {
  integra: boolean;
  /** `id_auditoria` do primeiro elo que nao confere. */
  quebrouEm: number | null;
  motivo: MotivoDaQuebra | null;
  elos: number;
  /** Quantos elos tiveram o conteudo recalculado (os com `co_elo`). */
  peloConteudo: number;
}

interface LinhaDaTrilha extends RowDataPacket {
  id_auditoria: number;
  co_elo: string | null;
  id_usuario: number;
  id_dispositivo: number | null;
  id_caso: number | null;
  co_finalidade: string;
  co_acao: string;
  ds_recurso: string;
  ds_detalhe: unknown;
  co_hash_anterior: string;
  co_hash_atual: string;
  st_ocorrencia: string;
}

/** A linha gravada de volta no formato em que o elo foi calculado. */
function eloDaLinha(l: LinhaDaTrilha): EloAuditoria {
  // MySQL devolve JSON como objeto; MariaDB, como texto. Os dois viram o mesmo valor.
  const detalhe: unknown = typeof l.ds_detalhe === 'string' ? JSON.parse(l.ds_detalhe) : (l.ds_detalhe ?? null);
  return {
    id: l.co_elo ?? '',
    // "2026-10-02 01:59:18.494000" -> "2026-10-02T01:59:18.494Z", o ISO que entrou no hash.
    ocorridoEm: `${String(l.st_ocorrencia).replace(' ', 'T').slice(0, 23)}Z`,
    usuarioId: Number(l.id_usuario),
    finalidade: l.co_finalidade,
    acao: l.co_acao,
    recurso: l.ds_recurso,
    detalhe,
    dispositivoId: l.id_dispositivo === null ? null : Number(l.id_dispositivo),
    casoId: l.id_caso === null ? null : Number(l.id_caso),
  };
}
