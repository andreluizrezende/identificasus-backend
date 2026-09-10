import { describe, expect, it } from 'vitest';
import {
  esquemaConteudoAtributo, esquemaConteudoCaso, esquemaConteudoEstado,
  esquemaConteudoMidia, esquemaEventoEntrada, esquemaLote,
} from './sincronizacao.esquemas';

describe('esquemaConteudoCaso', () => {
  const base = { dtOcorrencia: '2027-01-01', hrOcorrencia: '10:00' };

  it('aceita hora com ou sem segundos', () => {
    expect(esquemaConteudoCaso.safeParse(base).success).toBe(true);
    expect(esquemaConteudoCaso.safeParse({ ...base, hrOcorrencia: '10:00:30' }).success).toBe(true);
    expect(esquemaConteudoCaso.safeParse({ ...base, hrOcorrencia: '25:00' }).success).toBe(false);
  });

  it('latitude e longitude tem limite geografico', () => {
    expect(esquemaConteudoCaso.safeParse({ ...base, vlLatitude: 91 }).success).toBe(false);
    expect(esquemaConteudoCaso.safeParse({ ...base, vlLongitude: -181 }).success).toBe(false);
    expect(esquemaConteudoCaso.safeParse({ ...base, vlLatitude: -12.97, vlLongitude: -38.5 }).success).toBe(true);
  });
});

describe('esquemaConteudoAtributo', () => {
  const base = { coAtributo: 'SEXO_APARENTE', coProcedencia: 'OBSERVADO' as const };

  it('exige coValor ou dsValor: procedencia sozinha nao basta', () => {
    expect(esquemaConteudoAtributo.safeParse(base).success).toBe(false);
    expect(esquemaConteudoAtributo.safeParse({ ...base, coValor: 'MASCULINO' }).success).toBe(true);
    expect(esquemaConteudoAtributo.safeParse({ ...base, dsValor: 'texto livre' }).success).toBe(true);
  });

  it('recusa procedencia fora do vocabulario fechado', () => {
    expect(
      esquemaConteudoAtributo.safeParse({ ...base, coProcedencia: 'INVENTADA', coValor: 'X' }).success,
    ).toBe(false);
  });
});

describe('esquemaConteudoEstado', () => {
  it('so aceita os quatro estados do caso', () => {
    expect(esquemaConteudoEstado.safeParse({ stAtual: 'ABERTO' }).success).toBe(true);
    expect(esquemaConteudoEstado.safeParse({ stAtual: 'CANCELADO' }).success).toBe(false);
  });
});

describe('esquemaConteudoMidia', () => {
  const base = { tpMidia: 'IMG' as const, dsCaminho: 'casos/1/foto.jpg', nuTamanho: 1024 };

  it('exige hash SHA-256 hexadecimal de 64 caracteres', () => {
    expect(esquemaConteudoMidia.safeParse({ ...base, coHash: 'a'.repeat(64) }).success).toBe(true);
    expect(esquemaConteudoMidia.safeParse({ ...base, coHash: 'a'.repeat(63) }).success).toBe(false);
    expect(esquemaConteudoMidia.safeParse({ ...base, coHash: 'z'.repeat(64) }).success).toBe(false);
  });

  it('tamanho deve ser inteiro positivo', () => {
    expect(esquemaConteudoMidia.safeParse({ ...base, coHash: 'a'.repeat(64), nuTamanho: 0 }).success).toBe(false);
    expect(esquemaConteudoMidia.safeParse({ ...base, coHash: 'a'.repeat(64), nuTamanho: -1 }).success).toBe(false);
  });
});

describe('esquemaEventoEntrada e esquemaLote', () => {
  const evento = {
    coIdempotencia: '123e4567-e89b-12d3-a456-426614174000',
    tipo: 'ESTADO' as const,
    coCaso: 'C1',
    conteudo: { stAtual: 'ABERTO' },
    capturadoEm: '2027-01-01T10:00:00.000Z',
  };

  it('coIdempotencia precisa ser uuid', () => {
    expect(esquemaEventoEntrada.safeParse({ ...evento, coIdempotencia: 'x' }).success).toBe(false);
  });

  it('lote aceita de 1 a 200 eventos', () => {
    expect(esquemaLote.safeParse({ coDispositivo: 'D1', eventos: [] }).success).toBe(false);
    expect(esquemaLote.safeParse({ coDispositivo: 'D1', eventos: [evento] }).success).toBe(true);
    expect(
      esquemaLote.safeParse({ coDispositivo: 'D1', eventos: Array(201).fill(evento) }).success,
    ).toBe(false);
    expect(
      esquemaLote.safeParse({ coDispositivo: 'D1', eventos: Array(200).fill(evento) }).success,
    ).toBe(true);
  });
});
