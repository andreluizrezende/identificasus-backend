import { Injectable, NotFoundException } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { BancoPorFinalidade } from '@/acesso/banco-por-finalidade.service';
import { AuditoriaService } from '@/modulos/auditoria/auditoria.service';
import { AssinaturaDeFoto, VALIDADE_DA_URL_MS } from '@/modulos/midia/assinatura-de-foto';
import { ESTADOS_DA_FILA } from './regulacao.service';

export interface FotoParaRegulacao {
  idMidia: number;
  dsLegenda: string | null;
  nuTamanho: number;
  capturadaEm: string;
  noAutor: string;
  /** URL de leitura assinada, so desta foto (ver AssinaturaDeFoto). */
  url: string;
  /** Ate quando a URL vale, em ISO. Passado isso, a tela pede de novo. */
  validaAte: string;
}

interface LinhaId extends RowDataPacket {
  id_caso: number;
  co_caso: string;
}

interface LinhaMidia extends RowDataPacket {
  id_midia: number;
  ds_legenda: string | null;
  ds_caminho: string;
  nu_tamanho: number;
  st_captura: string;
  no_usuario: string;
}

/**
 * Fotos de um caso para a Central de Regulação.
 *
 * (!) MESMA REGRA DO DETALHE DO CASO: so caso que esta na fila, e "nao existe"
 *     igual para caso fora dela (um 403 contaria que o caso existe).
 *
 * (!) VER FOTO VAI PARA A TRILHA, A PARTE DO DETALHE. Foto de marca
 *     identificadora e o dado mais sensivel do caso; a trilha precisa
 *     responder "quem viu as fotos deste caso", e nao so "quem abriu o caso".
 *     Por isso as fotos tem rota propria, chamada quando a tela as mostra.
 *
 * (!) FOTO EXPURGADA NAO APARECE (lg_expurgada = 1): o binario pode nem
 *     existir mais, e o expurgo e decisao registrada.
 */
@Injectable()
export class FotosDaRegulacaoService {
  constructor(
    private readonly acesso: BancoPorFinalidade,
    private readonly auditoria: AuditoriaService,
    private readonly assinatura: AssinaturaDeFoto,
  ) {}

  async fotos(coCaso: string, usuarioId: number): Promise<FotoParaRegulacao[]> {
    const casos = await this.acesso.consultar<LinhaId>(
      'ADJUDICACAO',
      'SELECT c.id_caso, c.co_caso FROM mob_caso c WHERE c.co_caso = ? AND c.st_caso IN (?, ?) LIMIT 1',
      [coCaso, ...ESTADOS_DA_FILA],
    );
    const caso = casos[0];
    if (!caso) throw new NotFoundException({ mensagem: 'Caso não encontrado na fila da regulação.' });

    const linhas = await this.acesso.consultar<LinhaMidia>(
      'ADJUDICACAO',
      `SELECT m.id_midia, m.ds_legenda, m.ds_caminho, m.nu_tamanho, m.st_captura, u.no_usuario
         FROM mob_midia m
         JOIN mob_usuario u ON u.id_usuario = m.id_usuario
        WHERE m.id_caso = ? AND m.tp_midia = 'IMG' AND m.lg_expurgada = 0
        ORDER BY m.st_captura, m.id_midia`,
      [caso.id_caso],
    );

    const validoAte = Date.now() + VALIDADE_DA_URL_MS;
    const fotos = await Promise.all(linhas.map(async (l) => ({
      idMidia: Number(l.id_midia),
      dsLegenda: l.ds_legenda,
      nuTamanho: Number(l.nu_tamanho),
      capturadaEm: l.st_captura,
      noAutor: l.no_usuario,
      url: await this.assinatura.urlDeLeitura(l.ds_caminho, validoAte),
      validaAte: new Date(validoAte).toISOString(),
    })));

    await this.auditoria.registrar({
      usuarioId,
      finalidade: 'ADJUDICACAO',
      acao: 'regulacao_fotos_consultadas',
      recurso: `regulacao/casos/${caso.co_caso}/fotos`,
      casoId: caso.id_caso,
      detalhe: { fotos: fotos.map((f) => f.idMidia) },
    });

    return fotos;
  }
}
