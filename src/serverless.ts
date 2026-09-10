import type { IncomingMessage, ServerResponse } from 'node:http';
import { criarApp } from './bootstrap';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

let handlerPromise: Promise<Handler> | null = null;

/**
 * Uma instancia do Nest por container quente, nao por requisicao. `app.init()`,
 * e nao `app.listen()`: quem escuta a porta e o runtime da Vercel, nao o Nest.
 * A promise fica em escopo de modulo de proposito — e o que faz uma invocacao
 * "quente" reaproveitar o mesmo app, em vez de recriar tudo (guards, pools
 * ainda vazios, etc.) a cada requisicao.
 */
async function montarHandler(): Promise<Handler> {
  const app = await criarApp();
  await app.init();
  return app.getHttpAdapter().getInstance();
}

export function obterHandler(): Promise<Handler> {
  if (!handlerPromise) handlerPromise = montarHandler();
  return handlerPromise;
}
