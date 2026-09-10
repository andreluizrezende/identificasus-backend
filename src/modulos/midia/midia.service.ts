import { ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { handleUpload } from '@vercel/blob/client';
import type { HandleUploadBody } from '@vercel/blob/client';
import type { IncomingMessage } from 'node:http';
import type { RowDataPacket } from 'mysql2/promise';
import { BancoPorFinalidade } from '@/acesso/banco-por-finalidade.service';
import { TokenRecusado, TokenService } from '@/acesso/token.service';
import { AuditoriaService } from '@/modulos/auditoria/auditoria.service';
import { CAMINHO_DE_FOTO, TAMANHO_MAXIMO_DA_FOTO_EM_BYTES, TIPOS_DE_FOTO_PERMITIDOS } from './midia.esquemas';

interface LinhaUsuario extends RowDataPacket {
  id_usuario: number;
  st_ativo: string;
}

/**
 * Emissao de token de upload direto para o Vercel Blob (store
 * `identificasus-fotos`). O binario nunca passa por esta funcao: o
 * aparelho recebe um token de curta duracao e envia a foto direto para o
 * armazenamento de objetos — mesma decisao ja registrada em
 * `SincronizacaoService.aplicarMidia`, so que agora com onde o binario cai
 * de fato. `mob_midia` continua gravado la, quando o evento MIDIA do lote
 * chega; esta rota nao grava linha nenhuma, so autoriza o envio.
 *
 * (!) A ROTA QUE CHAMA ISTO E @Publico() NO NEST, DE PROPOSITO. O SDK usa o
 *     mesmo endpoint para dois papeis: (1) o aparelho pedindo o token, com
 *     Bearer normal, e (2) o proprio Vercel Blob avisando que o upload
 *     terminou — uma chamada servidor-a-servidor, sem Bearer nenhum,
 *     validada pela assinatura do webhook (`handleUpload` confere sozinho).
 *     Por isso a autenticacao do papel (1) acontece aqui dentro, manualmente,
 *     replicando o que AutenticacaoGuard + FinalidadeGuard fariam — nao tem
 *     como um guard global distinguir os dois papeis antes do corpo chegar.
 */
@Injectable()
export class MidiaService {
  private readonly log = new Logger('midia');

  constructor(
    private readonly acesso: BancoPorFinalidade,
    private readonly token: TokenService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async tratarUpload(
    body: HandleUploadBody,
    req: IncomingMessage,
  ): Promise<{ type: string } & Record<string, unknown>> {
    return handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        const usuarioId = await this.autenticar(req);

        // (!) SO CAMINHO NO PADRAO `casos/<coCaso>/<uuid>.<ext>` GANHA TOKEN.
        //     Sem isto, um Bearer valido escreveria em qualquer lugar do
        //     store — a autenticacao provaria quem e a pessoa, nao onde ela
        //     pode escrever.
        if (!CAMINHO_DE_FOTO.test(pathname)) {
          throw new ForbiddenException(`caminho fora do padrao esperado: ${pathname}`);
        }

        await this.auditoria.registrar({
          usuarioId,
          finalidade: 'ASSISTENCIAL',
          acao: 'midia_token_emitido',
          recurso: pathname,
          detalhe: null,
        });

        return {
          allowedContentTypes: TIPOS_DE_FOTO_PERMITIDOS,
          maximumSizeInBytes: TAMANHO_MAXIMO_DA_FOTO_EM_BYTES,
          // O uuid no caminho ja evita colisao; sufixo aleatorio mudaria o
          // nome depois do aparelho ja ter calculado o hash pro evento MIDIA.
          addRandomSuffix: false,
          tokenPayload: JSON.stringify({ usuarioId }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // So log. Quem grava mob_midia e o evento MIDIA do lote de
        // sincronizacao — duplicar a escrita aqui abriria um segundo
        // caminho para a mesma linha, com duas fontes de verdade.
        this.log.log(`upload concluido: ${blob.pathname} (payload: ${tokenPayload ?? 'nenhum'})`);
      },
    });
  }

  private async autenticar(req: IncomingMessage): Promise<number> {
    const bruto = req.headers['authorization'];
    const cabecalho = Array.isArray(bruto) ? bruto[0] : bruto;
    const casado = /^Bearer (.+)$/i.exec(cabecalho ?? '');
    if (!casado?.[1]) throw new UnauthorizedException('Sessão não autorizada');

    const portador = await this.verificarToken(casado[1]);
    if (portador.purpose !== 'ASSISTENCIAL') {
      throw new ForbiddenException('Finalidade da sessão não autoriza upload de mídia');
    }

    const linhas = await this.acesso.consultar<LinhaUsuario>(
      'ASSISTENCIAL',
      'SELECT id_usuario, st_ativo FROM mob_usuario WHERE co_usuario_idp = ? LIMIT 1',
      [portador.sub],
    );
    const usuario = linhas[0];
    if (!usuario || usuario.st_ativo !== 'A') throw new UnauthorizedException('Sessão não autorizada');

    return usuario.id_usuario;
  }

  private async verificarToken(token: string): Promise<{ sub: string; purpose: unknown }> {
    try {
      return await this.token.verificar(token);
    } catch (erro) {
      if (erro instanceof TokenRecusado) throw new UnauthorizedException('Sessão não autorizada');
      throw erro;
    }
  }
}
