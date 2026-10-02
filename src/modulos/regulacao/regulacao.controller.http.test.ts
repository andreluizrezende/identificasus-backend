import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RegulacaoController } from './regulacao.controller';
import { RegulacaoService } from './regulacao.service';

/** A decisao pela rota HTTP de verdade: o :coCaso da URL nao pode ser validado como corpo. */
describe('POST /regulacao/casos/:coCaso/decisao', () => {
  const decidir = vi.fn().mockResolvedValue({ coCaso: 'NN-2026-ABCDEFGH', stCaso: 'PERICIA' });
  let app: INestApplication;

  beforeAll(async () => {
    // esbuild nao emite `design:paramtypes` (ver sincronizacao.controller.http.test.ts).
    Reflect.defineMetadata('design:paramtypes', [RegulacaoService], RegulacaoController);
    const modulo = await Test.createTestingModule({
      controllers: [RegulacaoController],
      providers: [{ provide: RegulacaoService, useValue: { decidir } }],
    }).compile();
    app = modulo.createNestApplication();
    app.use((req: { user?: unknown }, _res: unknown, next: () => void) => { req.user = { usuarioId: 7 }; next(); });
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  it('aceita a decisao valida, com o codigo da URL e o autor do token', async () => {
    const r = await request(app.getHttpServer())
      .post('/regulacao/casos/NN-2026-ABCDEFGH/decisao')
      .send({ decisao: 'PERICIA', motivo: 'Tatuagem rara, sem candidato.' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ coCaso: 'NN-2026-ABCDEFGH', stCaso: 'PERICIA' });
    expect(decidir).toHaveBeenCalledWith('NN-2026-ABCDEFGH', 7, { decisao: 'PERICIA', motivo: 'Tatuagem rara, sem candidato.' });
  });

  it('recusa "resolvido" e motivo curto com 400', async () => {
    const servidor = app.getHttpServer();
    expect((await request(servidor).post('/regulacao/casos/X/decisao').send({ decisao: 'RESOLVIDO', motivo: 'Vinculado a fulano.' })).status).toBe(400);
    expect((await request(servidor).post('/regulacao/casos/X/decisao').send({ decisao: 'PERICIA', motivo: 'curto' })).status).toBe(400);
  });
});
