import { describe, expect, it } from 'vitest';
import { caminhoDeFotoValido } from './midia.esquemas';

const UUID = 'a1b2c3d4-e5f6-4789-a012-3456789abcde';

describe('caminhoDeFotoValido', () => {
  it('aceita o padrao casos/<coCaso>/<uuid>.<ext>', () => {
    expect(caminhoDeFotoValido(`casos/C1/${UUID}.jpg`)).toBe(true);
    expect(caminhoDeFotoValido(`casos/C-2027-0001/${UUID}.png`)).toBe(true);
    expect(caminhoDeFotoValido(`casos/C1/${UUID}.webp`)).toBe(true);
  });

  it('recusa extensao fora da lista', () => {
    expect(caminhoDeFotoValido(`casos/C1/${UUID}.gif`)).toBe(false);
    expect(caminhoDeFotoValido(`casos/C1/${UUID}.svg`)).toBe(false);
    expect(caminhoDeFotoValido(`casos/C1/${UUID}.php`)).toBe(false);
  });

  it('recusa caminho fora do prefixo casos/', () => {
    expect(caminhoDeFotoValido(`outra-pasta/C1/${UUID}.jpg`)).toBe(false);
    expect(caminhoDeFotoValido(`${UUID}.jpg`)).toBe(false);
  });

  it('recusa nome de arquivo que nao e um uuid', () => {
    expect(caminhoDeFotoValido('casos/C1/foto.jpg')).toBe(false);
    expect(caminhoDeFotoValido('casos/C1/../../etc/passwd.jpg')).toBe(false);
  });

  it('recusa coCaso vazio ou maior que 20 caracteres', () => {
    expect(caminhoDeFotoValido(`casos//${UUID}.jpg`)).toBe(false);
    expect(caminhoDeFotoValido(`casos/${'C'.repeat(21)}/${UUID}.jpg`)).toBe(false);
    expect(caminhoDeFotoValido(`casos/${'C'.repeat(20)}/${UUID}.jpg`)).toBe(true);
  });
});
