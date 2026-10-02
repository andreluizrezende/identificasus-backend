import { Module } from '@nestjs/common';
import { AssinaturaDeFoto } from '@/modulos/midia/assinatura-de-foto';
import { RegulacaoController, RegulacaoFotosController } from './regulacao.controller';
import { RegulacaoService } from './regulacao.service';
import { FotosDaRegulacaoService } from './fotos.service';

@Module({
  controllers: [RegulacaoController, RegulacaoFotosController],
  providers: [RegulacaoService, FotosDaRegulacaoService, AssinaturaDeFoto],
})
export class RegulacaoModule {}
