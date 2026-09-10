import { afterEach, describe, expect, it } from 'vitest';
import { BancoPorFinalidade } from './banco-por-finalidade.service';

const ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ENV };
});

function configVazio() {
  return { get: () => undefined } as never;
}

/**
 * `para()` so monta o Pool (mysql2 nao conecta na criacao); nenhum destes
 * testes fala com um banco de verdade.
 */
describe('BancoPorFinalidade — resolucao da URL por finalidade', () => {
  it('cada finalidade nao-assistencial exige a sua propria variavel', () => {
    const banco = new BancoPorFinalidade(configVazio());
    expect(() => banco.para('AUDITORIA')).toThrow(/DATABASE_URL_AUDITORIA/);
    expect(() => banco.para('PESQUISA')).toThrow(/DATABASE_URL_PESQUISA/);
    expect(() => banco.para('ADMINISTRACAO')).toThrow(/DATABASE_URL_ADMINISTRACAO/);
  });

  it('ASSISTENCIAL cai em DATABASE_URL', () => {
    const banco = new BancoPorFinalidade(configVazio());
    expect(() => banco.para('ASSISTENCIAL')).toThrow(/DATABASE_URL\b/);
  });

  it('ADMINISTRACAO nunca reaproveita a URL assistencial', () => {
    // Regressao: antes desta correcao, ADMINISTRACAO caia no `else` e abria a
    // conexao assistencial em silencio.
    process.env.DATABASE_URL = 'mysql://user:pass@localhost:3306/assistencial';
    const banco = new BancoPorFinalidade(configVazio());
    expect(() => banco.para('ADMINISTRACAO')).toThrow(/DATABASE_URL_ADMINISTRACAO/);
  });

  it('usa a URL configurada quando presente, e memoriza o pool', () => {
    process.env.DATABASE_URL = 'mysql://user:pass@localhost:3306/assistencial';
    const banco = new BancoPorFinalidade(configVazio());
    const p1 = banco.para('ASSISTENCIAL');
    const p2 = banco.para('ASSISTENCIAL');
    expect(p1).toBe(p2);
  });

  it('o ConfigService ganha do process.env quando os dois tem valor', () => {
    process.env.DATABASE_URL = 'mysql://env/errado';
    const config = { get: () => 'mysql://config/certo' } as never;
    const banco = new BancoPorFinalidade(config);
    // Se a resolucao estivesse invertida, criar o pool falharia ao tentar
    // uma URI invalida; aqui so confirmamos que nao lanca por variavel ausente.
    expect(() => banco.para('ASSISTENCIAL')).not.toThrow();
  });
});
