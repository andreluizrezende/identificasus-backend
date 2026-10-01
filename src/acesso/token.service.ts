import { Injectable, Logger } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';
import type { JWTPayload } from 'jose';

/** O que o resto do sistema precisa saber sobre quem está do outro lado. */
export interface Portador {
  /** `id_usuario`, em texto — é assim que `sub` viaja num JWT. */
  sub: string;
  /** Emissão do token, em segundos. Comparada com `st_credenciais_alteradas`. */
  emitidoEm: number;
  /** Claim `purpose`; o guard de finalidade decide o que fazer com ela. */
  purpose: unknown;
  ds_email: string | null;
}

/** O que a sessão precisa carimbar no token. */
export interface Titular {
  idUsuario: number;
  finalidade: string | null;
  dsEmail: string | null;
  coSessao: string;
}

export interface TokensEmitidos {
  acesso: string;
  renovacao: string;
  expiraEmSegundos: number;
}

export class TokenRecusado extends Error {}
/** Segredo de assinatura ausente ou curto demais. Problema de implantação, não de quem entra. */
export class AssinaturaIndisponivel extends Error {}

/** Vida curta: token vazado vale pouco, e o guard reconfere a conta a cada requisição. */
export const SEGUNDOS_DE_ACESSO = 15 * 60;
/** O limite da sessão fora de linha (RF-11.04). */
export const SEGUNDOS_DE_RENOVACAO = 72 * 3600;

const EMISSOR = 'identificasus-api';
const AUDIENCIA = 'identificasus-api';
const ALGORITMO = 'HS256';
/** 256 bits: o mínimo que HS256 pede para o segredo não ser o elo fraco. */
const BYTES_MINIMOS_DO_SEGREDO = 32;

/**
 * Emissão e verificação de token, sem provedor de identidade externo.
 *
 * (!) QUEM EMITE É QUEM VERIFICA, e por isso HMAC basta. Par de chaves
 *     assimétrico só se paga quando um terceiro precisa conferir o token sem
 *     poder emiti-lo — e não há terceiro: o PWA trata o token como opaco e a
 *     API é a única a abri-lo.
 *
 * (!) `algorithms` É EXPLÍCITO. Sem essa lista, um token assinado com `none`
 *     passa — é a falha mais antiga de biblioteca de JWT que existe.
 *
 * (!) `typ` SEPARA ACESSO DE RENOVAÇÃO. Os dois são assinados com o mesmo
 *     segredo; sem a claim, o token de renovação (72 h) abriria qualquer rota
 *     como se fosse o de acesso (15 min), e a janela curta deixaria de existir.
 *
 * (!) O SEGREDO VEM DE `JWT_SEGREDO` E NUNCA TEM VALOR PADRÃO. Um padrão no
 *     código é um segredo publicado no repositório.
 */
@Injectable()
export class TokenService {
  private readonly log = new Logger('token');

  async emitir(t: Titular): Promise<TokensEmitidos> {
    const chave = this.chave();
    const claims = {
      purpose: t.finalidade ?? undefined,
      email: t.dsEmail ?? undefined,
      sid: t.coSessao,
    };

    const acesso = await new SignJWT({ ...claims, typ: 'acesso' })
      .setProtectedHeader({ alg: ALGORITMO })
      .setSubject(String(t.idUsuario))
      .setIssuer(EMISSOR)
      .setAudience(AUDIENCIA)
      .setIssuedAt()
      .setExpirationTime(`${SEGUNDOS_DE_ACESSO}s`)
      .sign(chave);

    const renovacao = await new SignJWT({ sid: t.coSessao, typ: 'renovacao' })
      .setProtectedHeader({ alg: ALGORITMO })
      .setSubject(String(t.idUsuario))
      .setIssuer(EMISSOR)
      .setAudience(AUDIENCIA)
      .setIssuedAt()
      .setExpirationTime(`${SEGUNDOS_DE_RENOVACAO}s`)
      .sign(chave);

    return { acesso, renovacao, expiraEmSegundos: SEGUNDOS_DE_ACESSO };
  }

  /** Só aceita token de acesso. Qualquer falha sai como `TokenRecusado`. */
  async verificar(token: string): Promise<Portador> {
    try {
      const { payload } = await jwtVerify(token, this.chave(), {
        issuer: EMISSOR,
        audience: AUDIENCIA,
        algorithms: [ALGORITMO],
        clockTolerance: 30,
      });
      return this.doPayload(payload);
    } catch (erro) {
      const motivo = erro instanceof Error ? erro.message : 'falha desconhecida';
      // O motivo fica no log do servidor; quem recebeu o 401 vê só o 401.
      this.log.debug(`token recusado: ${motivo}`);
      throw erro instanceof TokenRecusado ? erro : new TokenRecusado(motivo);
    }
  }

  private chave(): Uint8Array {
    const bytes = new TextEncoder().encode(process.env.JWT_SEGREDO ?? '');
    if (bytes.length < BYTES_MINIMOS_DO_SEGREDO) {
      throw new AssinaturaIndisponivel(
        `JWT_SEGREDO ausente ou com menos de ${BYTES_MINIMOS_DO_SEGREDO} bytes`,
      );
    }
    return bytes;
  }

  private doPayload(payload: JWTPayload): Portador {
    if (payload['typ'] !== 'acesso') throw new TokenRecusado('token não é de acesso');
    const sub = payload.sub;
    if (typeof sub !== 'string' || !/^[1-9]\d*$/.test(sub)) {
      throw new TokenRecusado('token sem `sub` válido');
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
