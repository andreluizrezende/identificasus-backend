import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus, Post, Req, UsePipes,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ExigeFinalidade } from '@/acesso/finalidade.decorator';
import { ZodValidacaoPipe } from '@/comum/zod-validacao.pipe';
import { TurnoService } from './turno.service';
import { esquemaAbertura, esquemaEncerramento } from './turno.esquemas';
import type { AberturaDeTurno, EncerramentoDeTurno, TurnoAberto } from './turno.esquemas';

interface RequisicaoAutenticada {
  user?: { usuarioId: number };
}

@ApiTags('turno')
@Controller('turno')
export class TurnoController {
  constructor(private readonly servico: TurnoService) {}

  @Get('atual')
  @ExigeFinalidade('ASSISTENCIAL')
  @ApiOperation({ summary: 'Turno aberto do profissional, se houver (tela M2)' })
  atual(@Req() req: RequisicaoAutenticada): Promise<TurnoAberto | null> {
    return this.servico.ativoDe(req.user?.usuarioId ?? 0);
  }

  @Post()
  @ExigeFinalidade('ASSISTENCIAL')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Abre o turno na base do aparelho' })
  @UsePipes(new ZodValidacaoPipe(esquemaAbertura))
  abrir(@Body() dados: AberturaDeTurno, @Req() req: RequisicaoAutenticada): Promise<TurnoAberto> {
    return this.servico.abrir(dados, req.user?.usuarioId ?? 0);
  }

  @Delete()
  @ExigeFinalidade('ASSISTENCIAL')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Encerra o turno aberto' })
  @UsePipes(new ZodValidacaoPipe(esquemaEncerramento))
  async encerrar(
    @Body() dados: EncerramentoDeTurno, @Req() req: RequisicaoAutenticada,
  ): Promise<void> {
    await this.servico.encerrar(req.user?.usuarioId ?? 0, dados.ds_motivo);
  }
}
