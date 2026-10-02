import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SincronizacaoController } from './sincronizacao.controller';
import { SincronizacaoService } from './sincronizacao.service';

/**
 * Pela rota HTTP de verdade (pipes e decoradores do Nest), e nao chamando o
 * metodo: um @UsePipes no metodo valida TAMBEM o :id da URL contra o esquema
 * do corpo, e so uma requisicao mostra isso.
 */
describe('POST /sincronizacao/divergencia/:id/resolver', () => {
  const resolver = vi.fn().mockResolvedValue(undefined);
  let app: INestApplication;

  beforeAll(async () => {
    // O Vitest compila com esbuild, que nao emite `design:paramtypes`: sem
    // isto o Nest cria o controller sem o servico (500 em vez da resposta).
    Reflect.defineMetadata('design:paramtypes', [SincronizacaoService], SincronizacaoController);
    const modulo = await Test.createTestingModule({
      controllers: [SincronizacaoController],
      providers: [{ provide: SincronizacaoService, useValue: { resolver } }],
    }).compile();
    app = modulo.createNestApplication();
    app.use((req: { user?: unknown }, _res: unknown, next: () => void) => { req.user = { usuarioId: 7 }; next(); });
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  it('(!) aceita o corpo valido e passa o id numerico da URL', async () => {
    const r = await request(app.getHttpServer())
      .post('/sincronizacao/divergencia/15/resolver')
      .send({ resolucao: 'SERVIDOR', justificativa: 'Conferido na ficha.' });
    expect(r.status).toBe(201);
    expect(resolver).toHaveBeenCalledWith(15, 7, { resolucao: 'SERVIDOR', justificativa: 'Conferido na ficha.' });
  });

  it('recusa corpo invalido', async () => {
    const r = await request(app.getHttpServer())
      .post('/sincronizacao/divergencia/15/resolver')
      .send({ resolucao: 'QUALQUER' });
    expect(r.status).toBe(400);
  });
});
