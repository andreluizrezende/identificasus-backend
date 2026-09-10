import { describe, expect, it } from 'vitest';
import { FINALIDADES, ehFinalidade } from './finalidade';

describe('ehFinalidade', () => {
  it('aceita qualquer valor da lista', () => {
    for (const f of FINALIDADES) expect(ehFinalidade(f)).toBe(true);
  });

  it('recusa finalidade inventada', () => {
    expect(ehFinalidade('QUALQUER')).toBe(false);
  });

  it('recusa valor que nao e string', () => {
    expect(ehFinalidade(undefined)).toBe(false);
    expect(ehFinalidade(null)).toBe(false);
    expect(ehFinalidade(1)).toBe(false);
    expect(ehFinalidade(['ASSISTENCIAL'])).toBe(false);
  });
});
