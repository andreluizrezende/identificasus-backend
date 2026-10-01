import { Injectable, Logger } from '@nestjs/common';
import { BancoPorFinalidade } from '@/acesso/banco-por-finalidade.service';
import { cifrarSenha, motivoDaRecusa } from '@/acesso/senha';

export type TrocaDeSenha = { trocada: true } | { trocada: false; motivo: string };

/**
 * Troca de senha do profissional.
 *
 * (!) HASH E CARIMBO NA MESMA INSTRUÇÃO. `ds_senha_hash` e
 *     `st_credenciais_alteradas` mudam juntos num único UPDATE: não existe
 *     instante em que a senha nova já vale e os tokens da senha velha ainda
 *     passam no guard. O mesmo UPDATE zera o freio de tentativas — quem acabou
 *     de provar posse do e-mail não deve continuar bloqueado pelos erros de
 *     quem tentava adivinhar.
 *
 * (!) A POLÍTICA É CONFERIDA DE NOVO AQUI. O esquema Zod da rota já barra
 *     senha fraca com 400; esta checagem é a última linha, para qualquer outro
 *     caminho que um dia chame a troca.
 *
 * (!) NAO LANCA, pelo mesmo motivo do correio: quem chama precisa escolher o
 *     que dizer a quem esta esperando.
 */
@Injectable()
export class Credencial {
  private readonly log = new Logger('credencial');

  constructor(private readonly acesso: BancoPorFinalidade) {}

  async trocarSenha(
    idUsuario: number,
    dsEmail: string | null,
    novaSenha: string,
  ): Promise<TrocaDeSenha> {
    const recusa = motivoDaRecusa(novaSenha, dsEmail);
    if (recusa) return { trocada: false, motivo: recusa };

    try {
      const hash = await cifrarSenha(novaSenha);
      const r = await this.acesso.executar(
        'ASSISTENCIAL',
        `UPDATE mob_usuario
            SET ds_senha_hash = ?,
                st_credenciais_alteradas = NOW(6),
                qt_falhas_login = 0,
                st_bloqueio_ate = NULL
          WHERE id_usuario = ?`,
        [hash, idUsuario],
      );
      if (r.affectedRows !== 1) return { trocada: false, motivo: 'usuario nao encontrado' };
      return { trocada: true };
    } catch (erro) {
      const motivo = erro instanceof Error ? erro.message : 'falha desconhecida';
      this.log.error(`troca de senha: ${motivo}`);
      return { trocada: false, motivo: `banco: ${motivo}` };
    }
  }
}
