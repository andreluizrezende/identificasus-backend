import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ExigeFinalidade } from '@/acesso/finalidade.decorator';
import { ZodValidacaoPipe } from '@/comum/zod-validacao.pipe';
import {
  esquemaAlteracaoProfissional, esquemaNovoAparelho, esquemaNovoProfissional, esquemaRevogacao,
} from './administracao.esquemas';
import type {
  AlteracaoProfissional, NovoAparelho, NovoProfissional, Revogacao,
} from './administracao.esquemas';
import { AdministracaoService } from './administracao.service';
import type { Aparelho, Profissional, Referencias } from './administracao.service';

interface RequisicaoAutenticada {
  user?: { usuarioId?: number };
}

/**
 * Área de administração do console (US-34). Só a finalidade ADMINISTRACAO:
 * quem decide vínculo (ADJUDICACAO) não cria contas, e quem cria contas não lê
 * a fila. O autor de toda alteração vem do token, nunca do corpo.
 *
 * (!) Pipes de validação só no @Body: num @UsePipes do método, o :id e o
 *     :codigo da URL seriam validados contra o esquema do corpo (o defeito que
 *     derrubava resolver divergência; ver sincronizacao.controller.ts).
 */
@ApiTags('administracao')
@Controller('admin')
export class AdministracaoController {
  constructor(private readonly servico: AdministracaoService) {}

  @Get('referencias')
  @ExigeFinalidade('ADMINISTRACAO')
  @ApiOperation({ summary: 'Bases e perfis para os formulários de cadastro' })
  referencias(): Promise<Referencias> {
    return this.servico.referencias();
  }

  @Get('profissionais')
  @ExigeFinalidade('ADMINISTRACAO')
  @ApiOperation({ summary: 'Profissionais cadastrados (CPF mascarado)' })
  profissionais(): Promise<Profissional[]> {
    return this.servico.profissionais();
  }

  @Post('profissionais')
  @ExigeFinalidade('ADMINISTRACAO')
  @ApiOperation({ summary: 'Cadastra profissional sem senha: a pessoa cria a dela no primeiro acesso' })
  criarProfissional(
    @Body(new ZodValidacaoPipe(esquemaNovoProfissional)) dados: NovoProfissional,
    @Req() req: RequisicaoAutenticada,
  ): Promise<{ id: number }> {
    return this.servico.criarProfissional(dados, req.user?.usuarioId ?? 0);
  }

  @Patch('profissionais/:id')
  @HttpCode(204)
  @ExigeFinalidade('ADMINISTRACAO')
  @ApiOperation({ summary: 'Ativa, desativa ou muda finalidade e perfis de um profissional' })
  alterarProfissional(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidacaoPipe(esquemaAlteracaoProfissional)) dados: AlteracaoProfissional,
    @Req() req: RequisicaoAutenticada,
  ): Promise<void> {
    return this.servico.alterarProfissional(id, dados, req.user?.usuarioId ?? 0);
  }

  @Get('aparelhos')
  @ExigeFinalidade('ADMINISTRACAO')
  @ApiOperation({ summary: 'Aparelhos e estações autorizados e revogados' })
  aparelhos(): Promise<Aparelho[]> {
    return this.servico.aparelhos();
  }

  @Post('aparelhos')
  @HttpCode(204)
  @ExigeFinalidade('ADMINISTRACAO')
  @ApiOperation({ summary: 'Autoriza um aparelho ou estação numa base' })
  cadastrarAparelho(
    @Body(new ZodValidacaoPipe(esquemaNovoAparelho)) dados: NovoAparelho,
    @Req() req: RequisicaoAutenticada,
  ): Promise<void> {
    return this.servico.cadastrarAparelho(dados, req.user?.usuarioId ?? 0);
  }

  @Post('aparelhos/:codigo/revogar')
  @HttpCode(204)
  @ExigeFinalidade('ADMINISTRACAO')
  @ApiOperation({ summary: 'Revoga um aparelho (perdido, roubado, aposentado); não tem volta pela tela' })
  revogarAparelho(
    @Param('codigo') codigo: string,
    @Body(new ZodValidacaoPipe(esquemaRevogacao)) dados: Revogacao,
    @Req() req: RequisicaoAutenticada,
  ): Promise<void> {
    return this.servico.revogarAparelho(codigo.toUpperCase(), dados, req.user?.usuarioId ?? 0);
  }
}
