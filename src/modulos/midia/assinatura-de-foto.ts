import { Injectable } from '@nestjs/common';
import { issueSignedToken, presignUrl } from '@vercel/blob';

/** Quanto tempo uma URL de leitura de foto vale. */
export const VALIDADE_DA_URL_MS = 10 * 60_000;

/**
 * URL de leitura assinada para uma foto do store privado.
 *
 * (!) O BINARIO NAO PASSA PELO BACKEND. A funcao da Vercel limita a resposta a
 *     cerca de 4,5 MB, e uma foto pode ter 15 MB. O backend decide quem pode
 *     ver (e registra na trilha); o navegador busca a foto direto no Blob, com
 *     uma URL que:
 *       - vale para UM arquivo (o pathname esta na assinatura: trocar o
 *         caminho na URL da 403);
 *       - vale so para leitura;
 *       - expira em minutos. Quem copiar a URL de uma tela aberta tem esse
 *         tempo, e nao acesso ao store.
 */
@Injectable()
export class AssinaturaDeFoto {
  async urlDeLeitura(pathname: string, validoAte: number): Promise<string> {
    const token = await issueSignedToken({ pathname, operations: ['get'], validUntil: validoAte });
    const { presignedUrl } = await presignUrl(token, {
      operation: 'get', pathname, access: 'private', validUntil: validoAte,
    });
    return presignedUrl;
  }
}
