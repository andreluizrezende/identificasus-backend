import { Body, Controller, Post, Req, UsePipes } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ExigeFinalidade } from '@/acesso/finalidade.decorator';
import { ZodValidacaoPipe } from '@/comum/zod-validacao.pipe';
import { esquemaLote } from './sincronizacao.esquemas';
import type { Lote, RespostaLote } from './sincronizacao.esquemas';
import { SincronizacaoService } from './sincronizacao.service';

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
}
