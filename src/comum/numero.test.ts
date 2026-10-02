import { describe, expect, it } from 'vitest';
import { numeroLegivel, valorDoAtributo } from './numero';

describe('numeroLegivel', () => {
  it.each([
    ['1.720', '1,72'],
    ['1.80', '1,8'],
    ['1250.000', '1.250'],
    ['42', '42'],
    ['-3.5', '-3,5'],
  ])('%s vira %s', (entrada, saida) => {
    expect(numeroLegivel(entrada)).toBe(saida);
  });

  it('texto que nao e numero volta como veio', () => {
    expect(numeroLegivel('cerca de 1,80')).toBe('cerca de 1,80');
    expect(numeroLegivel(null)).toBeNull();
  });
});

describe('valorDoAtributo', () => {
  const vazio = { no_termo: null, ds_valor: null, vl_numerico: null, dt_valor: null };

  it('(!) atributo numerico gravado como texto sai formatado', () => {
    expect(valorDoAtributo({ ...vazio, tp_dado: 'N', ds_valor: '1.80' })).toBe('1,8');
  });

  it('texto de atributo que nao e numerico nao e mexido', () => {
    expect(valorDoAtributo({ ...vazio, tp_dado: 'T', ds_valor: '1.80 m de altura' })).toBe('1.80 m de altura');
  });

  it('termo controlado ganha do texto; numero e data na ordem de sempre', () => {
    expect(valorDoAtributo({ ...vazio, no_termo: 'Masculino', ds_valor: 'x' })).toBe('Masculino');
    expect(valorDoAtributo({ ...vazio, vl_numerico: '1.720' })).toBe('1,72');
    expect(valorDoAtributo({ ...vazio, dt_valor: '2026-10-01' })).toBe('2026-10-01');
  });
});
