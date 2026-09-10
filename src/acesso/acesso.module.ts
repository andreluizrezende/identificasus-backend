import { Global, Module } from '@nestjs/common';
import { BancoPorFinalidade } from './banco-por-finalidade.service';
import { TokenService } from './token.service';

@Global()
@Module({
  providers: [BancoPorFinalidade, TokenService],
  exports: [BancoPorFinalidade, TokenService],
})
export class AcessoModule {}
