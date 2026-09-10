import { BadRequestException, Injectable } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';

/**
 * Toda fronteira externa passa por aqui. TypeScript apaga tipos em tempo de
 * execucao: sem validacao, um payload malformado vira objeto de dominio
 * corrompido em silencio.
 */
@Injectable()
export class ZodValidacaoPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly esquema: ZodSchema<T>) {}

  transform(valor: unknown): T {
    const r = this.esquema.safeParse(valor);
    if (!r.success) {
      // Nunca devolve o conteudo recebido: mensagem de erro nao vaza dado
      // do caso (RNF-07.05).
      throw new BadRequestException({
        mensagem: 'Requisicao invalida.',
        campos: r.error.issues.map((i) => ({ caminho: i.path.join('.'), erro: i.code })),
      });
    }
    return r.data;
  }
}
