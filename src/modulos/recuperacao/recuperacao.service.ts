import { Injectable, Logger } from '@nestjs/common';
import { compare, hash } from 'bcryptjs';
import { randomInt } from 'node:crypto';
import { BancoPorFinalidade } from '@/acesso/banco-por-finalidade.service';
import type { RowDataPacket } from 'mysql2/promise';
import { Correio } from '@/comum/correio';
import { AuditoriaService } from '@/modulos/auditoria/auditoria.service';
import { Credencial } from './credencial.service';
import { FreioDePedidos } from './freio-de-pedidos';
import {
  MINUTOS_DE_VALIDADE,
  RESPOSTA_NEUTRA,
  TENTATIVAS_POR_CODIGO,
} from './recuperacao.esquemas';
import type { Confirmacao, Pedido, RespostaRecuperacao } from './recuperacao.esquemas';

export class CanalIndisponivel extends Error {}
export class MuitosPedidos extends Error {}
export class CodigoRecusado extends Error {}

interface LinhaUsuario extends RowDataPacket {
  id_usuario: number;
  no_usuario: string;
  ds_email: string;
  co_usuario_idp: string | null;
  st_ativo: string;
}

interface LinhaRecuperacao extends RowDataPacket {
  id_recuperacao: number;
  co_codigo_hash: string;
  qt_tentativas: number;
}

/**
 * Recuperacao de senha, em dois passos: pedir o codigo e usar o codigo.
 *
 * Referencia: fiocruz-backend/routes/sessao/recuperacao.js. Vieram de la o
 * fluxo, os limites, a resposta neutra e a ordem das escritas. Duas coisas
 * mudaram, e por que:
 *
 * (!) A SENHA NAO E TROCADA AQUI. Ver Credencial: quem guarda credencial neste
 *     projeto e o Keycloak.
 *
 * (!) CODIGO DE 6 DIGITOS, E NAO LINK. Link e a escolha certa para web, onde o
 *     navegador que abre o e-mail e o mesmo que abre o site. Aqui o cliente e
 *     um PWA usado na base e na viatura, e o caso mais comum em campo e ler o
 *     e-mail no computador da base e digitar no tablet. Um codigo atravessa
 *     esse caminho; um link, nao.
 */
@Injectable()
export class RecuperacaoService {
  private readonly log = new Logger('recuperacao');
  private readonly freio = new FreioDePedidos();

  constructor(
    private readonly acesso: BancoPorFinalidade,
    private readonly correio: Correio,
    private readonly credencial: Credencial,
    private readonly auditoria: AuditoriaService,
  ) {}

  // ------------------------ passo 1: pedir o codigo ------------------------

  async pedirCodigo(pedido: Pedido, origem: string): Promise<RespostaRecuperacao> {
    // (!) A CHECAGEM DO CANAL VEM ANTES DA CONSULTA AO BANCO, de proposito. Se
    //     viesse depois, "nao foi possivel enviar" so apareceria para e-mail
    //     que existe — e o erro viraria um detector de contas.
    if (!this.correio.configurado()) {
      this.log.error('correio nao configurado; recuperacao indisponivel');
      throw new CanalIndisponivel();
    }

    if (this.freio.excedeu(pedido.ds_email)) throw new MuitosPedidos();

    const usuario = await this.buscarUsuario(pedido.ds_email);

    // Conta que nao existe ou esta inativa sai por aqui, com a MESMA resposta
    // de quem recebeu o codigo. Nada e gravado, nada e enviado.
    if (!usuario || usuario.st_ativo !== 'A') return RESPOSTA_NEUTRA;

    // Pedir um codigo novo invalida os anteriores: dois codigos validos ao
    // mesmo tempo dobram a superficie sem servir para nada.
    await this.acesso.executar('ASSISTENCIAL',
      'UPDATE mob_recuperacao SET st_uso = NOW(6) WHERE id_usuario = ? AND st_uso IS NULL',
      [usuario.id_usuario]);

    // crypto, e nao Math.random: o segundo e previsivel e isto e credencial.
    const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0');

    await this.acesso.executar('ASSISTENCIAL',
      `INSERT INTO mob_recuperacao (id_usuario, co_codigo_hash, st_expiracao, ds_origem)
       VALUES (?, ?, DATE_ADD(NOW(6), INTERVAL ? MINUTE), ?)`,
      [usuario.id_usuario, await hash(codigo, 10), MINUTOS_DE_VALIDADE, origem]);

    const entrega = await this.correio.enviar({
      para: usuario.ds_email,
      assunto: 'Codigo para redefinir sua senha - IdentificaSUS',
      texto: [
        `Ola, ${usuario.no_usuario}.`,
        '',
        `Seu codigo para redefinir a senha e: ${codigo}`,
        '',
        `O codigo vale por ${MINUTOS_DE_VALIDADE} minutos e so pode ser usado uma vez.`,
        'Se nao foi voce que pediu, ignore este e-mail: sua senha continua a mesma.',
      ].join('\n'),
    });

    await this.auditoria.registrar({
      usuarioId: usuario.id_usuario,
      finalidade: 'ASSISTENCIAL',
      acao: entrega.entregue ? 'RECUPERACAO_PEDIDA' : 'RECUPERACAO_FALHOU',
      recurso: `mob_usuario/${usuario.id_usuario}`,
      detalhe: entrega.entregue ? null : { motivo: entrega.motivo },
    });

    // (!) Falha na entrega NAO muda a resposta, pelo mesmo motivo de sempre: um
    //     texto diferente aqui contaria que este e-mail existe. Quem precisa
    //     saber da falha e o log e a trilha, nao quem esta do outro lado.
    return RESPOSTA_NEUTRA;
  }

  // ---------------- passo 2: usar o codigo e trocar a senha ----------------

  async confirmar(dados: Confirmacao): Promise<RespostaRecuperacao> {
    // Uma recusa so para tudo o que da errado daqui para baixo. Separar
    // "codigo errado" de "codigo vencido" ajuda quem tenta adivinhar mais do
    // que ajuda quem esqueceu a senha — e quem esqueceu tem o botao de pedir
    // outro.
    const usuario = await this.buscarUsuario(dados.ds_email);
    if (!usuario || usuario.st_ativo !== 'A') throw new CodigoRecusado();

    const linhas = await this.acesso.consultar<LinhaRecuperacao>('ASSISTENCIAL',
      `SELECT id_recuperacao, co_codigo_hash, qt_tentativas
         FROM mob_recuperacao
        WHERE id_usuario = ? AND st_uso IS NULL AND st_expiracao > NOW(6)
        ORDER BY id_recuperacao DESC LIMIT 1`,
      [usuario.id_usuario]);

    const pedido = linhas[0];
    if (!pedido) throw new CodigoRecusado();

    if (pedido.qt_tentativas >= TENTATIVAS_POR_CODIGO) {
      // Queima o codigo: sem isto, o teto seria so um atraso.
      await this.queimar(pedido.id_recuperacao);
      await this.auditoria.registrar({
        usuarioId: usuario.id_usuario,
        finalidade: 'ASSISTENCIAL',
        acao: 'RECUPERACAO_QUEIMADA',
        recurso: `mob_usuario/${usuario.id_usuario}`,
        detalhe: { motivo: 'tentativas esgotadas' },
      });
      throw new CodigoRecusado();
    }

    if (!(await compare(dados.co_codigo, pedido.co_codigo_hash))) {
      await this.acesso.executar('ASSISTENCIAL',
        'UPDATE mob_recuperacao SET qt_tentativas = qt_tentativas + 1 WHERE id_recuperacao = ?',
        [pedido.id_recuperacao]);
      await this.auditoria.registrar({
        usuarioId: usuario.id_usuario,
        finalidade: 'ASSISTENCIAL',
        acao: 'RECUPERACAO_NEGADA',
        recurso: `mob_usuario/${usuario.id_usuario}`,
        detalhe: { tentativa: pedido.qt_tentativas + 1 },
      });
      throw new CodigoRecusado();
    }

    // (!) A ORDEM IMPORTA: marcar o uso ANTES de trocar a senha. Se a troca
    //     falhar, sobra um codigo queimado — irritante e corrigivel. Na ordem
    //     inversa, uma falha entre as duas deixaria a senha nova com o codigo
    //     ainda valido.
    await this.queimar(pedido.id_recuperacao);

    const troca = await this.credencial.trocarSenha(
      usuario.co_usuario_idp ?? '',
      dados.nova_senha,
    );
    if (!troca.trocada) {
      await this.auditoria.registrar({
        usuarioId: usuario.id_usuario,
        finalidade: 'ASSISTENCIAL',
        acao: 'RECUPERACAO_FALHOU',
        recurso: `mob_usuario/${usuario.id_usuario}`,
        detalhe: { motivo: troca.motivo },
      });
      throw new CanalIndisponivel();
    }

    // (!) st_credenciais_alteradas e o que derruba as sessoes abertas: sem ela,
    //     quem entrou com a senha velha continuaria dentro ate o token expirar.
    //     Trocar a senha e nao invalidar o token seria o recurso pela metade,
    //     justo no caso que ele existe para atender.
    await this.acesso.executar('ASSISTENCIAL',
      'UPDATE mob_usuario SET st_credenciais_alteradas = NOW(6) WHERE id_usuario = ?',
      [usuario.id_usuario]);

    await this.auditoria.registrar({
      usuarioId: usuario.id_usuario,
      finalidade: 'ASSISTENCIAL',
      acao: 'SENHA_REDEFINIDA',
      recurso: `mob_usuario/${usuario.id_usuario}`,
      detalhe: null,
    });

    return { sucesso: true, mensagem: 'Senha redefinida', acao: 'Entre com a senha nova' };
  }

  // ------------------------------ apoio ------------------------------

  private async buscarUsuario(dsEmail: string): Promise<LinhaUsuario | null> {
    const linhas = await this.acesso.consultar<LinhaUsuario>('ASSISTENCIAL',
      `SELECT id_usuario, no_usuario, ds_email, co_usuario_idp, st_ativo
         FROM mob_usuario WHERE ds_email = ? LIMIT 1`,
      [dsEmail]);
    return linhas[0] ?? null;
  }

  private async queimar(id: number): Promise<void> {
    await this.acesso.executar('ASSISTENCIAL',
      'UPDATE mob_recuperacao SET st_uso = NOW(6) WHERE id_recuperacao = ?', [id]);
  }
}
