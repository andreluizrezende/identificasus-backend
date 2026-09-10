import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CHAVE_FINALIDADE } from './finalidade.decorator';
import { CHAVE_PUBLICO } from './publico.decorator';
import { ehFinalidade } from './finalidade';
import type { Finalidade } from './finalidade';

interface RequisicaoComToken {
  user?: { sub?: string; purpose?: unknown; usuarioId?: number };
  finalidade?: Finalidade;
}

/**
 * Primeira das quatro camadas do ADR-14. A finalidade declarada na rota tem de
 * bater com a claim `purpose` do token; o que passa daqui escolhe o pool de
 * banco correspondente.
 */
@Injectable()
export class FinalidadeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(contexto: ExecutionContext): boolean {
    // Rota marcada com @Publico() roda sem token: e o caso da recuperacao de
    // senha, que existe justamente para quem nao consegue entrar.
    const publico = this.reflector.getAllAndOverride<boolean | undefined>(CHAVE_PUBLICO, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);
    if (publico === true) return true;

    const exigida = this.reflector.getAllAndOverride<Finalidade | undefined>(CHAVE_FINALIDADE, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);

    // Rota sem finalidade declarada nao passa: falha fechado, por escolha.
    if (!exigida) throw new ForbiddenException({ mensagem: 'Rota sem finalidade declarada.' });

    const req = contexto.switchToHttp().getRequest<RequisicaoComToken>();
    const doToken = req.user?.purpose;

    if (!ehFinalidade(doToken) || doToken !== exigida) {
      // Tentativa negada e registrada como evento de severidade alta (RF-06.06).
      throw new ForbiddenException({
        mensagem: 'Este acesso nao esta autorizado para a finalidade da sua sessao.',
      });
    }

    req.finalidade = exigida;
    return true;
  }
}
