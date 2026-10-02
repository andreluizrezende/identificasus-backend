import { describe, expect, it } from 'vitest';
import {
  cpfMascarado, cpfValido, esquemaAlteracaoProfissional, esquemaNovoAparelho, esquemaNovoProfissional,
} from './administracao.esquemas';

// CPFs de teste com dígitos verificadores válidos (gerados, não de pessoas).
const CPF_VALIDO = '52998224725';

describe('CPF', () => {
  it('confere os dígitos verificadores', () => {
    expect(cpfValido(CPF_VALIDO)).toBe(true);
    expect(cpfValido('52998224724')).toBe(false);
    expect(cpfValido('11111111111')).toBe(false);
    expect(cpfValido('5299822472')).toBe(false);
  });

  it('mascara para a lista, mostrando só o miolo', () => {
    expect(cpfMascarado(CPF_VALIDO)).toBe('***.982.247-**');
  });
});

describe('novo profissional', () => {
  const base = {
    nome: 'Pessoa de Teste', cpf: '529.982.247-25', email: ' Pessoa@Exemplo.ORG ',
    finalidade: 'ASSISTENCIAL', perfis: ['campo', 'CAMPO', 'supervisao'],
  };

  it('normaliza CPF, e-mail e perfis (sem repetição)', () => {
    const r = esquemaNovoProfissional.parse(base);
    expect(r).toMatchObject({ cpf: CPF_VALIDO, email: 'pessoa@exemplo.org', perfis: ['CAMPO', 'SUPERVISAO'], cargo: null });
  });

  it('(!) não aceita senha no cadastro: a pessoa cria a dela no primeiro acesso', () => {
    const r = esquemaNovoProfissional.parse({ ...base, senha: 'qualquer-senha-123' });
    expect(r).not.toHaveProperty('senha');
  });

  it.each([
    [{ cpf: '52998224724' }],
    [{ email: 'sem-arroba' }],
    [{ finalidade: 'ROOT' }],
    [{ nome: 'A' }],
  ])('recusa %j', (troca) => {
    expect(esquemaNovoProfissional.safeParse({ ...base, ...troca }).success).toBe(false);
  });
});

describe('alteração e aparelho', () => {
  it('alteração vazia é recusada', () => {
    expect(esquemaAlteracaoProfissional.safeParse({}).success).toBe(false);
    expect(esquemaAlteracaoProfissional.safeParse({ ativo: false }).success).toBe(true);
  });

  it('código de aparelho em maiúsculas; "-HOM-" é reservado', () => {
    expect(esquemaNovoAparelho.parse({ codigo: 'tab-0001', base: 'samu-01' })).toEqual({ codigo: 'TAB-0001', base: 'SAMU-01', modelo: null });
    expect(esquemaNovoAparelho.safeParse({ codigo: 'APAR-HOM-0099', base: 'X' }).success).toBe(false);
    expect(esquemaNovoAparelho.safeParse({ codigo: 'TAB 01', base: 'X' }).success).toBe(false);
  });
});
