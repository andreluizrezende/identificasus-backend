import { describe, expect, it, vi } from 'vitest';
import { AtributoDesconhecido, CapturaService, ProcedenciaDesconhecida, TermoDesconhecido } from './captura.service';
import type { BancoPorFinalidade } from '@/acesso/banco-por-finalidade.service';

function bancoCom(consultar: ReturnType<typeof vi.fn>, executar = vi.fn().mockResolvedValue({})) {
  return { consultar, executar } as unknown as BancoPorFinalidade;
}

describe('valorVigente', () => {
  it('devolve null quando o atributo nao tem valor vigente', async () => {
    const acesso = bancoCom(vi.fn().mockResolvedValue([]));
    await expect(new CapturaService(acesso).valorVigente(1, 'SEXO_APARENTE')).resolves.toBeNull();
  });

  it('termo controlado ganha do texto livre, que ganha do numero', async () => {
    const linha = {
      id_tipo_atributo: 1, ds_valor: 'texto', vl_numerico: '9',
      no_termo: 'Termo', id_usuario: 2, no_usuario: 'Ana',
    };
    const acesso = bancoCom(vi.fn().mockResolvedValue([linha]));
    const v = await new CapturaService(acesso).valorVigente(1, 'X');
    expect(v?.valor).toBe('Termo');
  });

  it('sem termo, usa o texto livre', async () => {
    const linha = {
      id_tipo_atributo: 1, ds_valor: 'texto', vl_numerico: '9',
      no_termo: null, id_usuario: 2, no_usuario: 'Ana',
    };
    const acesso = bancoCom(vi.fn().mockResolvedValue([linha]));
    const v = await new CapturaService(acesso).valorVigente(1, 'X');
    expect(v?.valor).toBe('texto');
  });

  it('sem termo nem texto, usa o numero', async () => {
    const linha = {
      id_tipo_atributo: 1, ds_valor: null, vl_numerico: '9',
      no_termo: null, id_usuario: 2, no_usuario: 'Ana',
    };
    const acesso = bancoCom(vi.fn().mockResolvedValue([linha]));
    const v = await new CapturaService(acesso).valorVigente(1, 'X');
    expect(v?.valor).toBe('9');
  });
});

describe('registrarAtributo', () => {
  it('rejeita atributo fora do catalogo ativo', async () => {
    const acesso = bancoCom(vi.fn().mockResolvedValue([]));
    await expect(
      new CapturaService(acesso).registrarAtributo({
        idCaso: 1, coAtributo: 'INEXISTENTE', coProcedencia: 'OBSERVADO', usuarioId: 1,
      }),
    ).rejects.toBeInstanceOf(AtributoDesconhecido);
  });

  it('rejeita procedencia desconhecida', async () => {
    const consultar = vi.fn()
      .mockResolvedValueOnce([{ id_tipo_atributo: 1, tp_dado: 'TEXTO' }]) // tipoDe
      .mockResolvedValueOnce([]); // procedenciaDe
    const acesso = bancoCom(consultar);
    await expect(
      new CapturaService(acesso).registrarAtributo({
        idCaso: 1, coAtributo: 'X', coProcedencia: 'INVENTADA', usuarioId: 1,
      }),
    ).rejects.toBeInstanceOf(ProcedenciaDesconhecida);
  });

  it('rejeita termo fora do vocabulario controlado, sem converter para texto livre', async () => {
    const consultar = vi.fn()
      .mockResolvedValueOnce([{ id_tipo_atributo: 1, tp_dado: 'LISTA' }]) // tipoDe
      .mockResolvedValueOnce([{ id: 5 }]) // procedenciaDe
      .mockResolvedValueOnce([]); // termoDe
    const acesso = bancoCom(consultar);
    await expect(
      new CapturaService(acesso).registrarAtributo({
        idCaso: 1, coAtributo: 'X', coProcedencia: 'OBSERVADO', coValor: 'FORA_DA_LISTA', usuarioId: 1,
      }),
    ).rejects.toBeInstanceOf(TermoDesconhecido);
  });

  it('grava com termo controlado: dsValor sai nulo mesmo se veio preenchido', async () => {
    const consultar = vi.fn()
      .mockResolvedValueOnce([{ id_tipo_atributo: 1, tp_dado: 'LISTA' }])
      .mockResolvedValueOnce([{ id: 5 }])
      .mockResolvedValueOnce([{ id: 9 }]);
    const executar = vi.fn().mockResolvedValue({});
    const acesso = bancoCom(consultar, executar);

    await new CapturaService(acesso).registrarAtributo({
      idCaso: 1, coAtributo: 'X', coProcedencia: 'OBSERVADO',
      coValor: 'AZUL', dsValor: 'ignorado', usuarioId: 3,
    });

    expect(executar).toHaveBeenCalledWith(
      'ASSISTENCIAL', 'CALL sp_mob_registra_atributo(?, ?, ?, ?, ?, ?)',
      [1, 1, 5, 9, null, 3],
    );
  });

  it('grava texto livre quando nao ha termo controlado', async () => {
    const consultar = vi.fn()
      .mockResolvedValueOnce([{ id_tipo_atributo: 1, tp_dado: 'TEXTO' }])
      .mockResolvedValueOnce([{ id: 5 }]);
    const executar = vi.fn().mockResolvedValue({});
    const acesso = bancoCom(consultar, executar);

    await new CapturaService(acesso).registrarAtributo({
      idCaso: 1, coAtributo: 'X', coProcedencia: 'OBSERVADO', dsValor: 'observacao livre', usuarioId: 3,
    });

    expect(executar).toHaveBeenCalledWith(
      'ASSISTENCIAL', 'CALL sp_mob_registra_atributo(?, ?, ?, ?, ?, ?)',
      [1, 1, 5, null, 'observacao livre', 3],
    );
  });
});
