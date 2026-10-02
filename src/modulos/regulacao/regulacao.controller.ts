import { Controller, Get, Param, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ExigeFinalidade } from '@/acesso/finalidade.decorator';
import { RegulacaoService } from './regulacao.service';
import type { CasoParaRegulacao, ItemDaFila } from './regulacao.service';
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
