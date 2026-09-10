import { describe, expect, it } from 'vitest';
import { ELO_GENESE, calcularElo, canonizar } from './hash-auditoria';

const elo = {
  id: 'a1', ocorridoEm: '2027-09-02T13:52:00.000Z', usuarioId: 1,
  finalidade: 'ASSISTENCIAL', acao: 'CASO_CRIADO', recurso: 'mob_caso/1',
  detalhe: { b: 2, a: 1 },
};

describe('cadeia de auditoria', () => {
  it('a ordem das chaves do detalhe nao muda o hash', () => {
    expect(canonizar({ b: 2, a: 1 })).toBe(canonizar({ a: 1, b: 2 }));
    expect(calcularElo(ELO_GENESE, elo)).toBe(
      calcularElo(ELO_GENESE, { ...elo, detalhe: { a: 1, b: 2 } }),
    );
  });

  it('mudar qualquer campo muda o hash', () => {
    const base = calcularElo(ELO_GENESE, elo);
    expect(calcularElo(ELO_GENESE, { ...elo, acao: 'OUTRA' })).not.toBe(base);
    expect(calcularElo('f'.repeat(64), elo)).not.toBe(base);
  });

  it('o elo depende do anterior, encadeando a trilha', () => {
    const primeiro = calcularElo(ELO_GENESE, elo);
    const segundo = calcularElo(primeiro, { ...elo, id: 'a2' });
    const forjado = calcularElo(ELO_GENESE, { ...elo, id: 'a2' });
    expect(segundo).not.toBe(forjado);
  });
});
