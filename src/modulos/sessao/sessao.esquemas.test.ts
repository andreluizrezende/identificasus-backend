import { describe, expect, it } from 'vitest';
import { esquemaEntrada, esquemaSaida } from './sessao.esquemas';

describe('esquemaEntrada', () => {
  const base = { ds_email: 'ana@exemplo.br', senha: 'segredo123', coDispositivo: 'DISP-1' };

  it('normaliza e-mail e aparelho, mas nunca a senha', () => {
    const r = esquemaEntrada.parse({
      ds_email: '  Ana@Exemplo.BR ', senha: '  segredo123  ', coDispositivo: '  disp-1  ',
    });
    expect(r.ds_email).toBe('ana@exemplo.br');
    expect(r.coDispositivo).toBe('disp-1');
    // Espaco na senha e literal: cortar mudaria a credencial que o Keycloak recebe.
    expect(r.senha).toBe('  segredo123  ');
  });

  it('recusa senha vazia', () => {
    expect(esquemaEntrada.safeParse({ ...base, senha: '' }).success).toBe(false);
  });

  it('recusa e-mail invalido', () => {
    expect(esquemaEntrada.safeParse({ ...base, ds_email: 'nao-e-email' }).success).toBe(false);
  });

  it('recusa coDispositivo vazio ou maior que 30 caracteres', () => {
    expect(esquemaEntrada.safeParse({ ...base, coDispositivo: '' }).success).toBe(false);
    expect(esquemaEntrada.safeParse({ ...base, coDispositivo: 'x'.repeat(31) }).success).toBe(false);
    expect(esquemaEntrada.safeParse({ ...base, coDispositivo: 'x'.repeat(30) }).success).toBe(true);
  });
});

describe('esquemaSaida', () => {
  it('exige coSessao como uuid', () => {
    expect(esquemaSaida.safeParse({ coSessao: 'nao-e-uuid' }).success).toBe(false);
    expect(esquemaSaida.safeParse({ coSessao: '123e4567-e89b-12d3-a456-426614174000' }).success).toBe(true);
  });

  it('ds_motivo e opcional, mas limitado a 120 caracteres', () => {
    const uuid = '123e4567-e89b-12d3-a456-426614174000';
    expect(esquemaSaida.safeParse({ coSessao: uuid }).success).toBe(true);
    expect(esquemaSaida.safeParse({ coSessao: uuid, ds_motivo: 'x'.repeat(121) }).success).toBe(false);
  });
});
