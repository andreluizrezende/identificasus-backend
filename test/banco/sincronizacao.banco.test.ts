import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { RowDataPacket } from 'mysql2/promise';
import { CapturaService } from '@/modulos/captura/captura.service';
import { CasoService } from '@/modulos/caso/caso.service';
import { SincronizacaoService } from '@/modulos/sincronizacao/sincronizacao.service';
import { TurnoService } from '@/modulos/turno/turno.service';
import { RegulacaoService } from '@/modulos/regulacao/regulacao.service';
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

  it('fechar a captura em campo marca o caso como enviado para a equipe', async () => {
    const coCaso = `NN-${cen.sufixo.slice(-8)}-F`;
    const lote = loteDeAbertura(coCaso);
    lote.eventos.push({
      coIdempotencia: randomUUID(),
      tipo: 'ESTADO',
      coCaso,
      capturadoEm: new Date().toISOString(),
      conteudo: { stAtual: 'ENRIQUECIMENTO', dsMotivo: 'captura encerrada em campo' },
    });
    const r = await sinc.aplicarLote(lote, cen.idUsuarioA);
    expect(r.recusados).toHaveLength(0);

    const meu = (await casos.meusCasos(cen.idUsuarioA)).find((c) => c.coCaso === coCaso);
    // Decisao do produto (02/10/2026): fechar a captura poe o caso na fila.
    expect(meu?.stCaso).toBe('ANALISE');
    expect(meu?.enviadoEm).not.toBeNull();

    const fila = await new RegulacaoService(acessoDeTeste(), new AuditoriaService(acessoDeTeste())).fila(cen.idUsuarioA);
    expect(fila.map((i) => i.coCaso)).toContain(coCaso);

    // (!) Uma linha de historico por transicao, todas com autor (db/09).
    const c = await conexao();
    try {
      const [hist] = await c.query<RowDataPacket[]>(
        `SELECT e.st_anterior, e.st_atual, e.id_usuario
           FROM mob_caso_estado e JOIN mob_caso k USING (id_caso)
          WHERE k.co_caso = ? ORDER BY e.id_caso_estado`, [coCaso],
      );
      expect(hist.map((h) => `${h.st_anterior ?? '-'}>${h.st_atual}`)).toEqual([
        '->ABERTO', 'ABERTO>ENRIQUECIMENTO', 'ENRIQUECIMENTO>ANALISE',
      ]);
      expect(hist.every((h) => h.id_usuario === cen.idUsuarioA)).toBe(true);
    } finally {
      await c.end();
    }
  });

  it('(!) numero e data vao para a coluna do tipo (db/10), e o mesmo numero de um colega nao diverge', async () => {
    const coCaso = `NN-${cen.sufixo.slice(-8)}-N`;
    await sinc.aplicarLote(loteDeAbertura(coCaso), cen.idUsuarioA);
    const evento = (coAtributo: string, dsValor: string) => ({
      coIdempotencia: randomUUID(), tipo: 'ATRIBUTO' as const, coCaso, capturadoEm: new Date().toISOString(),
      conteudo: { coAtributo, coProcedencia: 'ESTIMADO', dsValor },
    });
    await sinc.aplicarLote({ coDispositivo, eventos: [evento('ESTATURA', '1.80'), evento('DATA_HORA', '2027-05-04')] }, cen.idUsuarioA);

    const c = await conexao();
    try {
      const [linhas] = await c.query<RowDataPacket[]>(
        `SELECT t.co_atributo, a.ds_valor, a.vl_numerico, a.dt_valor
           FROM mob_caso_atributo a JOIN mob_tipo_atributo t USING (id_tipo_atributo)
           JOIN mob_caso k USING (id_caso)
          WHERE k.co_caso = ? AND a.lg_vigente = 1 ORDER BY t.co_atributo`, [coCaso],
      );
      expect(linhas).toEqual([
        expect.objectContaining({ co_atributo: 'DATA_HORA', ds_valor: null, dt_valor: '2027-05-04' }),
        expect.objectContaining({ co_atributo: 'ESTATURA', ds_valor: null, vl_numerico: '1.800' }),
      ]);
    } finally {
      await c.end();
    }

    // O colega manda "1.8" (sem o zero): e o mesmo numero, nao divergencia.
    const r = await sinc.aplicarLote({ coDispositivo, eventos: [evento('ESTATURA', '1.8')] }, cen.idUsuarioB);
    expect(r.divergentes).toHaveLength(0);
    const detalhe = await casos.porCodigo(coCaso, cen.idUsuarioA);
    expect(detalhe.atributos.find((x) => x.coAtributo === 'ESTATURA')?.valor).toBe('1,8');
    expect(detalhe.atributos.find((x) => x.coAtributo === 'DATA_HORA')?.valor).toBe('04/05/2027');
  });

  it('fechamento reenviado nao puxa de volta para a fila um caso ja decidido', async () => {
    const coCaso = `NN-${cen.sufixo.slice(-8)}-R`;
    await sinc.aplicarLote(loteDeAbertura(coCaso), cen.idUsuarioA);
    const id = await casos.idPorCodigo(coCaso);
    await casos.transitar(Number(id), 'RESOLVIDO', cen.idUsuarioA, 'decidido na regulacao');

    await sinc.aplicarLote({
      coDispositivo,
      eventos: [{
        coIdempotencia: randomUUID(), tipo: 'ESTADO', coCaso, capturadoEm: new Date().toISOString(),
        conteudo: { stAtual: 'ENRIQUECIMENTO', dsMotivo: 'captura encerrada em campo' },
      }],
    }, cen.idUsuarioA);

    expect((await casos.meusCasos(cen.idUsuarioA)).find((k) => k.coCaso === coCaso)?.stCaso).toBe('RESOLVIDO');
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
