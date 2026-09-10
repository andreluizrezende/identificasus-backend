import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { RowDataPacket } from 'mysql2/promise';
import { BancoPorFinalidade } from './banco-por-finalidade.service';
import { CHAVE_PUBLICO } from './publico.decorator';
import { TokenService } from './token.service';

interface RequisicaoAutenticavel {
  headers: Record<string, string | string[] | undefined>;
  user?: { sub: string; purpose: unknown; usuarioId: number; noUsuario: string };
}

interface LinhaUsuario extends RowDataPacket {
  id_usuario: number;
  no_usuario: string;
  st_ativo: string;
  st_credenciais_alteradas: string | null;
}

/**
 * Autenticação: roda **antes** do guard de finalidade e é quem preenche
 * `req.user`. Registrada primeiro em `app.module.ts` — a ordem dos APP_GUARD é
 * a ordem de execução, e o guard de finalidade não tem o que checar num
 * `req.user` vazio.
 *
 * Faz três coisas, nessa ordem:
 *
 *  1. verifica a assinatura do token contra o JWKS do Keycloak;
 *  2. resolve o `sub` para a linha de `mob_usuario` — token válido de alguém que
 *     não está no cadastro local não entra;
 *  3. compara a emissão do token com `st_credenciais_alteradas`.
 *
 * (!) O PASSO 3 É O QUE FAZ A TROCA DE SENHA VALER ALGUMA COISA. Sem ele, quem
 *     entrou com a senha antiga continua dentro até o token expirar — e o
 *     "perdi minha senha" existe justamente para o caso em que outra pessoa
 *     está com a senha antiga. É o mesmo controle do `requireAuth` do
 *     fiocruz-backend, e o motivo de a coluna existir.
 *
 * (!) UMA CONSULTA POR REQUISIÇÃO, DE PROPÓSITO. Dá para guardar isto em
 *     memória, e o preço do cache é uma janela em que a sessão derrubada
 *     continua viva. Enquanto a consulta for um índice único, ela fica.
 */
@Injectable()
export class AutenticacaoGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly token: TokenService,
    private readonly acesso: BancoPorFinalidade,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const publico = this.reflector.getAllAndOverride<boolean | undefined>(CHAVE_PUBLICO, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);
    if (publico === true) return true;

    const req = contexto.switchToHttp().getRequest<RequisicaoAutenticavel>();
    const portador = await this.token.verificar(this.doCabecalho(req));

    const linhas = await this.acesso.consultar<LinhaUsuario>(
      'ASSISTENCIAL',
      `SELECT id_usuario, no_usuario, st_ativo, st_credenciais_alteradas
         FROM mob_usuario
        WHERE co_usuario_idp = ?
        LIMIT 1`,
      [portador.sub],
      );

    const usuario = linhas[0];
    if (!usuario || usuario.st_ativo !== 'A') {
      throw new UnauthorizedException({
        sucesso: false,
        mensagem: 'Sessão não autorizada',
        acao: 'Entre novamente',
      });
    }

    if (this.credencialMudouDepoisDoToken(usuario.st_credenciais_alteradas, portador.emitidoEm)) {
      throw new UnauthorizedException({
        sucesso: false,
        mensagem: 'Sua senha foi alterada',
        acao: 'Entre com a senha nova',
      });
    }

    req.user = {
      sub: portador.sub,
      purpose: portador.purpose,
      usuarioId: usuario.id_usuario,
      noUsuario: usuario.no_usuario,
    };
    return true;
  }

  private doCabecalho(req: RequisicaoAutenticavel): string {
    const bruto = req.headers['authorization'];
    const cabecalho = Array.isArray(bruto) ? bruto[0] : bruto;
    const casado = /^Bearer (.+)$/i.exec(cabecalho ?? '');
    if (!casado?.[1]) {
      throw new UnauthorizedException({
        sucesso: false,
        mensagem: 'Sessão não autorizada',
        acao: 'Entre novamente',
      });
    }
    return casado[1];
  }

  /**
   * O pool abre com `dateStrings: true`, então a coluna chega como texto do
   * MySQL (`YYYY-MM-DD HH:MM:SS.ffffff`) — em UTC, que é como o pool escreve.
   * O `Z` no fim é o que impede o Node de reinterpretar isso no fuso da
   * máquina e deslocar a comparação em três horas.
   */
  private credencialMudouDepoisDoToken(coluna: string | null, emitidoEm: number): boolean {
    if (!coluna) return false;
    const alteradaEm = Date.parse(`${coluna.replace(' ', 'T')}Z`);
    if (Number.isNaN(alteradaEm)) return false;
    // Um segundo de folga: `iat` tem resolução de segundo e a coluna, de
    // microssegundo. Sem a folga, um token emitido no mesmo segundo da troca
    // seria derrubado por arredondamento.
    return Math.floor(alteradaEm / 1000) > emitidoEm + 1;
  }
}
