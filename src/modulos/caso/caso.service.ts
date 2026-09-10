import { Injectable, NotFoundException } from '@nestjs/common';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { BancoPorFinalidade } from '@/acesso/banco-por-finalidade.service';
import type { Parametros } from '@/acesso/banco-por-finalidade.service';

export interface CasoResumo {
  coCaso: string;
  stCaso: string;
  dtOcorrencia: string;
  hrOcorrencia: string;
  dsLocal: string | null;
  qtCompletude: number;
  dtPrazo: string | null;
  enviadoEm: string | null;
}

export interface AtributoDoCaso {
  coAtributo: string;
  noAtributo: string;
  coGrupo: string;
  valor: string | null;
  coProcedencia: string;
  capturadoEm: string;
  noAutor: string;
}

export interface TransicaoDoCaso {
  stAnterior: string | null;
  stAtual: string;
  dsMotivo: string | null;
  ocorridaEm: string;
  noAutor: string | null;
}

export interface CasoDetalhe extends CasoResumo {
  coOcorrenciaSamu: string | null;
  dsDestino: string | null;
  noBase: string;
  atributos: AtributoDoCaso[];
  historico: TransicaoDoCaso[];
}

export interface AberturaDeCaso {
  coCaso: string;
  idBase: number;
  idViatura?: number | null;
  idTurno?: number | null;
  coOcorrenciaSamu?: string | null;
  dtOcorrencia: string;
  hrOcorrencia: string;
  dsLocal?: string | null;
  vlLatitude?: number | null;
  vlLongitude?: number | null;
  nuPrecisaoGps?: number | null;
}

interface LinhaResumo extends RowDataPacket {
  id_caso: number;
  co_caso: string;
  st_caso: string;
  dt_ocorrencia: string;
  hr_ocorrencia: string;
  ds_local: string | null;
  qt_completude: number;
  dt_prazo: string | null;
  st_envio: string | null;
}

interface LinhaDetalhe extends LinhaResumo {
  co_ocorrencia_samu: string | null;
  ds_destino: string | null;
  no_base: string;
}

interface LinhaAtributo extends RowDataPacket {
  co_atributo: string;
  no_atributo: string;
  co_grupo: string;
  ds_valor: string | null;
  vl_numerico: string | null;
  dt_valor: string | null;
  no_termo: string | null;
  co_procedencia: string;
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

interface LinhaId extends RowDataPacket { id_caso: number }

/**
 * (!) O `usuarioId` É OBRIGATÓRIO POR ASSINATURA, e não por convenção.
 *
 *     O MySQL não tem row-level security, então a filtragem por linha voltou
 *     para a aplicação — e filtragem esquecida falha aberta, que é o pior modo
 *     de falhar. Exigir o parâmetro no tipo é a primeira das três compensações
 *     do ADR-14; as outras duas são o teste de autorização por rota e a
 *     auditoria de leitura.
 *
 * (!) NEM ESCORE NEM CANDIDATOS SAEM POR AQUI. O módulo de campo devolve o que
 *     a equipe registrou, e nada sobre vínculos possíveis: a comparação e a
 *     decisão acontecem no console da regulação, com dupla conferência (RN-01).
 *     Um campo de escore nesta resposta transformaria a captura em palpite.
 */
@Injectable()
export class CasoService {
  constructor(private readonly acesso: BancoPorFinalidade) {}

  /**
   * Quem vê um caso: quem o abriu, e quem estava na guarnição do turno em que
   * ele foi aberto. A base inteira, não — proximidade não é necessidade.
   */
  private static readonly VISIVEL_PARA = `
    (c.id_usuario_abertura = ?
     OR c.id_turno IN (SELECT g.id_turno FROM mob_turno_guarnicao g WHERE g.id_usuario = ?))`;

  async meusCasos(usuarioId: number): Promise<CasoResumo[]> {
    const linhas = await this.acesso.consultar<LinhaResumo>(
      'ASSISTENCIAL',
      `SELECT c.id_caso, c.co_caso, c.st_caso, c.dt_ocorrencia, c.hr_ocorrencia,
              c.ds_local, c.qt_completude, c.dt_prazo, c.st_envio
         FROM mob_caso c
        WHERE ${CasoService.VISIVEL_PARA}
        ORDER BY (c.st_envio IS NULL) DESC, c.dt_ocorrencia DESC, c.hr_ocorrencia DESC
        LIMIT 200`,
      [usuarioId, usuarioId],
    );
    return linhas.map(resumo);
  }

  async porCodigo(coCaso: string, usuarioId: number): Promise<CasoDetalhe> {
    const linhas = await this.acesso.consultar<LinhaDetalhe>(
      'ASSISTENCIAL',
      `SELECT c.id_caso, c.co_caso, c.st_caso, c.dt_ocorrencia, c.hr_ocorrencia,
              c.ds_local, c.qt_completude, c.dt_prazo, c.st_envio,
              c.co_ocorrencia_samu, c.ds_destino, b.no_base
         FROM mob_caso c
         JOIN mob_base b ON b.id_base = c.id_base
        WHERE c.co_caso = ? AND ${CasoService.VISIVEL_PARA}
        LIMIT 1`,
      [coCaso, usuarioId, usuarioId],
    );

    const caso = linhas[0];
    // (!) MESMA RESPOSTA PARA "NÃO EXISTE" E "NÃO É SEU". Um 403 aqui contaria
    //     que o caso existe, e a existência de um caso já é informação sobre
    //     uma pessoa.
    if (!caso) throw new NotFoundException({ mensagem: 'Caso não encontrado.' });

    const [atributos, historico] = await Promise.all([
      this.atributosDe(caso.id_caso),
      this.historicoDe(caso.id_caso),
    ]);

    return {
      ...resumo(caso),
      coOcorrenciaSamu: caso.co_ocorrencia_samu,
      dsDestino: caso.ds_destino,
      noBase: caso.no_base,
      atributos,
      historico,
    };
  }

  /**
   * Abre o caso. O código vem do aparelho, e não daqui: a equipe abre um caso
   * dentro do túnel, sem rede, e ele precisa ter identidade antes de o servidor
   * tomar conhecimento dele. `uc_mob_caso_co_caso` é o que impede que o mesmo
   * código chegue duas vezes por dois caminhos.
   */
  async abrir(dados: AberturaDeCaso, usuarioId: number): Promise<number> {
    return this.acesso.emTransacao('ASSISTENCIAL', async (executar, consultar) => {
      const jaExiste = await consultar<LinhaId>(
        'SELECT id_caso FROM mob_caso WHERE co_caso = ? LIMIT 1',
        [dados.coCaso],
      );
      const existente = jaExiste[0];
      if (existente) return existente.id_caso;

      const r: ResultSetHeader = await executar(
        `INSERT INTO mob_caso
           (co_caso, id_base, id_viatura, id_turno, id_usuario_abertura,
            co_ocorrencia_samu, st_caso, dt_ocorrencia, hr_ocorrencia,
            ds_local, vl_latitude, vl_longitude, nu_precisao_gps)
         VALUES (?, ?, ?, ?, ?, ?, 'ABERTO', ?, ?, ?, ?, ?, ?)`,
        [
          dados.coCaso, dados.idBase, dados.idViatura ?? null, dados.idTurno ?? null,
          usuarioId, dados.coOcorrenciaSamu ?? null,
          dados.dtOcorrencia, dados.hrOcorrencia, dados.dsLocal ?? null,
          dados.vlLatitude ?? null, dados.vlLongitude ?? null, dados.nuPrecisaoGps ?? null,
        ] as Parametros,
      );

      await executar(
        `INSERT INTO mob_caso_estado (id_caso, st_anterior, st_atual, id_usuario, ds_motivo)
         VALUES (?, NULL, 'ABERTO', ?, 'abertura em campo')`,
        [r.insertId, usuarioId],
      );
      return r.insertId;
    });
  }

  /** Transição de estado com autor e motivo. Nenhum estado muda sem os dois. */
  async transitar(
    idCaso: number, novoEstado: string, usuarioId: number, motivo?: string,
  ): Promise<void> {
    await this.acesso.emTransacao('ASSISTENCIAL', async (executar, consultar) => {
      const atual = await consultar<RowDataPacket & { st_caso: string }>(
        'SELECT st_caso FROM mob_caso WHERE id_caso = ? FOR UPDATE',
        [idCaso],
      );
      const anterior = atual[0]?.st_caso ?? null;
      if (anterior === novoEstado) return;

      await executar('UPDATE mob_caso SET st_caso = ? WHERE id_caso = ?', [novoEstado, idCaso]);
      await executar(
        `INSERT INTO mob_caso_estado (id_caso, st_anterior, st_atual, id_usuario, ds_motivo)
         VALUES (?, ?, ?, ?, ?)`,
        [idCaso, anterior, novoEstado, usuarioId, motivo ?? null],
      );
    });
  }

  /** Resolve o código do aparelho para a chave interna. Só isso. */
  async idPorCodigo(coCaso: string): Promise<number | null> {
    const linhas = await this.acesso.consultar<LinhaId>(
      'ASSISTENCIAL',
      'SELECT id_caso FROM mob_caso WHERE co_caso = ? LIMIT 1',
      [coCaso],
    );
    return linhas[0]?.id_caso ?? null;
  }

  /** Marca o envio confirmado — é o que autoriza o aparelho a expurgar (M13). */
  async confirmarEnvio(idCaso: number): Promise<void> {
    await this.acesso.executar(
      'ASSISTENCIAL',
      'UPDATE mob_caso SET st_envio = CURRENT_TIMESTAMP(6) WHERE id_caso = ? AND st_envio IS NULL',
      [idCaso],
    );
  }

  private async atributosDe(idCaso: number): Promise<AtributoDoCaso[]> {
    const linhas = await this.acesso.consultar<LinhaAtributo>(
      'ASSISTENCIAL',
      `SELECT t.co_atributo, t.no_atributo, g.co_grupo,
              a.ds_valor, a.vl_numerico, a.dt_valor, v.ds_valor AS no_termo,
              p.co_procedencia, a.st_captura, u.no_usuario
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
      // A ordem é a da especificidade: termo controlado ganha do texto livre,
      // que ganha do número, que ganha da data. Uma coluna só é preenchida por
      // vez — ck_mob_caso_atributo_valor garante que ao menos uma seja.
      valor: l.no_termo ?? l.ds_valor ?? l.vl_numerico ?? l.dt_valor,
      coProcedencia: l.co_procedencia,
      capturadoEm: l.st_captura,
      noAutor: l.no_usuario,
    }));
  }

  private async historicoDe(idCaso: number): Promise<TransicaoDoCaso[]> {
    const linhas = await this.acesso.consultar<LinhaTransicao>(
      'ASSISTENCIAL',
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

function resumo(l: LinhaResumo): CasoResumo {
  return {
    coCaso: l.co_caso,
    stCaso: l.st_caso,
    dtOcorrencia: l.dt_ocorrencia,
    hrOcorrencia: l.hr_ocorrencia,
    dsLocal: l.ds_local,
    qtCompletude: Number(l.qt_completude),
    dtPrazo: l.dt_prazo,
    enviadoEm: l.st_envio,
  };
}
