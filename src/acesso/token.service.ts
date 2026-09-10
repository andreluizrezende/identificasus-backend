import { Injectable, Logger } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTPayload } from 'jose';

/** O que o resto do sistema precisa saber sobre quem está do outro lado. */
export interface Portador {
  /** `sub` do Keycloak — é ele que casa com `mob_usuario.co_usuario_idp`. */
  sub: string;
  /** Emissão do token, em segundos. Comparada com `st_credenciais_alteradas`. */
  emitidoEm: number;
  /** Claim `purpose`; o guard de finalidade decide o que fazer com ela. */
  purpose: unknown;
  ds_email: string | null;
}

export class TokenRecusado extends Error {}

/**
 * Verificação de token contra o JWKS do Keycloak.
 *
 * (!) A CHAVE É BUSCADA DO EMISSOR, NUNCA CONFIGURADA À MÃO. `createRemoteJWKSet`
 *     mantém o cache e troca a chave sozinho quando o Keycloak gira o par. Chave
 *     pública copiada para variável de ambiente é a receita conhecida para o dia
 *     em que a rotação derruba a autenticação inteira sem ninguém entender por quê.
 *
 * (!) `algorithms` É EXPLÍCITO. Sem essa lista, um token assinado com `none` ou
 *     com HMAC usando a própria chave pública como segredo passa — é a falha mais
 *     antiga de biblioteca de JWT que existe, e ela só não acontece porque a
 *     lista está aqui.
 *
 * (!) A AUDIÊNCIA É CONFERIDA. Sem isso, um token emitido para outro cliente do
 *     mesmo realm entraria nesta API.
 */
@Injectable()
export class TokenService {
  private readonly log = new Logger('token');
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  async verificar(token: string): Promise<Portador> {
    const emissor = process.env.OIDC_ISSUER;
    if (!emissor) throw new TokenRecusado('OIDC_ISSUER não configurado');

    try {
      const { payload } = await jwtVerify(token, this.chaves(), {
        issuer: emissor,
        audience: process.env.OIDC_AUDIENCE ?? 'identificasus-api',
        algorithms: ['RS256', 'RS512', 'ES256'],
        clockTolerance: 30,
      });
      return this.doPayload(payload);
    } catch (erro) {
      const motivo = erro instanceof Error ? erro.message : 'falha desconhecida';
      // O motivo fica no log do servidor; quem recebeu o 401 vê só o 401.
      this.log.debug(`token recusado: ${motivo}`);
      throw new TokenRecusado(motivo);
    }
  }

  private chaves(): ReturnType<typeof createRemoteJWKSet> {
    if (this.jwks) return this.jwks;
    const uri =
      process.env.OIDC_JWKS_URI ??
      `${String(process.env.OIDC_ISSUER)}/protocol/openid-connect/certs`;
    this.jwks = createRemoteJWKSet(new URL(uri));
    return this.jwks;
  }

  private doPayload(payload: JWTPayload): Portador {
    const sub = payload.sub;
    if (typeof sub !== 'string' || sub.length === 0) {
      throw new TokenRecusado('token sem `sub`');
    }
    const iat = payload.iat;
    if (typeof iat !== 'number') {
      // Sem `iat` não há como comparar com `st_credenciais_alteradas`, e sem essa
      // comparação a troca de senha deixa de derrubar sessão. Recusar é a única
      // resposta que não desliga um controle em silêncio.
      throw new TokenRecusado('token sem `iat`');
    }
    const email = payload['email'];
    return {
      sub,
      emitidoEm: iat,
      purpose: payload['purpose'],
      ds_email: typeof email === 'string' ? email : null,
    };
  }
}
