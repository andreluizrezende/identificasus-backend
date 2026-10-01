import { describe, expect, it } from 'vitest';
import { opcoesDeCors, origensPermitidas } from './cors';

describe('origensPermitidas', () => {
  it('sem variavel, nenhuma origem: o comportamento de antes, sem CORS', () => {
    expect(origensPermitidas(undefined)).toEqual([]);
    expect(origensPermitidas('')).toEqual([]);
    expect(opcoesDeCors(undefined)).toBeNull();
  });

  it('aceita lista separada por virgula, tirando espaco e barra final', () => {
    expect(origensPermitidas(' https://localhost , http://localhost:5173/ '))
      .toEqual(['https://localhost', 'http://localhost:5173']);
  });

  it('recusa curinga, mesmo misturado com origens validas', () => {
    expect(() => origensPermitidas('*')).toThrow(/curinga/);
    expect(() => origensPermitidas('https://localhost,*')).toThrow(/curinga/);
    expect(() => origensPermitidas('https://*.vercel.app')).toThrow(/curinga/);
  });

  it('recusa o que nao e origem (caminho, esquema estranho)', () => {
    expect(() => origensPermitidas('https://localhost/app')).toThrow(/origem/);
    expect(() => origensPermitidas('capacitor://localhost')).toThrow(/origem/);
    expect(() => origensPermitidas('localhost')).toThrow(/origem/);
  });
});

describe('opcoesDeCors', () => {
  it('libera so as origens listadas, sem cookie, com os cabecalhos que o app usa', () => {
    expect(opcoesDeCors('https://localhost')).toEqual({
      origin: ['https://localhost'],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['authorization', 'content-type'],
      credentials: false,
      maxAge: 600,
    });
  });
});
