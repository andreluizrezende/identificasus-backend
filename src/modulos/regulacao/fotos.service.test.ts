import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { FotosDaRegulacaoService } from './fotos.service';
import { ESTADOS_DA_FILA } from './regulacao.service';
import type { BancoPorFinalidade } from '@/acesso/banco-por-finalidade.service';
import type { AuditoriaService } from '@/modulos/auditoria/auditoria.service';
import type { AssinaturaDeFoto } from '@/modulos/midia/assinatura-de-foto';

const CASO = { id_caso: 42, co_caso: 'NN-2026-ABCDEFGH' };
const FOTO = {
  id_midia: '7', ds_legenda: null, ds_caminho: 'casos/NN-2026-ABCDEFGH/aaaa.jpg',
  nu_tamanho: '63738', st_captura: '2026-10-02 18:32:30.000000', no_usuario: 'Teste Campo',
};

function montar(caso: unknown[], fotos: unknown[]) {
  const consultar = vi.fn().mockResolvedValueOnce(caso).mockResolvedValueOnce(fotos);
  const acesso = { consultar } as unknown as BancoPorFinalidade;
  const registrar = vi.fn().mockResolvedValue('hash');
  const auditoria = { registrar } as unknown as AuditoriaService;
  const urlDeLeitura = vi.fn(async (p: string, _validoAte: number) => `https://assinada.exemplo/${p}?sig=x`);
  const assinatura = { urlDeLeitura } as unknown as AssinaturaDeFoto;
  return { servico: new FotosDaRegulacaoService(acesso, auditoria, assinatura), consultar, registrar, urlDeLeitura };
}

describe('fotos do caso para a regulacao', () => {
  it('so caso da fila, pelo pool de ADJUDICACAO', async () => {
    const { servico, consultar } = montar([CASO], []);
    await servico.fotos('NN-2026-ABCDEFGH', 9);
    const [finalidade, , params] = consultar.mock.calls[0] as [string, string, unknown[]];
    expect(finalidade).toBe('ADJUDICACAO');
    expect(params).toEqual(['NN-2026-ABCDEFGH', ...ESTADOS_DA_FILA]);
  });

  it('(!) caso fora da fila e caso inexistente recebem a mesma resposta', async () => {
    const { servico, registrar } = montar([], []);
    await expect(servico.fotos('NN-2026-NAOEXIST', 9)).rejects.toBeInstanceOf(NotFoundException);
    expect(registrar).not.toHaveBeenCalled();
  });

  it('cada foto vem com URL assinada do proprio caminho, e a mesma validade para todas', async () => {
    const { servico, urlDeLeitura } = montar([CASO], [FOTO, { ...FOTO, id_midia: '8', ds_caminho: 'casos/NN-2026-ABCDEFGH/bbbb.png' }]);
    const fotos = await servico.fotos('NN-2026-ABCDEFGH', 9);

    expect(fotos).toHaveLength(2);
    expect(fotos[0]).toMatchObject({
      idMidia: 7, nuTamanho: 63738, noAutor: 'Teste Campo',
      url: 'https://assinada.exemplo/casos/NN-2026-ABCDEFGH/aaaa.jpg?sig=x',
    });
    expect(urlDeLeitura.mock.calls.map((c) => c[0])).toEqual([
      'casos/NN-2026-ABCDEFGH/aaaa.jpg', 'casos/NN-2026-ABCDEFGH/bbbb.png',
    ]);
    const validades = new Set(urlDeLeitura.mock.calls.map((c) => c[1]));
    expect(validades.size).toBe(1);
    expect(fotos[0]?.validaAte).toBe(fotos[1]?.validaAte);
  });

  it('(!) o caminho no Blob nao sai na resposta, so a URL assinada', async () => {
    const { servico } = montar([CASO], [FOTO]);
    const [foto] = await servico.fotos('NN-2026-ABCDEFGH', 9);
    expect(foto).not.toHaveProperty('dsCaminho');
  });

  it('nao lista foto expurgada nem documento', async () => {
    const { servico, consultar } = montar([CASO], []);
    await servico.fotos('NN-2026-ABCDEFGH', 9);
    const sql = String(consultar.mock.calls[1]?.[1]);
    expect(sql).toMatch(/lg_expurgada = 0/);
    expect(sql).toMatch(/tp_midia = 'IMG'/);
  });

  it('(!) ver as fotos vai para a trilha, com o caso e quais fotos', async () => {
    const { servico, registrar } = montar([CASO], [FOTO]);
    await servico.fotos('NN-2026-ABCDEFGH', 9);
    expect(registrar).toHaveBeenCalledWith(expect.objectContaining({
      usuarioId: 9, finalidade: 'ADJUDICACAO', acao: 'regulacao_fotos_consultadas',
      casoId: 42, detalhe: { fotos: [7] },
    }));
  });
});
