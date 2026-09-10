import { Module } from '@nestjs/common';
import { CapturaService } from './captura.service';

@Module({ providers: [CapturaService], exports: [CapturaService] })
export class CapturaModule {}
