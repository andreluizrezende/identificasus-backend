import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chaveDaFila } from './chave-da-fila';

const ANTES = process.env.JWT_SEGREDO;

beforeEach(() => {
  process.env.JWT_SEGREDO = 'segredo-de-teste-com-pelo-menos-trinta-e-dois-bytes';
});
afterEach(() => {
  process.env.JWT_SEGREDO = ANTES;
});

describe('chave da fila local', () => {
  it('256 bits, em base64', () => {
    expect(Buffer.from(chaveDaFila(5, 'APAR-1'), 'base64')).toHaveLength(32);
  });

  it('(!) a mesma em todo login da mesma pessoa no mesmo aparelho', () => {
    expect(chaveDaFila(5, 'APAR-1')).toBe(chaveDaFila(5, 'APAR-1'));
  });

  it('outra pessoa no mesmo aparelho tem outra chave (troca de plantao nao mistura autor)', () => {
    expect(chaveDaFila(6, 'APAR-1')).not.toBe(chaveDaFila(5, 'APAR-1'));
  });

  it('a mesma pessoa em outro aparelho tem outra chave', () => {
    expect(chaveDaFila(5, 'APAR-2')).not.toBe(chaveDaFila(5, 'APAR-1'));
  });

  it('nao e o proprio segredo, e muda se o segredo mudar', () => {
    const antes = chaveDaFila(5, 'APAR-1');
    process.env.JWT_SEGREDO = 'outro-segredo-de-teste-com-pelo-menos-trinta-e-dois';
    expect(chaveDaFila(5, 'APAR-1')).not.toBe(antes);
  });

  it('sem JWT_SEGREDO recusa, em vez de derivar de vazio', () => {
    delete process.env.JWT_SEGREDO;
    expect(() => chaveDaFila(5, 'APAR-1')).toThrow(/JWT_SEGREDO/);
  });
});
