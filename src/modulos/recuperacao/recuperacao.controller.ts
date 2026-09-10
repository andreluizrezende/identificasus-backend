import {
  Body, Controller, HttpCode, HttpException, HttpStatus, Post, Req, UsePipes,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Publico } from '@/acesso/publico.decorator';
import { ZodValidacaoPipe } from '@/comum/zod-validacao.pipe';
import {
  CanalIndisponivel, CodigoRecusado, MuitosPedidos, RecuperacaoService,
} from './recuperacao.service';
import { esquemaConfirmacao, esquemaPedido } from './recuperacao.esquemas';
import type { Confirmacao, Pedido, RespostaRecuperacao } from './recuperacao.esquemas';

interface RequisicaoComIp { ip?: string }

/**
 * "Perdi minha senha", em duas rotas publicas.
 *
 * (!) PUBLICAS PORQUE TEM DE SER: quem esqueceu a senha nao tem token. Sao as
 *     unicas rotas com @Publico() no projeto, e o guard de finalidade continua
 *     falhando fechado para todo o resto.
 */
@ApiTags('recuperacao')
@Controller('sessao/recuperacao')
export class RecuperacaoController {
  constructor(private readonly servico: RecuperacaoService) {}

  @Post()
  @Publico()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Passo 1: pede o codigo de redefinicao por e-mail' })
  @UsePipes(new ZodValidacaoPipe(esquemaPedido))
  async pedir(@Body() pedido: Pedido, @Req() req: RequisicaoComIp): Promise<RespostaRecuperacao> {
    try {
      return await this.servico.pedirCodigo(pedido, req.ip ?? 'desconhecido');
    } catch (erro) {
      throw this.traduzir(erro);
    }
  }

  @Post('confirmacao')
  @Publico()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Passo 2: usa o codigo e define a nova senha' })
  @UsePipes(new ZodValidacaoPipe(esquemaConfirmacao))
  async confirmar(@Body() dados: Confirmacao): Promise<RespostaRecuperacao> {
    try {
      return await this.servico.confirmar(dados);
    } catch (erro) {
      throw this.traduzir(erro);
    }
  }

  /**
   * (!) TODAS AS FALHAS DO PASSO 2 SAEM COMO O MESMO 401. Codigo errado,
   *     vencido, ja usado e e-mail desconhecido dao a mesma resposta: separar
   *     os casos ajuda quem tenta adivinhar mais do que ajuda quem esqueceu a
   *     senha, e quem esqueceu tem o botao de pedir outro.
   */
  private traduzir(erro: unknown): HttpException {
    if (erro instanceof MuitosPedidos) {
      return new HttpException(
        {
          sucesso: false,
          mensagem: 'Muitos pedidos para este e-mail',
          acao: 'Espere alguns minutos antes de pedir outro codigo',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (erro instanceof CanalIndisponivel) {
      return new HttpException(
        {
          sucesso: false,
          mensagem: 'O envio de e-mail nao esta configurado neste servidor',
          acao: 'Procure quem administra para redefinir sua senha',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (erro instanceof CodigoRecusado) {
      return new HttpException(
        {
          sucesso: false,
          mensagem: 'Codigo invalido ou vencido',
          acao: 'Peca um codigo novo e use o que chegar por ultimo',
        },
        HttpStatus.UNAUTHORIZED,
      );
    }
    return new HttpException(
      {
        sucesso: false,
        mensagem: 'Nao foi possivel concluir a operacao agora',
        acao: 'Tente novamente em instantes',
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
