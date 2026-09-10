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

        const elo: EloAuditoria = {
          id: randomUUID(),
          ocorridoEm: new Date().toISOString(),
          usuarioId: evento.usuarioId,
          finalidade: evento.finalidade,
          acao: evento.acao,
          recurso: evento.recurso,
          detalhe: evento.detalhe,
        };
        const atual = calcularElo(anterior, elo);

        await executar(
          `INSERT INTO mob_auditoria
             (id_usuario, id_dispositivo, id_caso, co_finalidade, co_acao,
              ds_recurso, ds_detalhe, co_hash_anterior, co_hash_atual, st_ocorrencia)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            evento.usuarioId,
            evento.dispositivoId ?? null,
            evento.casoId ?? null,
            evento.finalidade,
            evento.acao,
            evento.recurso,
            evento.detalhe === null ? null : JSON.stringify(evento.detalhe),
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
   * Recalcula a cadeia inteira e devolve onde ela quebra, se quebrar.
   * A verificacao noturna prevista na arquitetura chama isto.
   */
  async verificarCadeia(): Promise<{ integra: boolean; quebrouEm: number | null; elos: number }> {
    interface Linha extends RowDataPacket {
      id_auditoria: number;
      co_hash_anterior: string;
      co_hash_atual: string;
    }
    const linhas = await this.acesso.consultar<Linha>(
      'AUDITORIA',
      `SELECT id_auditoria, co_hash_anterior, co_hash_atual
         FROM mob_auditoria ORDER BY id_auditoria`,
    );

    let esperado = ELO_GENESE;
    for (const linha of linhas) {
      if (linha.co_hash_anterior.toLowerCase() !== esperado.toLowerCase()) {
        return { integra: false, quebrouEm: linha.id_auditoria, elos: linhas.length };
      }
      esperado = linha.co_hash_atual.toLowerCase();
    }
    return { integra: true, quebrouEm: null, elos: linhas.length };
  }
}
