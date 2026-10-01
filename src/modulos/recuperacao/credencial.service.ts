import { Injectable, Logger } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { BancoPorFinalidade } from '@/acesso/banco-por-finalidade.service';
import {
  SENHAS_NO_HISTORICO, cifrarSenha, motivoDaRecusa, senhaJaUsada,
} from '@/acesso/senha';

export type TrocaDeSenha =
  | { trocada: true }
  | { trocada: false; motivo: string; repetida?: true };

/** Senha nova conferida e já cifrada, pronta para `aplicar`. */
export type Preparo =
  | { pronta: true; hash: string }
  | { pronta: false; motivo: string; repetida?: true };

interface LinhaHash extends RowDataPacket {
  ds_senha_hash: string | null;
}

interface LinhaHistorico extends RowDataPacket {
  id_senha_historico: number;
  ds_senha_hash: string;
}

/** A atual mais as anteriores guardadas em mob_senha_historico. */
const ANTERIORES_GUARDADAS = SENHAS_NO_HISTORICO - 1;

/**
 * Troca de senha do profissional, em duas etapas.
 *
 * (!) PREPARAR E APLICAR SÃO SEPARADOS DE PROPÓSITO. Conferir o histórico
 *     custa um scrypt por senha (centenas de milissegundos cada), e a
 *     recuperação precisa saber se a senha é repetida ANTES de queimar o
 *     código. Com as etapas juntas, ou o histórico seria conferido duas vezes,
 *     ou uma senha repetida queimaria o código e obrigaria a pedir outro
 *     e-mail. `trocarSenha` junta as duas para quem não tem essa ordem.
 *
 * (!) HASH, HISTÓRICO E CARIMBO NA MESMA TRANSAÇÃO. A senha que sai vai para
 *     mob_senha_historico, a nova entra com `st_credenciais_alteradas` (que
 *     derruba as sessões da senha velha) e o freio de tentativas zera. Não
 *     existe instante com a senha nova valendo e os tokens velhos passando.
 *
 * (!) NAO LANCA, pelo mesmo motivo do correio: quem chama precisa escolher o
 *     que dizer a quem esta esperando.
 */
@Injectable()
export class Credencial {
  private readonly log = new Logger('credencial');

  constructor(private readonly acesso: BancoPorFinalidade) {}

  /**
   * Confere política e histórico e cifra a senha nova. Não grava nada.
   * A política é conferida de novo aqui, e não só no esquema Zod da rota: é a
   * última linha para qualquer outro caminho que um dia chame a troca.
   */
  async preparar(idUsuario: number, dsEmail: string | null, novaSenha: string): Promise<Preparo> {
    const recusa = motivoDaRecusa(novaSenha, dsEmail);
    if (recusa) return { pronta: false, motivo: recusa };

    try {
      const atual = await this.acesso.consultar<LinhaHash>(
        'ASSISTENCIAL',
        'SELECT ds_senha_hash FROM mob_usuario WHERE id_usuario = ? LIMIT 1',
        [idUsuario],
      );
      const anteriores = await this.acesso.consultar<LinhaHistorico>(
        'ASSISTENCIAL',
        `SELECT id_senha_historico, ds_senha_hash FROM mob_senha_historico
          WHERE id_usuario = ? ORDER BY id_senha_historico DESC LIMIT ?`,
        [idUsuario, ANTERIORES_GUARDADAS],
      );
      const hashes = [atual[0]?.ds_senha_hash ?? null, ...anteriores.map((l) => l.ds_senha_hash)];
      if (await senhaJaUsada(novaSenha, hashes)) {
        return {
          pronta: false,
          repetida: true,
          motivo: `senha igual a uma das ${SENHAS_NO_HISTORICO} ultimas`,
        };
      }
      return { pronta: true, hash: await cifrarSenha(novaSenha) };
    } catch (erro) {
      const motivo = erro instanceof Error ? erro.message : 'falha desconhecida';
      this.log.error(`preparar troca de senha: ${motivo}`);
      return { pronta: false, motivo: `banco: ${motivo}` };
    }
  }

  /** Grava a senha preparada: histórico, hash novo, carimbo e freio, juntos. */
  async aplicar(idUsuario: number, hash: string): Promise<TrocaDeSenha> {
    try {
      return await this.acesso.emTransacao('ASSISTENCIAL', async (executar, consultar) => {
        // Lida de novo dentro da transação: entre preparar e aplicar, outra
        // troca pode ter acontecido, e é a senha atual DE AGORA que sai.
        const atual = await consultar<LinhaHash>(
          'SELECT ds_senha_hash FROM mob_usuario WHERE id_usuario = ? LIMIT 1',
          [idUsuario],
        );
        if (atual.length === 0) return { trocada: false, motivo: 'usuario nao encontrado' };

        const saindo = atual[0]?.ds_senha_hash ?? null;
        // Conta que nunca teve senha (vinda do Keycloak, ver db/06) não deixa
        // nada para o histórico.
        if (saindo) {
          await executar(
            'INSERT INTO mob_senha_historico (id_usuario, ds_senha_hash) VALUES (?, ?)',
            [idUsuario, saindo],
          );
        }

        await executar(
          `UPDATE mob_usuario
              SET ds_senha_hash = ?,
                  st_credenciais_alteradas = NOW(6),
                  qt_falhas_login = 0,
                  st_bloqueio_ate = NULL
            WHERE id_usuario = ?`,
          [hash, idUsuario],
        );

        // Só as mais recentes ficam: ver db/07 sobre não guardar além do que a
        // regra usa.
        const guardadas = await consultar<LinhaHistorico>(
          `SELECT id_senha_historico, ds_senha_hash FROM mob_senha_historico
            WHERE id_usuario = ? ORDER BY id_senha_historico DESC`,
          [idUsuario],
        );
        const sobrando = guardadas.slice(ANTERIORES_GUARDADAS).map((l) => l.id_senha_historico);
        if (sobrando.length > 0) {
          await executar(
            `DELETE FROM mob_senha_historico
              WHERE id_senha_historico IN (${sobrando.map(() => '?').join(', ')})`,
            sobrando,
          );
        }
        return { trocada: true } as const;
      });
    } catch (erro) {
      const motivo = erro instanceof Error ? erro.message : 'falha desconhecida';
      this.log.error(`troca de senha: ${motivo}`);
      return { trocada: false, motivo: `banco: ${motivo}` };
    }
  }

  /** Preparar e aplicar de uma vez, para quem não precisa de nada entre os dois. */
  async trocarSenha(idUsuario: number, dsEmail: string | null, novaSenha: string): Promise<TrocaDeSenha> {
    const preparo = await this.preparar(idUsuario, dsEmail, novaSenha);
    if (!preparo.pronta) {
      return preparo.repetida
        ? { trocada: false, motivo: preparo.motivo, repetida: true }
        : { trocada: false, motivo: preparo.motivo };
    }
    return this.aplicar(idUsuario, preparo.hash);
  }
}
