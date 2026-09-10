import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { RowDataPacket } from 'mysql2/promise';
import { CapturaService } from '@/modulos/captura/captura.service';
import { CasoService } from '@/modulos/caso/caso.service';
import { SincronizacaoService } from '@/modulos/sincronizacao/sincronizacao.service';
import { TurnoService } from '@/modulos/turno/turno.service';
import { AuditoriaService } from '@/modulos/auditoria/auditoria.service';
import type { BancoPorFinalidade } from '@/acesso/banco-por-finalidade.service';
import type { Lote } from '@/modulos/sincronizacao/sincronizacao.esquemas';
import { acessoDeTeste, conexao, limparCenario, montarCenario } from './apoio';
import type { Cenario } from './apoio';

let acesso: BancoPorFinalidade;
let cen: Cenario;
let sinc: SincronizacaoService;
let casos: CasoService;
let captura: CapturaService;
let coDispositivo: string;

beforeAll(async () => {
  cen = await montarCenario('sinc');
  coDispositivo = `D-${cen.sufixo}`;
  acesso = acessoDeTeste();
  casos = new CasoService(acesso);
  captura = new CapturaService(acesso);
  const auditoria = new AuditoriaService(acesso);
  const turnos = new TurnoService(acesso, auditoria);
  sinc = new SincronizacaoService(acesso, casos, captura, turnos, auditoria);
});

afterAll(async () => {
  await limparCenario(cen);
  await acesso.onModuleDestroy();
});

function loteDeAbertura(coCaso: string): Lote {
  return {
    coDispositivo,
    eventos: [
      {
        coIdempotencia: randomUUID(),
        tipo: 'CASO',
        coCaso,
        capturadoEm: new Date().toISOString(),
        conteudo: {
          dtOcorrencia: '2027-05-04',
          hrOcorrencia: '03:20',
          dsLocal: 'Via publica, ponto ficticio de teste',
        },
      },
    ],
  };
}

describe('sincronização contra o banco', () => {
  it('abre o caso e o deixa visível para quem o abriu', async () => {
    const coCaso = `NN-${cen.sufixo.slice(-8)}-1`;
    const r = await sinc.aplicarLote(loteDeAbertura(coCaso), cen.idUsuarioA);

    expect(r.aplicados).toHaveLength(1);
    expect(r.recusados).toHaveLength(0);

    const meus = await casos.meusCasos(cen.idUsuarioA);
    expect(meus.map((c) => c.coCaso)).toContain(coCaso);
  });

  it('não deixa o caso visível para quem não estava no atendimento', async () => {
    const coCaso = `NN-${cen.sufixo.slice(-8)}-2`;
    await sinc.aplicarLote(loteDeAbertura(coCaso), cen.idUsuarioA);

    const doOutro = await casos.meusCasos(cen.idUsuarioB);
    expect(doOutro.map((c) => c.coCaso)).not.toContain(coCaso);
    // Mesma resposta de "não existe": um 403 contaria que o caso existe.
    await expect(casos.porCodigo(coCaso, cen.idUsuarioB)).rejects.toThrow();
  });

  it('reenviar o mesmo lote não duplica nada', async () => {
    const coCaso = `NN-${cen.sufixo.slice(-8)}-3`;
    const lote = loteDeAbertura(coCaso);

    const primeira = await sinc.aplicarLote(lote, cen.idUsuarioA);
    const segunda = await sinc.aplicarLote(lote, cen.idUsuarioA);

    // A segunda passagem responde "aplicado" sem escrever de novo: é o que
    // autoriza o aparelho a limpar a fila depois de uma rede que caiu no meio.
    expect(primeira.aplicados).toEqual(segunda.aplicados);

    const c = await conexao();
    try {
      const [linhas] = await c.query<RowDataPacket[]>(
        'SELECT COUNT(*) AS n FROM mob_caso WHERE co_caso = ?', [coCaso],
      );
      expect(Number((linhas[0] as { n: number }).n)).toBe(1);

      const [eventos] = await c.query<RowDataPacket[]>(
        'SELECT COUNT(*) AS n FROM mob_evento_sincronizacao WHERE co_idempotencia = ?',
        [lote.eventos[0]?.coIdempotencia],
      );
      expect(Number((eventos[0] as { n: number }).n)).toBe(1);
    } finally {
      await c.end();
    }
  });

  it('grava atributo, versiona a correção e recalcula a completude', async () => {
    const coCaso = `NN-${cen.sufixo.slice(-8)}-4`;
    await sinc.aplicarLote(loteDeAbertura(coCaso), cen.idUsuarioA);

    const atributo = (coValor: string) => ({
      coDispositivo,
      eventos: [
        {
          coIdempotencia: randomUUID(),
          tipo: 'ATRIBUTO' as const,
          coCaso,
          capturadoEm: new Date().toISOString(),
          conteudo: { coAtributo: 'SEXO_APARENTE', coProcedencia: 'OBSERVADO', coValor },
        },
      ],
    });

    const antes = (await casos.porCodigo(coCaso, cen.idUsuarioA)).qtCompletude;
    const r1 = await sinc.aplicarLote(atributo('M'), cen.idUsuarioA);
    expect(r1.aplicados).toHaveLength(1);

    const depois = await casos.porCodigo(coCaso, cen.idUsuarioA);
    // SEXO_APARENTE é atributo mínimo do protocolo: gravar move a completude.
    expect(depois.qtCompletude).toBeGreaterThan(antes);

    // A mesma pessoa corrigindo o próprio registro não é divergência.
    const r2 = await sinc.aplicarLote(atributo('F'), cen.idUsuarioA);
    expect(r2.divergentes).toHaveLength(0);
    expect(r2.aplicados).toHaveLength(1);

    const corrigido = await casos.porCodigo(coCaso, cen.idUsuarioA);
    const vigentes = corrigido.atributos.filter((a) => a.coAtributo === 'SEXO_APARENTE');
    expect(vigentes).toHaveLength(1);

    const c = await conexao();
    try {
      // A versão anterior continua lá, com lg_vigente = 0. Nada é apagado.
      const [linhas] = await c.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM mob_caso_atributo a
           JOIN mob_caso k ON k.id_caso = a.id_caso
           JOIN mob_tipo_atributo t ON t.id_tipo_atributo = a.id_tipo_atributo
          WHERE k.co_caso = ? AND t.co_atributo = 'SEXO_APARENTE'`,
        [coCaso],
      );
      expect(Number((linhas[0] as { n: number }).n)).toBe(2);
    } finally {
      await c.end();
    }
  });

  it('valor divergente de outra pessoa vira adjudicação, e não sobrescrita', async () => {
    const coCaso = `NN-${cen.sufixo.slice(-8)}-5`;
    await sinc.aplicarLote(loteDeAbertura(coCaso), cen.idUsuarioA);

    const evento = (coValor: string) => ({
      coDispositivo,
      eventos: [
        {
          coIdempotencia: randomUUID(),
          tipo: 'ATRIBUTO' as const,
          coCaso,
          capturadoEm: new Date().toISOString(),
          conteudo: { coAtributo: 'RACA_COR', coProcedencia: 'OBSERVADO', coValor },
        },
      ],
    });

    await sinc.aplicarLote(evento('PARDA'), cen.idUsuarioA);
    const conflito = await sinc.aplicarLote(evento('PRETA'), cen.idUsuarioB);

    expect(conflito.divergentes).toHaveLength(1);
    expect(conflito.divergentes[0]?.valorServidor).toBeTruthy();
    // (!) O evento divergente NÃO entra em `aplicados`: o aparelho mantém o
    //     valor na fila até uma pessoa decidir. Esta é a asserção que impede a
    //     regressão mais cara do módulo.
    expect(conflito.aplicados).toHaveLength(0);

    const vigente = await captura.valorVigente(
      (await casos.idPorCodigo(coCaso)) ?? 0, 'RACA_COR',
    );
    expect(vigente?.idUsuario).toBe(cen.idUsuarioA);

    const c = await conexao();
    try {
      const [linhas] = await c.query<RowDataPacket[]>(
        `SELECT d.ds_valor_dispositivo, d.ds_valor_servidor, d.st_resolucao
           FROM mob_divergencia d JOIN mob_caso k ON k.id_caso = d.id_caso
          WHERE k.co_caso = ?`,
        [coCaso],
      );
      expect(linhas).toHaveLength(1);
      const d = linhas[0] as { ds_valor_dispositivo: string; st_resolucao: string };
      expect(d.ds_valor_dispositivo).toBe('PRETA');
      expect(d.st_resolucao).toBe('PENDENTE');
    } finally {
      await c.end();
    }
  });

  it('recusa termo fora do vocabulário em vez de convertê-lo em texto livre', async () => {
    const coCaso = `NN-${cen.sufixo.slice(-8)}-6`;
    await sinc.aplicarLote(loteDeAbertura(coCaso), cen.idUsuarioA);

    const r = await sinc.aplicarLote(
      {
        coDispositivo,
        eventos: [
          {
            coIdempotencia: randomUUID(),
            tipo: 'ATRIBUTO',
            coCaso,
            capturadoEm: new Date().toISOString(),
            conteudo: {
              coAtributo: 'SEXO_APARENTE',
              coProcedencia: 'OBSERVADO',
              coValor: 'INVENTADO',
            },
          },
        ],
      },
      cen.idUsuarioA,
    );

    expect(r.aplicados).toHaveLength(0);
    expect(r.recusados).toHaveLength(1);
    // A mensagem devolvida é genérica: erro não vaza conteúdo do caso.
    expect(r.recusados[0]?.motivo).not.toContain('INVENTADO');
  });

  it('recusa o lote de aparelho revogado', async () => {
    await expect(
      sinc.aplicarLote(
        { ...loteDeAbertura('NN-NAO-DEVE-EXISTIR'), coDispositivo: 'D-INEXISTENTE' },
        cen.idUsuarioA,
      ),
    ).rejects.toThrow();
  });
});
