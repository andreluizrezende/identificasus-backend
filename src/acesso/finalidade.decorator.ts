import { SetMetadata } from '@nestjs/common';
import type { Finalidade } from './finalidade';

export const CHAVE_FINALIDADE = 'finalidade';

/** Declara para que serve a rota. Sem isto, o guard nega. */
export const ExigeFinalidade = (f: Finalidade) => SetMetadata(CHAVE_FINALIDADE, f);
