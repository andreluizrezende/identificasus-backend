import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ZodValidacaoPipe } from './zod-validacao.pipe';

const esquema = z.object({ nome: z.string().min(1), idade: z.number().int().positive() });

describe('pipe de validacao zod', () => {
  it('devolve o dado tipado quando valido', () => {
    const pipe = new ZodValidacaoPipe(esquema);
    expect(pipe.transform({ nome: 'Ana', idade: 30 })).toEqual({ nome: 'Ana', idade: 30 });
  });

  it('recusa com BadRequestException quando invalido', () => {
    const pipe = new ZodValidacaoPipe(esquema);
    expect(() => pipe.transform({ nome: '', idade: -1 })).toThrow(BadRequestException);
  });

  it('a mensagem nunca ecoa o valor recebido (RNF-07.05)', () => {
    const pipe = new ZodValidacaoPipe(esquema);
    expect.assertions(2);
    try {
      pipe.transform({ nome: 'segredo-do-caso-xyz', idade: 'nao-numero' });
    } catch (erro) {
      expect(erro).toBeInstanceOf(BadRequestException);
      const corpo = JSON.stringify((erro as BadRequestException).getResponse());
      expect(corpo).not.toContain('segredo-do-caso-xyz');
    }
  });

  it('lista o caminho e o codigo de cada campo invalido', () => {
    const pipe = new ZodValidacaoPipe(esquema);
    expect.assertions(1);
    try {
      pipe.transform({ nome: '', idade: -1 });
    } catch (erro) {
      const corpo = (erro as BadRequestException).getResponse() as { campos: Array<{ caminho: string }> };
      expect(corpo.campos.map((c) => c.caminho).sort()).toEqual(['idade', 'nome']);
    }
  });
});
