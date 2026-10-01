import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

/**
 * CORS so para origens declaradas em `CORS_ORIGENS`, separadas por virgula.
 *
 * (!) SEM A VARIAVEL, CONTINUA SEM CORS. O PWA e a API ficam atras do mesmo
 *     proxy, mesma origem (ver vite.config.ts do identificasus-app), e nao
 *     precisam disto. Quem precisa e o APK do Capacitor: o app embutido roda
 *     em `https://localhost`, outra origem, e o navegador da WebView bloqueia
 *     a resposta sem o cabecalho.
 *
 * (!) LISTA EXATA, NUNCA CURINGA. `*` e recusado aqui mesmo que alguem o
 *     coloque na variavel: com ele, qualquer site aberto num navegador poderia
 *     ler respostas da API usando o token de quem estivesse logado nele.
 *
 * (!) CORS NAO E AUTENTICACAO. Ele so decide qual pagina pode LER a resposta
 *     num navegador. Toda rota continua exigindo o token, e qualquer cliente
 *     fora de navegador ignora CORS de qualquer jeito.
 */
export function origensPermitidas(valor: string | undefined): string[] {
  if (!valor) return [];
  const origens = valor
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  for (const o of origens) {
    if (o === '*' || o.includes('*')) {
      throw new Error('CORS_ORIGENS nao aceita curinga: liste cada origem exata.');
    }
    if (!/^https?:\/\/[^/\s]+$/.test(o)) {
      throw new Error(`CORS_ORIGENS: "${o}" nao e uma origem (esquema://host[:porta]).`);
    }
  }
  return origens;
}

/** `null` quando nao ha origem declarada: o app nao chama `enableCors()`. */
export function opcoesDeCors(valor: string | undefined): CorsOptions | null {
  const origens = origensPermitidas(valor);
  if (origens.length === 0) return null;
  return {
    origin: origens,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['authorization', 'content-type'],
    // O token vai no cabecalho Authorization, nunca em cookie.
    credentials: false,
    maxAge: 600,
  };
}
