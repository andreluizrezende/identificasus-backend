import { Module } from '@nestjs/common';
import { CapturaModule } from '@/modulos/captura/captura.module';
import { CasoModule } from '@/modulos/caso/caso.module';
import { TurnoModule } from '@/modulos/turno/turno.module';
import { SincronizacaoController } from './sincronizacao.controller';
import { SincronizacaoService } from './sincronizacao.service';

@Module({
  imports: [CasoModule, CapturaModule, TurnoModule],
  controllers: [SincronizacaoController],
  providers: [SincronizacaoService],
})
export class SincronizacaoModule {}
