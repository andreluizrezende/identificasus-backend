import { describe, expect, it, vi } from 'vitest';
import { CatalogoService } from './catalogo.service';
import type { BancoPorFinalidade } from '@/acesso/banco-por-finalidade.service';

function bancoCom(
  grupos: unknown[], atributos: unknown[], vocabulario: unknown[], procedencias: unknown[],
) {
  const consultar = vi.fn()
    .mockResolvedValueOnce(grupos)
    .mockResolvedValueOnce(atributos)
    .mockResolvedValueOnce(vocabulario)
    .mockResolvedValueOnce(procedencias);
  return { consultar } as unknown as BancoPorFinalidade;
}

const GRUPOS = [{ co_grupo: 'G1', no_grupo: 'Grupo 1', nu_ordem: 1 }];
const ATRIBUTOS = [{
  co_grupo: 'G1', co_atributo: 'A1', no_atributo: 'Atributo 1', ds_atributo: null,
  tp_dado: 'TEXTO', lg_obrigatorio: 1, lg_minimo_protocolo: 0, nu_ordem: 1,
}];
const VOCABULARIO = [{ co_atributo: 'A1', co_valor: 'V1', ds_valor: 'Valor 1', nu_ordem: 1 }];
const PROCEDENCIAS = [{ co_procedencia: 'OBSERVADO', ds_procedencia: 'Observado', vl_confiabilidade: '0.90' }];

describe('CatalogoService.listar', () => {
  it('monta grupos com seus atributos e o vocabulario aninhado', async () => {
    const acesso = bancoCom(GRUPOS, ATRIBUTOS, VOCABULARIO, PROCEDENCIAS);
    const catalogo = await new CatalogoService(acesso).listar();

    expect(catalogo.grupos).toHaveLength(1);
    const atributo = catalogo.grupos[0]?.atributos[0];
    expect(atributo?.codigo).toBe('A1');
    expect(atributo?.obrigatorio).toBe(true);
    expect(atributo?.minimoDoProtocolo).toBe(false);
    expect(atributo?.valores).toEqual([{ codigo: 'V1', descricao: 'Valor 1', ordem: 1 }]);
    expect(catalogo.procedencias[0]?.confiabilidade).toBe(0.9);
  });

  it('atributo sem vocabulario cadastrado recebe lista vazia, nao undefined', async () => {
    const acesso = bancoCom(GRUPOS, ATRIBUTOS, [], PROCEDENCIAS);
    const catalogo = await new CatalogoService(acesso).listar();
    expect(catalogo.grupos[0]?.atributos[0]?.valores).toEqual([]);
  });

  it('a versao e estavel para o mesmo conteudo e muda quando o conteudo muda', async () => {
    const v1 = await new CatalogoService(bancoCom(GRUPOS, ATRIBUTOS, VOCABULARIO, PROCEDENCIAS)).listar();
    const v2 = await new CatalogoService(bancoCom(GRUPOS, ATRIBUTOS, VOCABULARIO, PROCEDENCIAS)).listar();
    expect(v1.versao).toBe(v2.versao);

    const outros = [{ ...ATRIBUTOS[0], no_atributo: 'Nome mudou' }];
    const v3 = await new CatalogoService(bancoCom(GRUPOS, outros, VOCABULARIO, PROCEDENCIAS)).listar();
    expect(v3.versao).not.toBe(v1.versao);
  });
});
