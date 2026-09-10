import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { HandleUploadBody } from '@vercel/blob/client';
import { MidiaService } from './midia.service';
import { TokenRecusado } from '@/acesso/token.service';
import type { BancoPorFinalidade } from '@/acesso/banco-por-finalidade.service';
import type { AuditoriaService } from '@/modulos/auditoria/auditoria.service';
import type { Portador, TokenService } from '@/acesso/token.service';
import type { IncomingMessage } from 'node:http';

/**
 * Dublê de `handleUpload`: reproduz só o despacho que o SDK faz (ver o
 * código-fonte dele) — chama `onBeforeGenerateToken` pro tipo
 * `generate-client-token` e `onUploadCompleted` pro `upload-completed`, sem
 * falar com a rede do Vercel Blob.
 */
vi.mock('@vercel/blob/client', () => ({
  handleUpload: vi.fn(async (opts: {
    body: HandleUploadBody;
    onBeforeGenerateToken: (p: string, c: string | null, m: boolean) => Promise<unknown>;
    onUploadCompleted?: (payload: unknown) => Promise<void>;
  }) => {
    if (opts.body.type === 'blob.generate-client-token') {
      const { pathname, clientPayload, multipart } = opts.body.payload;
      const payload = await opts.onBeforeGenerateToken(pathname, clientPayload, multipart);
      return { type: 'blob.generate-client-token', clientToken: 'token-falso', ...(payload as object) };
    }
    await opts.onUploadCompleted?.(opts.body.payload);
    return { type: 'blob.upload-completed', response: 'ok' };
  }),
}));

const UUID = 'a1b2c3d4-e5f6-4789-a012-3456789abcde';
const PORTADOR: Portador = { sub: 'idp-1', emitidoEm: 1, purpose: 'ASSISTENCIAL', ds_email: null };

function requisicao(authorization?: string): IncomingMessage {
  return { headers: { authorization } } as unknown as IncomingMessage;
}

function montar(opts: {
  portador?: Portador | Error;
  linhas?: Array<Record<string, unknown>>;
}) {
  const token = {
    verificar: opts.portador instanceof Error
      ? vi.fn().mockRejectedValue(opts.portador)
      : vi.fn().mockResolvedValue(opts.portador ?? PORTADOR),
  } as unknown as TokenService;
  const acesso = {
    consultar: vi.fn().mockResolvedValue(opts.linhas ?? [{ id_usuario: 7, st_ativo: 'A' }]),
  } as unknown as BancoPorFinalidade;
  const auditoria = { registrar: vi.fn().mockResolvedValue('hash') } as unknown as AuditoriaService;
  return { servico: new MidiaService(acesso, token, auditoria), acesso, token, auditoria };
}

function eventoDeToken(pathname: string): HandleUploadBody {
  return { type: 'blob.generate-client-token', payload: { pathname, clientPayload: null, multipart: false } };
}

describe('emissao de token de upload', () => {
  it('recusa sem cabecalho authorization', async () => {
    const { servico } = montar({});
    await expect(
      servico.tratarUpload(eventoDeToken(`casos/C1/${UUID}.jpg`), requisicao()),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('recusa token invalido, sem vazar o motivo do jose', async () => {
    const { servico } = montar({ portador: new TokenRecusado('assinatura invalida') });
    await expect(
      servico.tratarUpload(eventoDeToken(`casos/C1/${UUID}.jpg`), requisicao('Bearer abc')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('recusa finalidade diferente de ASSISTENCIAL', async () => {
    const { servico } = montar({ portador: { ...PORTADOR, purpose: 'PESQUISA' } });
    await expect(
      servico.tratarUpload(eventoDeToken(`casos/C1/${UUID}.jpg`), requisicao('Bearer abc')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('recusa quando o usuario do token nao existe mais ou esta inativo', async () => {
    const { servico } = montar({ linhas: [] });
    await expect(
      servico.tratarUpload(eventoDeToken(`casos/C1/${UUID}.jpg`), requisicao('Bearer abc')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('recusa caminho fora do padrao casos/<coCaso>/<uuid>.<ext>', async () => {
    const { servico } = montar({});
    await expect(
      servico.tratarUpload(eventoDeToken('qualquer/coisa.jpg'), requisicao('Bearer abc')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('emite o token com os limites certos e audita, quando tudo bate', async () => {
    const { servico, auditoria } = montar({});
    const pathname = `casos/C1/${UUID}.jpg`;
    const r = await servico.tratarUpload(eventoDeToken(pathname), requisicao('Bearer abc')) as unknown as {
      clientToken: string; allowedContentTypes: string[]; maximumSizeInBytes: number; addRandomSuffix: boolean;
    };

    expect(r.clientToken).toBe('token-falso');
    expect(r.allowedContentTypes).toEqual(['image/jpeg', 'image/png', 'image/webp']);
    expect(r.addRandomSuffix).toBe(false);
    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ usuarioId: 7, acao: 'midia_token_emitido', recurso: pathname }),
    );
  });
});

describe('webhook de upload concluido', () => {
  it('so repassa pro handleUpload, sem tocar no banco', async () => {
    const { servico, acesso } = montar({});
    const evento: HandleUploadBody = {
      type: 'blob.upload-completed',
      payload: {
        blob: {
          pathname: `casos/C1/${UUID}.jpg`, contentType: 'image/jpeg', contentDisposition: '',
          url: 'https://blob.vercel-storage.com/x', downloadUrl: 'https://blob.vercel-storage.com/x?download=1',
          etag: 'etag-falso',
        },
        tokenPayload: JSON.stringify({ usuarioId: 7 }),
      },
    };
    const r = await servico.tratarUpload(evento, requisicao());
    expect(r).toEqual({ type: 'blob.upload-completed', response: 'ok' });
    expect(acesso.consultar).not.toHaveBeenCalled();
  });
});
