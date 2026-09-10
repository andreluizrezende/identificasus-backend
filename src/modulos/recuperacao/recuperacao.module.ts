import { Module } from '@nestjs/common';
import { Correio } from '@/comum/correio';
import { Credencial } from './credencial.service';
import { RecuperacaoController } from './recuperacao.controller';
import { RecuperacaoService } from './recuperacao.service';

@Module({
  controllers: [RecuperacaoController],
  providers: [RecuperacaoService, Correio, Credencial],
})
export class RecuperacaoModule {}
