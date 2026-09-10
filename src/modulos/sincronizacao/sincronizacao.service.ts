import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { BancoPorFinalidade } from '@/acesso/banco-por-finalidade.service';
import { AuditoriaService } from '@/modulos/auditoria/auditoria.service';
import { CapturaService } from '@/modulos/captura/captura.service';
import { CasoService } from '@/modulos/caso/caso.service';
import { TurnoService } from '@/modulos/turno/turno.service';
import {
  esquemaConteudoAtributo, esquemaConteudoCaso, esquemaConteudoEstado, esquemaConteudoMidia,
} from './sincronizacao.esquemas';
import type { EventoEntrada, Lote, RespostaLote } from './sincronizacao.esquemas';

const DUPLICADO = 'ER_DUP_ENTRY';

interface LinhaDispositivo extends RowDataPacket { id_dispositivo: number; id_base: number }
interface LinhaEvento extends RowDataPacket { id_evento: number; st_evento: string }

/**
 * Aplicação do lote vindo do aparelho.
 *
 * Três invariantes, e nenhuma delas mora só neste arquivo:
 *
 *  - **idempotência** — `uc_mob_evento_sincronizacao_co_idempotencia` faz o
 *    reenvio falhar no banco, não na aplicação. Reenviar nunca duplica registro
 *    porque o segundo INSERT não acontece, e não porque alguém lembrou de
 *    conferir antes;
 *  - **divergência não descarta** — valor do aparelho diferente do valor do
 *    servidor gera linha em `mob_divergencia` com os dois lados, e uma pessoa
 *    decide depois (RF-11.02). Nada é sobrescrito;
 *  - **só entra em `aplicados` o que foi gravado** — é essa lista que autoriza
 *    o aparelho a apagar a fila local. Um item a mais aqui é um registro
 *    perdido para sempre, então a lista é conservadora por construção.
 *
 * (!) UM EVENTO POR VEZ, E NÃO O LOTE INTEIRO NUMA TRANSAÇÃO. Um atributo
 *     recusado no meio do lote não pode desfazer os quarenta que já entraram —
 *     numa rede que cai, o lote seria reenviado inteiro para sempre.
 *
 * (!) `sp_mob_registra_atributo` ABRE E FECHA A PRÓPRIA TRANSAÇÃO. Chamá-la de
 *     dentro de `emTransacao` faria o COMMIT dela encerrar a transação externa
 *     no meio — o MySQL não aninha transações. Por isso a gravação do atributo
 *     acontece fora, e o estado do evento é atualizado depois dela.
 */
@Injectable()
export class SincronizacaoService {
  private readonly log = new Logger('sincronizacao');

  constructor(
    private readonly acesso: BancoPorFinalidade,
    private readonly casos: CasoService,
    private readonly captura: CapturaService,
    private readonly turnos: TurnoService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async aplicarLote(lote: Lote, usuarioId: number): Promise<RespostaLote> {
    const dispositivo = await this.aparelho(lote.coDispositivo);
    const turno = await this.turnos.ativoDe(usuarioId);
    const resposta: RespostaLote = { aplicados: [], divergentes: [], recusados: [] };

    for (const evento of lote.eventos) {
      try {
        await this.aplicarUm(evento, resposta, {
          usuarioId,
          idDispositivo: dispositivo.id_dispositivo,
          idBase: turno?.idBase ?? dispositivo.id_base,
          idTurno: turno?.idTurno ?? null,
          idViatura: turno?.idViatura ?? null,
        });
      } catch (erro) {
        const motivo = erro instanceof Error ? erro.message : 'falha desconhecida';
        this.log.warn(`evento ${evento.coIdempotencia} recusado: ${motivo}`);
        await this.marcar(evento.coIdempotencia, 'RECUSADO', motivo);
        // A mensagem que volta ao aparelho é genérica: `motivo` pode conter
        // fragmento do conteúdo, e mensagem de erro não vaza dado do caso
        // (RNF-07.05). O detalhe fica no log do servidor.
        resposta.recusados.push({
          coIdempotencia: evento.coIdempotencia,
          motivo: 'Não foi possível aplicar este evento. Ele continua na fila.',
        });
      }
    }

    await this.auditoria.registrar({
      usuarioId,
      finalidade: 'ASSISTENCIAL',
      acao: 'lote_sincronizado',
      recurso: 'sincronizacao',
      dispositivoId: dispositivo.id_dispositivo,
      detalhe: {
        recebidos: lote.eventos.length,
        aplicados: resposta.aplicados.length,
        divergentes: resposta.divergentes.length,
        recusados: resposta.recusados.length,
      },
    });

    return resposta;
  }

  // ─────────────────────────── um evento ───────────────────────────

  private async aplicarUm(
    evento: EventoEntrada,
    resposta: RespostaLote,
    ctx: {
      usuarioId: number; idDispositivo: number; idBase: number;
      idTurno: number | null; idViatura: number | null;
    },
  ): Promise<void> {
    const registro = await this.registrarEvento(evento, ctx.usuarioId, ctx.idDispositivo);

    // Já conhecíamos esta chave: o aparelho reenviou. Respondemos com o que
    // aconteceu da primeira vez, sem reaplicar nada.
    if (registro.jaExistia) {
      this.responderReenvio(registro.st_evento, evento, resposta);
      return;
    }

    switch (evento.tipo) {
      case 'CASO':
        await this.aplicarCaso(evento, ctx, registro.id_evento);
        resposta.aplicados.push(evento.coIdempotencia);
        await this.marcar(evento.coIdempotencia, 'APLICADO');
        return;

      case 'ATRIBUTO':
        await this.aplicarAtributo(evento, ctx, registro.id_evento, resposta);
        return;

      case 'ESTADO':
        await this.aplicarEstado(evento, ctx, registro.id_evento);
        resposta.aplicados.push(evento.coIdempotencia);
        await this.marcar(evento.coIdempotencia, 'APLICADO');
        return;

      case 'MIDIA':
        await this.aplicarMidia(evento, ctx, registro.id_evento);
        resposta.aplicados.push(evento.coIdempotencia);
        await this.marcar(evento.coIdempotencia, 'APLICADO');
        return;
    }
  }

  private async aplicarCaso(
    evento: EventoEntrada,
    ctx: { usuarioId: number; idBase: number; idTurno: number | null; idViatura: number | null },
    idEvento: number,
  ): Promise<void> {
    const c = esquemaConteudoCaso.parse(evento.conteudo);
    const idCaso = await this.casos.abrir(
      {
        coCaso: evento.coCaso,
        idBase: ctx.idBase,
        idViatura: ctx.idViatura,
        idTurno: ctx.idTurno,
        coOcorrenciaSamu: c.coOcorrenciaSamu ?? null,
        dtOcorrencia: c.dtOcorrencia,
        hrOcorrencia: c.hrOcorrencia,
        dsLocal: c.dsLocal ?? null,
        vlLatitude: c.vlLatitude ?? null,
        vlLongitude: c.vlLongitude ?? null,
        nuPrecisaoGps: c.nuPrecisaoGps ?? null,
      },
      ctx.usuarioId,
    );
    await this.vincular(idEvento, idCaso);
  }

  private async aplicarAtributo(
    evento: EventoEntrada,
    ctx: { usuarioId: number },
    idEvento: number,
    resposta: RespostaLote,
  ): Promise<void> {
    const a = esquemaConteudoAtributo.parse(evento.conteudo);
    const idCaso = await this.exigirCaso(evento.coCaso);
    await this.vincular(idEvento, idCaso);

    const doDispositivo = a.coValor ?? a.dsValor ?? '';
    const noServidor = await this.captura.valorVigente(idCaso, a.coAtributo);

    // (!) DIVERGÊNCIA É VALOR DIFERENTE DE OUTRA PESSOA. O mesmo profissional
    //     corrigindo o próprio registro não é conflito — é a correção que o
    //     versionamento existe para guardar. Tratar isso como divergência
    //     encheria a fila de adjudicação com o trabalho normal do campo.
    const conflita =
      noServidor !== null &&
      noServidor.valor !== doDispositivo &&
      noServidor.idUsuario !== ctx.usuarioId;

    if (conflita) {
      await this.acesso.executar(
        'ASSISTENCIAL',
        `INSERT INTO mob_divergencia
           (id_caso, id_tipo_atributo, id_evento, ds_valor_dispositivo, ds_valor_servidor,
            id_usuario_dispositivo, id_usuario_servidor)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          idCaso, noServidor.idTipoAtributo, idEvento,
          doDispositivo, noServidor.valor, ctx.usuarioId, noServidor.idUsuario,
        ],
      );
      await this.marcar(evento.coIdempotencia, 'DIVERGENTE');
      resposta.divergentes.push({
        coIdempotencia: evento.coIdempotencia,
        coAtributo: a.coAtributo,
        valorDispositivo: doDispositivo,
        valorServidor: noServidor.valor,
        autorServidor: noServidor.noUsuario,
      });
      // (!) NÃO ENTRA EM `aplicados`: o aparelho mantém o valor na fila local
      //     até uma pessoa decidir. Apagar aqui seria descartar um dos lados,
      //     que é exatamente o que RF-11.02 proíbe.
      return;
    }

    await this.captura.registrarAtributo({
      idCaso,
      coAtributo: a.coAtributo,
      coProcedencia: a.coProcedencia,
      coValor: a.coValor ?? null,
      dsValor: a.dsValor ?? null,
      usuarioId: ctx.usuarioId,
    });
    await this.marcar(evento.coIdempotencia, 'APLICADO');
    resposta.aplicados.push(evento.coIdempotencia);
  }

  private async aplicarEstado(
    evento: EventoEntrada, ctx: { usuarioId: number }, idEvento: number,
  ): Promise<void> {
    const e = esquemaConteudoEstado.parse(evento.conteudo);
    const idCaso = await this.exigirCaso(evento.coCaso);
    await this.vincular(idEvento, idCaso);
    await this.casos.transitar(idCaso, e.stAtual, ctx.usuarioId, e.dsMotivo ?? undefined);
    if (e.stAtual === 'ENCERRADO') await this.casos.confirmarEnvio(idCaso);
  }

  private async aplicarMidia(
    evento: EventoEntrada, ctx: { usuarioId: number }, idEvento: number,
  ): Promise<void> {
    const m = esquemaConteudoMidia.parse(evento.conteudo);
    const idCaso = await this.exigirCaso(evento.coCaso);
    await this.vincular(idEvento, idCaso);

    // `uc_mob_midia_co_hash` faz o mesmo arquivo enviado duas vezes virar uma
    // linha só. INSERT IGNORE porque isso é o comportamento desejado, e não uma
    // falha a reportar: a foto está lá, que é o que o aparelho precisa saber.
    await this.acesso.executar(
      'ASSISTENCIAL',
      `INSERT IGNORE INTO mob_midia
         (id_caso, id_usuario, tp_midia, ds_legenda, ds_caminho, co_hash, nu_tamanho,
          lg_cifrada, st_envio)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP(6))`,
      [
        idCaso, ctx.usuarioId, m.tpMidia, m.dsLegenda ?? null,
        m.dsCaminho, m.coHash.toLowerCase(), m.nuTamanho,
      ],
    );
  }

  // ─────────────────────────── auxiliares ───────────────────────────

  /**
   * O INSERT é a trava de idempotência. Ele vem antes de qualquer efeito: se o
   * mesmo `co_idempotencia` chegar duas vezes, a segunda esbarra na constraint
   * e nenhuma escrita acontece.
   */
  private async registrarEvento(
    evento: EventoEntrada, usuarioId: number, idDispositivo: number,
  ): Promise<{ id_evento: number; st_evento: string; jaExistia: boolean }> {
    try {
      const r = await this.acesso.executar(
        'ASSISTENCIAL',
        `INSERT INTO mob_evento_sincronizacao
           (id_dispositivo, id_usuario, co_idempotencia, tp_evento, ds_payload,
            st_evento, st_dispositivo, st_envio)
         VALUES (?, ?, ?, ?, CAST(? AS JSON), 'PENDENTE', ?, CURRENT_TIMESTAMP(6))`,
        [
          idDispositivo, usuarioId, evento.coIdempotencia, evento.tipo,
          JSON.stringify(evento.conteudo ?? null),
          evento.capturadoEm.replace('T', ' ').replace(/Z$/, ''),
        ],
      );
      return { id_evento: r.insertId, st_evento: 'PENDENTE', jaExistia: false };
    } catch (erro) {
      if (!ehDuplicado(erro)) throw erro;
      const linhas = await this.acesso.consultar<LinhaEvento>(
        'ASSISTENCIAL',
        'SELECT id_evento, st_evento FROM mob_evento_sincronizacao WHERE co_idempotencia = ?',
        [evento.coIdempotencia],
      );
      const l = linhas[0];
      if (!l) throw erro;
      return { id_evento: l.id_evento, st_evento: l.st_evento, jaExistia: true };
    }
  }

  /**
   * (!) REENVIO DE EVENTO QUE FICOU `PENDENTE` NÃO É REAPLICADO. Pendente
   *     significa "recebemos e não sabemos se o efeito entrou" — o servidor caiu
   *     entre gravar o evento e gravar o efeito. Reaplicar criaria uma segunda
   *     versão do mesmo atributo; ignorar perderia a captura. Entre duplicar e
   *     segurar, segura: o item continua na fila do aparelho e aparece na
   *     reconciliação, que é onde uma pessoa consegue olhar os dois lados.
   */
  private responderReenvio(
    stEvento: string, evento: EventoEntrada, resposta: RespostaLote,
  ): void {
    if (stEvento === 'APLICADO') {
      resposta.aplicados.push(evento.coIdempotencia);
      return;
    }
    if (stEvento === 'DIVERGENTE') {
      resposta.recusados.push({
        coIdempotencia: evento.coIdempotencia,
        motivo: 'Este registro está em divergência e aguarda decisão.',
      });
      return;
    }
    resposta.recusados.push({
      coIdempotencia: evento.coIdempotencia,
      motivo: 'Este envio já foi recebido e está em verificação. Ele continua na fila.',
    });
  }

  private async marcar(coIdempotencia: string, estado: string, erro?: string): Promise<void> {
    await this.acesso.executar(
      'ASSISTENCIAL',
      `UPDATE mob_evento_sincronizacao
          SET st_evento = ?, ds_erro = ?, st_aplicacao = CURRENT_TIMESTAMP(6),
              nu_tentativas = nu_tentativas + 1
        WHERE co_idempotencia = ?`,
      [estado, erro?.slice(0, 300) ?? null, coIdempotencia],
    );
  }

  private async vincular(idEvento: number, idCaso: number): Promise<void> {
    await this.acesso.executar(
      'ASSISTENCIAL',
      'UPDATE mob_evento_sincronizacao SET id_caso = ? WHERE id_evento = ? AND id_caso IS NULL',
      [idCaso, idEvento],
    );
  }

  private async exigirCaso(coCaso: string): Promise<number> {
    const id = await this.casos.idPorCodigo(coCaso);
    // Atributo antes do caso acontece: a fila local pode chegar fora de ordem
    // quando o aparelho fragmenta o envio. O evento fica na fila e sobe no
    // próximo lote, depois do CASO.
    if (id === null) throw new Error(`caso ${coCaso} ainda não existe no servidor`);
    return id;
  }

  private async aparelho(coDispositivo: string): Promise<LinhaDispositivo> {
    const linhas = await this.acesso.consultar<LinhaDispositivo>(
      'ASSISTENCIAL',
      `SELECT id_dispositivo, id_base FROM mob_dispositivo
        WHERE co_dispositivo = ? AND st_ativo = 'A' AND st_revogacao IS NULL LIMIT 1`,
      [coDispositivo],
    );
    const d = linhas[0];
    if (!d) {
      throw new BadRequestException({
        mensagem: 'Este aparelho não está autorizado a enviar dados.',
        acao: 'Procure a coordenação da base.',
      });
    }
    return d;
  }
}

function ehDuplicado(erro: unknown): boolean {
  return (
    typeof erro === 'object' && erro !== null && 'code' in erro &&
    (erro as { code?: unknown }).code === DUPLICADO
  );
}
