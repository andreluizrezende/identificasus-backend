import { SetMetadata } from '@nestjs/common';

export const CHAVE_PUBLICO = 'publico';

/**
 * Marca uma rota que roda sem token — e portanto sem finalidade.
 *
 * (!) USO RESTRITO. O guard de finalidade falha fechado de proposito: rota sem
 *     finalidade declarada nao passa. Este decorator e a unica porta de saida
 *     dessa regra, e existe para o que precisa acontecer ANTES de haver sessao:
 *     hoje, so a recuperacao de senha. Cada uso novo devia ser discutido, nao
 *     copiado.
 */
export const Publico = () => SetMetadata(CHAVE_PUBLICO, true);
