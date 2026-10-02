import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAVE_PUBLICO } from '@/acesso/publico.decorator';
import { AuditoriaController } from './auditoria.controller';
import type { AuditoriaService, ResultadoDaVerificacao } from './auditoria.service';

const INTEGRA: ResultadoDaVerificacao = { integra: true, quebrouEm: null, motivo: null, elos: 3, peloConteudo: 2 };
const ANTES = process.env.CRON_SECRET;

function montar(resultado: ResultadoDaVerificacao = INTEGRA) {
  const verificarCadeia = vi.fn().mockResolvedValue(resultado);
  const controller = new AuditoriaController({ verificarCadeia } as unknown as AuditoriaService);
  return { controller, verificarCadeia };
}

beforeEach(() => {
  process.env.CRON_SECRET = 'segredo-do-agendador';
});
afterEach(() => {
  process.env.CRON_SECRET = ANTES;
});

describe('verificacao noturna da trilha', () => {
  it('e publica para o guard (o agendador nao tem login)', () => {
    const publica = new Reflector().get<boolean>(CHAVE_PUBLICO, AuditoriaController.prototype.verificar);
    expect(publica).toBe(true);
  });

  it('com o segredo certo, verifica e devolve o veredito', async () => {
    const { controller, verificarCadeia } = montar();
    await expect(controller.verificar('Bearer segredo-do-agendador')).resolves.toEqual(INTEGRA);
    expect(verificarCadeia).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, '', 'Bearer errado', 'segredo-do-agendador'])(
    '(!) sem o segredo certo (%s) recusa, sem tocar na trilha',
    async (cabecalho) => {
      const { controller, verificarCadeia } = montar();
      await expect(controller.verificar(cabecalho)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(verificarCadeia).not.toHaveBeenCalled();
    },
  );

  it('(!) sem CRON_SECRET configurado, a rota fica fechada, nao aberta', async () => {
    delete process.env.CRON_SECRET;
    const { controller, verificarCadeia } = montar();
    await expect(controller.verificar('Bearer ')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(verificarCadeia).not.toHaveBeenCalled();
  });

  it('trilha quebrada sai no veredito (o log de erro e o alarme)', async () => {
    const quebrada: ResultadoDaVerificacao = { integra: false, quebrouEm: 7, motivo: 'conteudo', elos: 9, peloConteudo: 4 };
    const { controller } = montar(quebrada);
    await expect(controller.verificar('Bearer segredo-do-agendador')).resolves.toEqual(quebrada);
  });
});
