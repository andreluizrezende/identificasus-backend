import { Module } from '@nestjs/common';
import { SessaoController } from './sessao.controller';
import { SessaoService } from './sessao.service';

@Module({
  controllers: [SessaoController],
  providers: [SessaoService],
  exports: [SessaoService],
})
export class SessaoModule {}
