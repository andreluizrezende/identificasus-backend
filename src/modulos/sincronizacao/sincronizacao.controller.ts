import {
  Body, Controller, Get, Param, ParseIntPipe, Post, Req, UsePipes,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ExigeFinalidade } from '@/acesso/finalidade.decorator';
import { ZodValidacaoPipe } from '@/comum/zod-validacao.pipe';
import { esquemaLote, esquemaResolucaoDivergencia } from './sincronizacao.esquemas';
import type { Lote, ResolucaoDivergencia, RespostaLote } from './sincronizacao.esquemas';
import { SincronizacaoService } from './sincronizacao.service';
import type { DivergenciaPendente } from './sincronizacao.service';

interface RequisicaoAutenticada {
  user?: { usuarioId: number };
}

@ApiTags('sincronizacao')
@Controller('sincronizacao')
export class SincronizacaoController {
  constructor(private readonly servico: SincronizacaoService) {}

  @Post('lote')
  @ExigeFinalidade('ASSISTENCIAL')
  @ApiOperation({ summary: 'Aplica um lote idempotente vindo do aparelho de campo' })
  @UsePipes(new ZodValidacaoPipe(esquemaLote))
  aplicar(@Body() lote: Lote, @Req() req: RequisicaoAutenticada): Promise<RespostaLote> {
    // O autor vem do token, nunca do corpo: um `usuarioId` no payload seria um
    // campo que o aparelho escolhe, e autoria escolhida pelo cliente não é
    // autoria.
    return this.servico.aplicarLote(lote, req.user?.usuarioId ?? 0);
  }

  @Get('divergencia')
  @ExigeFinalidade('ASSISTENCIAL')
  @ApiOperation({ summary: 'Divergencias pendentes de decisao, visiveis ao profissional (M12)' })
  listarDivergencias(@Req() req: RequisicaoAutenticada): Promise<DivergenciaPendente[]> {
    return this.servico.listarPendentes(req.user?.usuarioId ?? 0);
  }

  @Post('divergencia/:id/resolver')
  @ExigeFinalidade('ASSISTENCIAL')
  @ApiOperation({ summary: 'Decide qual valor vale: dispositivo, servidor ou os dois (RF-11.02)' })
  @UsePipes(new ZodValidacaoPipe(esquemaResolucaoDivergencia))
  resolverDivergencia(
    @Param('id', ParseIntPipe) id: number,
    @Body() dados: ResolucaoDivergencia,
    @Req() req: RequisicaoAutenticada,
  ): Promise<void> {
    return this.servico.resolver(id, req.user?.usuarioId ?? 0, dados);
  }
}
