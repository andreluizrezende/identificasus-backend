import { Module } from '@nestjs/common';
import { RegulacaoController } from './regulacao.controller';
import { RegulacaoService } from './regulacao.service';

@Module({ controllers: [RegulacaoController], providers: [RegulacaoService] })
export class RegulacaoModule {}
