import {
  Body, Controller, Delete, HttpCode, HttpException, HttpStatus, Logger, Post, Req, UsePipes,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ExigeFinalidade } from '@/acesso/finalidade.decorator';
import { Publico } from '@/acesso/publico.decorator';
import { ZodValidacaoPipe } from '@/comum/zod-validacao.pipe';
import {
  AutenticacaoIndisponivel, CredencialRecusada, DispositivoNaoAutorizado, SessaoEncerrada,
  SessaoService,
} from './sessao.service';
import { esquemaEntrada, esquemaRenovacao, esquemaSaida } from './sessao.esquemas';
import type {
  AcessoRenovado, Entrada, Renovacao, Saida, SessaoAberta,
} from './sessao.esquemas';

interface RequisicaoDoCampo {
  ip?: string;
  user?: { usuarioId: number };
}

@ApiTags('sessao')
@Controller('sessao')
export class SessaoController {
  private readonly log = new Logger('sessao');

  constructor(private readonly servico: SessaoService) {}

  @Post()
  @Publico()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Entrar: valida aparelho, confere a senha e abre a sessão de 72 h' })
  @UsePipes(new ZodValidacaoPipe(esquemaEntrada))
  async entrar(@Body() dados: Entrada, @Req() req: RequisicaoDoCampo): Promise<SessaoAberta> {
    try {
      return await this.servico.entrar(dados, req.ip ?? 'desconhecido');
    } catch (erro) {
      throw this.traduzir(erro);
    }
  }

  /**
   * (!) PÚBLICA PORQUE TEM DE SER: quem chega aqui é justamente quem está com
   *     o token de acesso vencido. Quem autentica é o token de renovação, no
   *     corpo, e o serviço reconfere a sessão inteira no banco.
   */
  @Post('renovacao')
  @Publico()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Troca o token de renovação por um token de acesso novo' })
  @UsePipes(new ZodValidacaoPipe(esquemaRenovacao))
  async renovar(@Body() dados: Renovacao): Promise<AcessoRenovado> {
    try {
      return await this.servico.renovar(dados.renovacao);
    } catch (erro) {
      throw this.traduzir(erro);
    }
  }

  // Sair vale para qualquer finalidade: e a propria sessao, e o console da
  // regulacao (ADJUDICACAO) tambem precisa encerrar a sua. O UPDATE em
  // mob_sessao continua pelo pool assistencial, dono da tabela de sessoes.
  @Delete()
  @ExigeFinalidade('ASSISTENCIAL', 'ADJUDICACAO')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Sair: encerra a sessão local' })
  @UsePipes(new ZodValidacaoPipe(esquemaSaida))
  async sair(@Body() dados: Saida, @Req() req: RequisicaoDoCampo): Promise<void> {
    await this.servico.sair(req.user?.usuarioId ?? 0, dados.coSessao, dados.ds_motivo);
  }

  @Post('expurgo')
  @ExigeFinalidade('ASSISTENCIAL')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Confirma que o aparelho apagou os dados locais (tela M13)' })
  @UsePipes(new ZodValidacaoPipe(esquemaSaida))
  async expurgo(@Body() dados: Saida, @Req() req: RequisicaoDoCampo): Promise<void> {
    await this.servico.confirmarExpurgo(req.user?.usuarioId ?? 0, dados.coSessao);
  }

  /**
   * (!) SÃO TRÊS RESPOSTAS, E NÃO UMA, e a diferença em relação à recuperação de
   *     senha é deliberada. Lá, distinguir os casos entregaria a lista de quem
   *     trabalha aqui. Aqui, quem está do outro lado já digitou a senha de uma
   *     conta e um código de aparelho — o que se aprende com a distinção é qual
   *     dos dois estava errado, e isso é exatamente o que a pessoa às três da
   *     manhã, na base, precisa saber para resolver sozinha.
   *
   *     O que continua indistinto é o que importa: senha errada, conta
   *     inexistente e conta inativa saem todas como o mesmo 401.
   */
  private traduzir(erro: unknown): HttpException {
    if (erro instanceof DispositivoNaoAutorizado) {
      return new HttpException(
        {
          sucesso: false,
          mensagem: 'Este aparelho não está autorizado a carregar dados',
          acao: 'Procure a coordenação da base para cadastrar o aparelho',
        },
        HttpStatus.FORBIDDEN,
      );
    }
    if (erro instanceof CredencialRecusada) {
      return new HttpException(
        {
          sucesso: false,
          mensagem: 'E-mail ou senha incorretos',
          acao: 'Confira os dados e tente de novo',
        },
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (erro instanceof SessaoEncerrada) {
      return new HttpException(
        {
          sucesso: false,
          mensagem: 'Sua sessão foi encerrada',
          acao: 'Entre novamente',
        },
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (erro instanceof AutenticacaoIndisponivel) {
      return new HttpException(
        {
          sucesso: false,
          mensagem: 'O serviço de autenticação não respondeu',
          acao: 'Tente novamente em instantes; se persistir, avise o plantão de TI',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    // (!) O ERRO INESPERADO VAI PARA O LOG. Sem isto, uma falha de conexao com o
    //     banco virava um 500 generico sem rastro nenhum, e a causa (senha,
    //     URL, rede) so aparecia por tentativa. Vai so o codigo e a mensagem do
    //     erro: as do mysql2 nunca trazem a senha.
    const codigo = (erro as { code?: unknown } | null)?.code;
    this.log.error(
      `erro inesperado na sessao: ${typeof codigo === 'string' ? `${codigo} ` : ''}`
        + (erro instanceof Error ? erro.message : String(erro)),
    );
    return new HttpException(
      {
        sucesso: false,
        mensagem: 'Não foi possível entrar agora',
        acao: 'Tente novamente em instantes',
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
