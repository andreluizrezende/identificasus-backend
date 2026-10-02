import { SetMetadata } from '@nestjs/common';
import type { Finalidade } from './finalidade';

export const CHAVE_FINALIDADE = 'finalidade';

/**
 * Declara para que serve a rota. Sem isto, o guard nega.
 *
 * Aceita mais de uma finalidade so onde a rota nao trata dado de ninguem
 * alem do proprio usuario — o "sair", por exemplo, vale para quem entrou com
 * qualquer finalidade. Rota que le ou grava dado de caso declara uma so.
 */
export const ExigeFinalidade = (primeira: Finalidade, ...outras: Finalidade[]) =>
  SetMetadata(CHAVE_FINALIDADE, [primeira, ...outras]);
