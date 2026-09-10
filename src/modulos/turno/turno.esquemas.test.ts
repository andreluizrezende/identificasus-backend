import { describe, expect, it } from 'vitest';
import { esquemaAbertura, esquemaEncerramento } from './turno.esquemas';

describe('esquemaAbertura', () => {
  const base = { coDispositivo: 'DISP-1', hrInicio: '07:00', hrFim: '19:00' };

  it('aceita hora com ou sem segundos e recusa hora invalida', () => {
    expect(esquemaAbertura.safeParse(base).success).toBe(true);
    expect(esquemaAbertura.safeParse({ ...base, hrInicio: '07:00:00' }).success).toBe(true);
    expect(esquemaAbertura.safeParse({ ...base, hrInicio: '25:00' }).success).toBe(false);
  });

  it('guarnicao e por CPF de 11 digitos, ate 8 pessoas', () => {
    const cpf = '12345678901';
    expect(esquemaAbertura.safeParse({ ...base, guarnicao: [cpf] }).success).toBe(true);
    expect(esquemaAbertura.safeParse({ ...base, guarnicao: ['123'] }).success).toBe(false);
    expect(esquemaAbertura.safeParse({ ...base, guarnicao: Array(9).fill(cpf) }).success).toBe(false);
    expect(esquemaAbertura.safeParse({ ...base, guarnicao: Array(8).fill(cpf) }).success).toBe(true);
  });

  it('coDispositivo e obrigatorio; coViatura e dsFuncao sao opcionais', () => {
    expect(esquemaAbertura.safeParse({ hrInicio: '07:00', hrFim: '19:00' }).success).toBe(false);
    expect(esquemaAbertura.safeParse(base).success).toBe(true);
  });
});

describe('esquemaEncerramento', () => {
  it('ds_motivo e opcional, limitado a 120 caracteres', () => {
    expect(esquemaEncerramento.safeParse({}).success).toBe(true);
    expect(esquemaEncerramento.safeParse({ ds_motivo: 'x'.repeat(121) }).success).toBe(false);
    expect(esquemaEncerramento.safeParse({ ds_motivo: '  troca de plantao  ' }).success).toBe(true);
  });
});
