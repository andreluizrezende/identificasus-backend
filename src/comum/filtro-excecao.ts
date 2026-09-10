import { ArgumentsHost, Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';

/** Mensagem acionavel, sem dado pessoal e sem detalhe interno (RNF-07.05). */
@Catch()
export class FiltroExcecao implements ExceptionFilter {
  private readonly log = new Logger('excecao');

  catch(erro: unknown, host: ArgumentsHost): void {
    const resposta = host.switchToHttp().getResponse<Response>();

    if (erro instanceof HttpException) {
      resposta.status(erro.getStatus()).json(erro.getResponse());
      return;
    }

    this.log.error(erro instanceof Error ? erro.message : 'erro nao tratado');
    resposta.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      mensagem: 'Nao foi possivel concluir a operacao. Tente novamente em instantes.',
    });
  }
}
