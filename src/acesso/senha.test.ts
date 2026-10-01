import { describe, expect, it } from 'vitest';
import { cifrarSenha, conferirSenha, motivoDaRecusa } from './senha';

describe('politica', () => {
  it('recusa senha curta', () => {
    expect(motivoDaRecusa('curta', 'a@x.br')).toMatch(/10/);
  });

  it('recusa a senha igual ao e-mail, sem diferenciar maiusculas', () => {
    expect(motivoDaRecusa('Ana.Silva@Exemplo.br', 'ana.silva@exemplo.br')).toMatch(/e-mail/);
  });

  it('aceita senha que atende a politica', () => {
    expect(motivoDaRecusa('CampoSamu2027!Ba', 'a@x.br')).toBeNull();
  });
});

describe('hash', () => {
  it('confere a senha certa e recusa a errada', async () => {
    const hash = await cifrarSenha('CampoSamu2027!Ba');
    expect(hash.startsWith('scrypt$17$8$1$')).toBe(true);
    expect(hash).not.toContain('CampoSamu');
    expect(await conferirSenha('CampoSamu2027!Ba', hash)).toBe(true);
    expect(await conferirSenha('CampoSamu2027!Bb', hash)).toBe(false);
  });

  it('duas cifras da mesma senha nao coincidem (sal aleatorio)', async () => {
    expect(await cifrarSenha('mesma-senha-123')).not.toBe(await cifrarSenha('mesma-senha-123'));
  });

  it('nao corta senha longa: diferenca depois do byte 72 conta', async () => {
    const base = 'x'.repeat(80);
    const hash = await cifrarSenha(`${base}A`);
    expect(await conferirSenha(`${base}B`, hash)).toBe(false);
  });

  it('sem hash guardado (conta inexistente) nunca confere', async () => {
    expect(await conferirSenha('qualquer-senha', null)).toBe(false);
  });

  it('hash corrompido ou com parametros absurdos nao confere nem lanca', async () => {
    expect(await conferirSenha('x', 'bcrypt$abc')).toBe(false);
    expect(await conferirSenha('x', 'scrypt$40$8$1$c2Fs$aGFzaA==')).toBe(false);
  });
});
