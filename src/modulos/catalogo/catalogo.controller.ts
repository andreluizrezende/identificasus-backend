import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ExigeFinalidade } from '@/acesso/finalidade.decorator';
import { CatalogoService } from './catalogo.service';

@ApiTags('catalogo')
@Controller('catalogo')
export class CatalogoController {
  constructor(private readonly servico: CatalogoService) {}

  @Get()
  @ExigeFinalidade('ASSISTENCIAL')
  @ApiOperation({ summary: 'Catalogo do protocolo: etapas, atributos e vocabulario' })
  listar() {
    return this.servico.listar();
  }
}
