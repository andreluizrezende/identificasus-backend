import { HttpStatus } from '@nestjs/common';
import { afterEach, describe, expect, it } from 'vitest';
import { Correio } from '@/comum/correio';
import { FreioDePedidos } from './freio-de-pedidos';
import { JANELA_DE_PEDIDOS_MS, PEDIDOS_POR_JANELA, esquemaConfirmacao } from './recuperacao.esquemas';
import { CanalIndisponivel, CodigoRecusado, MuitosPedidos } from './recuperacao.service';
import { RecuperacaoController } from './recuperacao.controller';

/**
 * Estes testes cobrem o que decide sozinho, sem banco: o freio de pedidos, a
 * recusa do canal e a regra de que toda falha do passo 2 sai igual.
 *
 * (!) O QUE DEPENDE DO BANCO — codigo de uso unico, teto de tentativas,
 *     st_credenciais_alteradas derrubando a sessao — precisa de MySQL de
 *     verdade, como faz `fiocruz-backend/testes/recuperacao.test.js`. Fica
 *     pendente ate o cliente Prisma ser gerado.
 */

const ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ENV };
});

describe('freio de pedidos por e-mail', () => {
  it(`deixa passar ${PEDIDOS_POR_JANELA} e recusa o seguinte`, () => {
    const freio = new FreioDePedidos();
    for (let i = 0; i < PEDIDOS_POR_JANELA; i += 1) {
      expect(freio.excedeu('a@x.br')).toBe(false);
    }
    expect(freio.excedeu('a@x.br')).toBe(true);
  });

  it('conta por e-mail, e nao no total', () => {
    const freio = new FreioDePedidos();
    for (let i = 0; i < PEDIDOS_POR_JANELA; i += 1) freio.excedeu('a@x.br');
    expect(freio.excedeu('b@x.br')).toBe(false);
  });

  it('libera quando a janela passa', () => {
    const freio = new FreioDePedidos();
    const t0 = 1_000_000;
    for (let i = 0; i < PEDIDOS_POR_JANELA; i += 1) freio.excedeu('a@x.br', t0);
    expect(freio.excedeu('a@x.br', t0)).toBe(true);
    expect(freio.excedeu('a@x.br', t0 + JANELA_DE_PEDIDOS_MS + 1)).toBe(false);
  });
});

describe('canal de e-mail', () => {
  it('o driver de console recusa fora de desenvolvimento', () => {
    process.env.CORREIO_DRIVER = 'console';
    process.env.NODE_ENV = 'production';
    expect(new Correio().configurado()).toBe(false);
  });

  it('o driver de console vale em desenvolvimento', () => {
    process.env.CORREIO_DRIVER = 'console';
    process.env.NODE_ENV = 'development';
    expect(new Correio().configurado()).toBe(true);
  });

  it('o driver smtp exige host, usuario e senha', () => {
    process.env.CORREIO_DRIVER = 'smtp';
    delete process.env.SMTP_HOST;
    expect(new Correio().configurado()).toBe(false);
    process.env.SMTP_HOST = 'smtp.local';
    process.env.SMTP_USER = 'u';
    process.env.SMTP_PASS = 'p';
    expect(new Correio().configurado()).toBe(true);
  });

  it('nao entrega mensagem incompleta', async () => {
    process.env.CORREIO_DRIVER = 'console';
    process.env.NODE_ENV = 'test';
    const r = await new Correio().enviar({ para: '', assunto: 'a', texto: 't' });
    expect(r.entregue).toBe(false);
  });
});

describe('respostas do passo 2', () => {
  // O controller so traduz; o servico nao e exercitado aqui.
  const controller = new RecuperacaoController({} as never);
  const traduzir = (erro: unknown) =>
    (controller as unknown as { traduzir(e: unknown): { getStatus(): number; getResponse(): unknown } })
      .traduzir(erro);

  it('codigo recusado sai como 401', () => {
    expect(traduzir(new CodigoRecusado()).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('muitos pedidos sai como 429', () => {
    expect(traduzir(new MuitosPedidos()).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
  });

  it('canal indisponivel sai como 503', () => {
    expect(traduzir(new CanalIndisponivel()).getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
  });

  it('a mensagem do 401 nao distingue codigo errado de vencido', () => {
    const corpo = traduzir(new CodigoRecusado()).getResponse();
    expect(JSON.stringify(corpo)).toContain('invalido ou vencido');
    expect(JSON.stringify(corpo)).not.toContain('expirad');
  });
});

describe('validacao de entrada', () => {
  it('recusa codigo que nao tenha seis digitos', () => {
    const base = { ds_email: 'a@x.br', nova_senha: 'senhaNova2027' };
    expect(esquemaConfirmacao.safeParse({ ...base, co_codigo: '12345' }).success).toBe(false);
    expect(esquemaConfirmacao.safeParse({ ...base, co_codigo: 'abcdef' }).success).toBe(false);
    expect(esquemaConfirmacao.safeParse({ ...base, co_codigo: '123456' }).success).toBe(true);
  });

  it('recusa senha com menos de oito caracteres', () => {
    const r = esquemaConfirmacao.safeParse({
      ds_email: 'a@x.br', co_codigo: '123456', nova_senha: 'curta1',
    });
    expect(r.success).toBe(false);
  });

  it('normaliza o e-mail para minusculas', () => {
    const r = esquemaConfirmacao.parse({
      ds_email: '  Ana@Exemplo.BR ', co_codigo: '123456', nova_senha: 'senhaNova2027',
    });
    expect(r.ds_email).toBe('ana@exemplo.br');
  });
});
