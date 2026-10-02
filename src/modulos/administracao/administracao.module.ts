import { Module } from '@nestjs/common';
import { AdministracaoController } from './administracao.controller';
import { AdministracaoService } from './administracao.service';

@Module({ controllers: [AdministracaoController], providers: [AdministracaoService] })
export class AdministracaoModule {}
