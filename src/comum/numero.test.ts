import { describe, expect, it } from 'vitest';
import { chaveDoAparelho, chaveDoServidor, numeroLegivel, valorDoAtributo } from './numero';

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
    expect(valorDoAtributo({ ...vazio, dt_valor: '2026-10-01' })).toBe('01/10/2026');
  });
});

describe('chave de comparacao (aparelho x servidor)', () => {
  const servidor = (parcial: Partial<Parameters<typeof chaveDoServidor>[0]>) =>
    chaveDoServidor({ tp_dado: 'T', co_termo: null, ds_valor: null, vl_numerico: null, dt_valor: null, ...parcial });

  it('termo compara pelo codigo, nunca pela descricao', () => {
    expect(chaveDoAparelho('L', { coValor: 'M' })).toBe(servidor({ tp_dado: 'L', co_termo: 'M' }));
  });

  it('numero: 1.80 do aparelho e 1.800 do banco sao o mesmo valor', () => {
    expect(chaveDoAparelho('N', { dsValor: '1.80' })).toBe(servidor({ tp_dado: 'N', vl_numerico: '1.800' }));
    expect(chaveDoAparelho('N', { dsValor: '1.75' })).not.toBe(servidor({ tp_dado: 'N', vl_numerico: '1.800' }));
  });

  it('data compara pela data; texto antigo de numero tambem casa', () => {
    expect(chaveDoAparelho('D', { dsValor: '2026-10-01' })).toBe(servidor({ tp_dado: 'D', dt_valor: '2026-10-01' }));
    expect(chaveDoAparelho('N', { dsValor: '1.8' })).toBe(servidor({ tp_dado: 'N', ds_valor: '1.80' }));
  });

  it('texto compara aparando espacos', () => {
    expect(chaveDoAparelho('T', { dsValor: ' camisa azul ' })).toBe(servidor({ ds_valor: 'camisa azul' }));
  });
});
