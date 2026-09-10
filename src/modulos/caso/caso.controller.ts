import { Controller, Get, Param, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ExigeFinalidade } from '@/acesso/finalidade.decorator';
import { CasoService } from './caso.service';

interface RequisicaoAutenticada {
  user?: { usuarioId?: number };
}

@ApiTags('casos')
@Controller('casos')
export class CasoController {
  constructor(private readonly servico: CasoService) {}

  @Get('meus')
  @ExigeFinalidade('ASSISTENCIAL')
  @ApiOperation({ summary: 'Casos do turno do profissional autenticado' })
  meus(@Req() req: RequisicaoAutenticada) {
    return this.servico.meusCasos(req.user?.usuarioId ?? 0);
  }

  @Get(':coCaso')
  @ExigeFinalidade('ASSISTENCIAL')
  @ApiOperation({ summary: 'Detalhe do caso, sem candidatos e sem escore' })
  porCodigo(@Param('coCaso') coCaso: string, @Req() req: RequisicaoAutenticada) {
    return this.servico.porCodigo(coCaso, req.user?.usuarioId ?? 0);
  }
}
