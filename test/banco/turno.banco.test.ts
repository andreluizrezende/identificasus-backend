import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { CapturaService } from '@/modulos/captura/captura.service';
import { CasoService } from '@/modulos/caso/caso.service';
import { SincronizacaoService } from '@/modulos/sincronizacao/sincronizacao.service';
import { TurnoService } from '@/modulos/turno/turno.service';
import { AuditoriaService } from '@/modulos/auditoria/auditoria.service';
import type { BancoPorFinalidade } from '@/acesso/banco-por-finalidade.service';
import type { Lote } from '@/modulos/sincronizacao/sincronizacao.esquemas';
import { acessoDeTeste, conexao, cpfDeTeste, limparCenario, montarCenario } from './apoio';
import type { Cenario } from './apoio';

/**
 * Épico 2 — Turno e guarnição (US-08 a US-11), contra o banco de verdade.
 *
 * (!) O LADO POSITIVO DA US-11 SÓ SE PROVA AQUI. "Quem estava na guarnição vê
 *     o caso" mora numa subconsulta em mob_turno_guarnicao (CasoService
 *     .VISIVEL_PARA); um dublê de banco aceitaria qualquer SQL. O teste de
 *     sincronização cobre só o outro lado: quem não estava não vê.
 *
 * Três profissionais: A abre o turno, B está na guarnição de A, C trabalha na
 * mesma base mas não estava na viatura.
 */
let acesso: BancoPorFinalidade;
let cen: Cenario;
let turnos: TurnoService;
let casos: CasoService;
let sinc: SincronizacaoService;
let coDispositivo: string;
let cpfB: string;
let idUsuarioC: number;

beforeAll(async () => {
  cen = await montarCenario('turno');
  coDispositivo = `D-${cen.sufixo}`;
  acesso = acessoDeTeste();
  const auditoria = new AuditoriaService(acesso);
  casos = new CasoService(acesso);
  turnos = new TurnoService(acesso, auditoria);
  sinc = new SincronizacaoService(acesso, casos, new CapturaService(acesso), turnos, auditoria);

  const c = await conexao();
  try {
    const [b] = await c.query<RowDataPacket[]>('SELECT nu_cpf FROM mob_usuario WHERE id_usuario = ?', [cen.idUsuarioB]);
    cpfB = String(b[0]?.nu_cpf);
    const [r] = await c.query<ResultSetHeader>(
      `INSERT INTO mob_usuario (nu_cpf, no_usuario, ds_email, co_finalidade, st_ativo)
       VALUES (?, ?, ?, 'ASSISTENCIAL', 'A')`,
      [cpfDeTeste(), `Profissional C ${cen.sufixo}`, `c-${cen.sufixo}@teste.local`],
    );
    idUsuarioC = r.insertId;
  } finally {
    await c.end();
  }
});

afterAll(async () => {
  await turnos.encerrar(cen.idUsuarioA).catch(() => undefined);
  await limparCenario(cen);
  const c = await conexao();
  try {
    // C só leu (CasoService não audita leitura de campo), mas desativar em vez
    // de apagar segue a regra do apoio: nunca apagar quem a trilha pode citar.
    await c.query("UPDATE mob_usuario SET st_ativo = 'I' WHERE id_usuario = ?", [idUsuarioC]);
  } finally {
    await c.end();
  }
  await acesso.onModuleDestroy();
});

function loteDeAbertura(coCaso: string): Lote {
  return {
    coDispositivo,
    eventos: [{
      coIdempotencia: randomUUID(),
      tipo: 'CASO',
      coCaso,
      capturadoEm: new Date().toISOString(),
      conteudo: { dtOcorrencia: '2027-05-04', hrOcorrencia: '03:20', dsLocal: 'Via publica, ponto ficticio de teste' },
    }],
  };
}

describe('US-08 — abrir o turno', () => {
  it('a base vem do aparelho, e a guarnição entra por CPF junto com quem abriu', async () => {
    const turno = await turnos.abrir(
      { coDispositivo, coViatura: `V-${cen.sufixo}`, hrInicio: '19:00', hrFim: '07:00', guarnicao: [cpfB] },
      cen.idUsuarioA,
    );
    expect(turno.noBase).toBe(`Base de teste ${cen.sufixo}`);
    expect(turno.coViatura).toBe(`V-${cen.sufixo}`);
    const nomes = turno.guarnicao.map((g) => g.noUsuario);
    expect(nomes).toEqual(expect.arrayContaining([`Profissional A ${cen.sufixo}`, `Profissional B ${cen.sufixo}`]));
    expect(nomes).not.toContain(`Profissional C ${cen.sufixo}`);
  });

  it('um segundo turno aberto ao mesmo tempo é recusado', async () => {
    await expect(turnos.abrir({ coDispositivo, hrInicio: '19:00', hrFim: '07:00' }, cen.idUsuarioA))
      .rejects.toMatchObject({ status: 400 });
  });

  it('aparelho fora do cadastro não abre turno', async () => {
    await expect(turnos.abrir({ coDispositivo: 'APAR-NAO-EXISTE', hrInicio: '19:00', hrFim: '07:00' }, idUsuarioC))
      .rejects.toThrow();
    expect(await turnos.ativoDe(idUsuarioC)).toBeNull();
  });
});

describe('US-09 — encontrar o turno aberto', () => {
  it('quem abriu encontra base, viatura, horário e guarnição', async () => {
    const turno = await turnos.ativoDe(cen.idUsuarioA);
    expect(turno).toMatchObject({ noBase: `Base de teste ${cen.sufixo}`, hrInicio: expect.stringMatching(/^19:00/) });
    expect(turno?.guarnicao).toHaveLength(2);
  });

  it('quem não abriu turno não encontra nenhum', async () => {
    expect(await turnos.ativoDe(idUsuarioC)).toBeNull();
  });
});

describe('US-11 — a guarnição vê os casos do turno', () => {
  const coCaso = `NN-T${Date.now().toString(36).slice(-6).toUpperCase()}`;

  beforeAll(async () => {
    // A abre o caso durante o turno: a sincronização amarra o caso ao turno ativo.
    const r = await sinc.aplicarLote(loteDeAbertura(coCaso), cen.idUsuarioA);
    expect(r.recusados).toHaveLength(0);
  });

  it('B, colega de guarnição, vê o caso na lista e no detalhe', async () => {
    expect((await casos.meusCasos(cen.idUsuarioB)).map((c) => c.coCaso)).toContain(coCaso);
    const detalhe = await casos.porCodigo(coCaso, cen.idUsuarioB);
    expect(detalhe.coCaso).toBe(coCaso);
  });

  it('C, da mesma base mas fora da viatura, não vê', async () => {
    expect((await casos.meusCasos(idUsuarioC)).map((c) => c.coCaso)).not.toContain(coCaso);
  });

  it('para C, o caso responde igual a um caso que não existe (404, mesma mensagem)', async () => {
    const existe = await casos.porCodigo(coCaso, idUsuarioC).catch((e: unknown) => e);
    const naoExiste = await casos.porCodigo('NN-NAO-EXISTE-XYZ', idUsuarioC).catch((e: unknown) => e);
    expect(existe).toMatchObject({ status: 404 });
    expect((existe as { getResponse(): unknown }).getResponse())
      .toEqual((naoExiste as { getResponse(): unknown }).getResponse());
  });
});

describe('US-10 — encerrar o turno', () => {
  it('depois de encerrar não há turno aberto, e dá para abrir outro', async () => {
    await turnos.encerrar(cen.idUsuarioA);
    expect(await turnos.ativoDe(cen.idUsuarioA)).toBeNull();

    const novo = await turnos.abrir({ coDispositivo, hrInicio: '07:00', hrFim: '19:00' }, cen.idUsuarioA);
    expect(novo.hrInicio).toMatch(/^07:00/);
    await turnos.encerrar(cen.idUsuarioA);
  });

  it('o caso continua visível para a guarnição depois que o turno acaba', async () => {
    // A visibilidade é pelo turno em que o caso nasceu, não pelo turno em curso.
    const lista = await casos.meusCasos(cen.idUsuarioB);
    expect(lista.some((c) => c.coCaso.startsWith('NN-T'))).toBe(true);
  });
});
