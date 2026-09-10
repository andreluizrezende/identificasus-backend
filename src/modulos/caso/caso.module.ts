import { Module } from '@nestjs/common';
import { CasoController } from './caso.controller';
import { CasoService } from './caso.service';

@Module({ controllers: [CasoController], providers: [CasoService], exports: [CasoService] })
export class CasoModule {}
