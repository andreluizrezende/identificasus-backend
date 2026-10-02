import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ExigeFinalidade } from '@/acesso/finalidade.decorator';
import { ZodValidacaoPipe } from '@/comum/zod-validacao.pipe';
import { RegulacaoService, esquemaDecisao } from './regulacao.service';
import type { CasoParaRegulacao, Decisao, ItemDaFila } from './regulacao.service';
import { FotosDaRegulacaoService } from './fotos.service';
import type { FotoParaRegulacao } from './fotos.service';

interface RequisicaoAutenticada {
  user?: { usuarioId?: number };
}

/** Rotas do console da Central de Regulação (identificasus-web). */
@ApiTags('regulacao')
@Controller('regulacao')
export class RegulacaoController {
  constructor(private readonly servico: RegulacaoService) {}

  @Get('fila')
  @ExigeFinalidade('ADJUDICACAO')
  @ApiOperation({ summary: 'Casos em análise ou adjudicação, por prazo' })
  fila(@Req() req: RequisicaoAutenticada): Promise<ItemDaFila[]> {
    return this.servico.fila(req.user?.usuarioId ?? 0);
  }

  @Get('casos/:coCaso')
  @ExigeFinalidade('ADJUDICACAO')
  @ApiOperation({ summary: 'Detalhe de um caso da fila: atributos, procedência e histórico' })
  caso(@Param('coCaso') coCaso: string, @Req() req: RequisicaoAutenticada): Promise<CasoParaRegulacao> {
    return this.servico.caso(coCaso, req.user?.usuarioId ?? 0);
  }

  @Post('casos/:coCaso/decisao')
  @HttpCode(200)
  @ExigeFinalidade('ADJUDICACAO')
  @ApiOperation({ summary: 'Decide o caso da fila: não resolvido ou perícia, com motivo e autor' })
  decidir(
    @Param('coCaso') coCaso: string,
    // (!) Pipe so no corpo: @UsePipes no metodo validaria o :coCaso da URL
    //     contra o esquema do corpo, e toda decisao voltaria 400.
    @Body(new ZodValidacaoPipe(esquemaDecisao)) dados: Decisao,
    @Req() req: RequisicaoAutenticada,
  ): Promise<{ coCaso: string; stCaso: string }> {
    // Autor vem do token, nunca do corpo.
    return this.servico.decidir(coCaso, req.user?.usuarioId ?? 0, dados);
  }
}

/**
 * Fotos do caso, em controlador proprio: ver uma foto e um acesso a parte na
 * trilha (FotosDaRegulacaoService), e a tela so as pede quando vai mostra-las.
 */
@ApiTags('regulacao')
@Controller('regulacao')
export class RegulacaoFotosController {
  constructor(private readonly servico: FotosDaRegulacaoService) {}

  @Get('casos/:coCaso/fotos')
  @ExigeFinalidade('ADJUDICACAO')
  @ApiOperation({ summary: 'Fotos de um caso da fila, com URL de leitura assinada e curta' })
  fotos(@Param('coCaso') coCaso: string, @Req() req: RequisicaoAutenticada): Promise<FotoParaRegulacao[]> {
    return this.servico.fotos(coCaso, req.user?.usuarioId ?? 0);
  }
}
