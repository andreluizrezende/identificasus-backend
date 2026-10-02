import { Global, Module } from '@nestjs/common';
import { AuditoriaController } from './auditoria.controller';
import { AuditoriaService } from './auditoria.service';

@Global()
@Module({ controllers: [AuditoriaController], providers: [AuditoriaService], exports: [AuditoriaService] })
export class AuditoriaModule {}
