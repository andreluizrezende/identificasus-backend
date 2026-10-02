import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext, INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CHAVE_FINALIDADE } from '@/acesso/finalidade.decorator';
import { FinalidadeGuard } from '@/acesso/finalidade.guard';
import { AdministracaoController } from './administracao.controller';
import { AdministracaoService } from './administracao.service';

const ROTAS = Object.getOwnPropertyNames(AdministracaoController.prototype).filter((n) => n !== 'constructor');

function contexto(rota: string, purpose: string): ExecutionContext {
  const handler = (AdministracaoController.prototype as unknown as Record<string, () => unknown>)[rota];
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: { purpose } }) }),
    getHandler: () => handler,
    getClass: () => AdministracaoController,
  } as unknown as ExecutionContext;
}

describe('autorização da administração', () => {
  it.each(ROTAS)('(!) %s é só ADMINISTRACAO: a regulação não cria contas', (rota) => {
    const handler = (AdministracaoController.prototype as unknown as Record<string, object>)[rota];
    expect(Reflect.getMetadata(CHAVE_FINALIDADE, handler as object)).toEqual(['ADMINISTRACAO']);
    const guard = new FinalidadeGuard(new Reflector());
    for (const purpose of ['ASSISTENCIAL', 'ADJUDICACAO', 'PESQUISA', 'AUDITORIA']) {
      expect(() => guard.canActivate(contexto(rota, purpose))).toThrow(ForbiddenException);
    }
    expect(guard.canActivate(contexto(rota, 'ADMINISTRACAO'))).toBe(true);
  });
});

describe('rotas HTTP da administração', () => {
  const servico = {
    criarProfissional: vi.fn().mockResolvedValue({ id: 77 }),
    alterarProfissional: vi.fn().mockResolvedValue(undefined),
    revogarAparelho: vi.fn().mockResolvedValue(undefined),
  };
  let app: INestApplication;

  beforeAll(async () => {
    // esbuild nao emite `design:paramtypes` (ver sincronizacao.controller.http.test.ts).
    Reflect.defineMetadata('design:paramtypes', [AdministracaoService], AdministracaoController);
    const modulo = await Test.createTestingModule({
      controllers: [AdministracaoController],
      providers: [{ provide: AdministracaoService, useValue: servico }],
    }).compile();
    app = modulo.createNestApplication();
    app.use((req: { user?: unknown }, _res: unknown, next: () => void) => { req.user = { usuarioId: 9 }; next(); });
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  it('cria profissional com o autor do token', async () => {
    const r = await request(app.getHttpServer()).post('/admin/profissionais').send({
      nome: 'Pessoa Nova', cpf: '529.982.247-25', email: 'nova@exemplo.org', finalidade: 'ASSISTENCIAL', perfis: ['CAMPO'],
    });
    expect(r.status).toBe(201);
    expect(servico.criarProfissional).toHaveBeenCalledWith(expect.objectContaining({ cpf: '52998224725' }), 9);
  });

  it('(!) o :id da URL não é validado como corpo (PATCH responde 204)', async () => {
    const r = await request(app.getHttpServer()).patch('/admin/profissionais/5').send({ ativo: false });
    expect(r.status).toBe(204);
    expect(servico.alterarProfissional).toHaveBeenCalledWith(5, { ativo: false }, 9);
  });

  it('revoga pelo código da URL, com motivo', async () => {
    const r = await request(app.getHttpServer()).post('/admin/aparelhos/tab-0001/revogar').send({ motivo: 'Tablet roubado na base.' });
    expect(r.status).toBe(204);
    expect(servico.revogarAparelho).toHaveBeenCalledWith('TAB-0001', { motivo: 'Tablet roubado na base.' }, 9);
  });

  it('corpo inválido: 400', async () => {
    const r = await request(app.getHttpServer()).post('/admin/profissionais').send({ nome: 'X', cpf: '123' });
    expect(r.status).toBe(400);
  });
});
