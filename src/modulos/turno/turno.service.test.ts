import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { TurnoService } from './turno.service';
import type { BancoPorFinalidade } from '@/acesso/banco-por-finalidade.service';
import type { AuditoriaService } from '@/modulos/auditoria/auditoria.service';

const DISPOSITIVO = { id_dispositivo: 1, id_base: 10, no_base: 'Base 1' };
const TURNO_ATIVO = {
  id_turno: 5, id_base: 10, no_base: 'Base 1', id_viatura: null, co_viatura: null,
  id_dispositivo: 1, hr_inicio: '07:00:00', hr_fim: '19:00:00', st_abertura: '2027-01-01T07:00:00.000Z',
};

function montar(opts: {
  dispositivoLinhas?: unknown[];
  turnoAtivoLinhas?: unknown[];
  guarnicaoLinhas?: unknown[];
  viaturaLinhas?: unknown[];
  usuarioPorCpf?: Record<string, unknown[]>;
}) {
  const consultar = vi.fn().mockImplementation(async (_fin: string, sql: string, params: unknown[] = []) => {
    if (sql.includes('FROM mob_dispositivo')) return opts.dispositivoLinhas ?? [DISPOSITIVO];
    if (sql.includes('FROM mob_turno t')) return opts.turnoAtivoLinhas ?? [];
    if (sql.includes('FROM mob_turno_guarnicao')) return opts.guarnicaoLinhas ?? [];
    if (sql.includes('FROM mob_viatura')) return opts.viaturaLinhas ?? [];
    if (sql.includes('FROM mob_usuario WHERE nu_cpf')) {
      const cpf = params[0] as string;
      return opts.usuarioPorCpf?.[cpf] ?? [];
    }
    return [];
  });
  const executar = vi.fn().mockResolvedValue({ affectedRows: 1 });
  const emTransacao = vi.fn(async (_f: string, corpo: (...a: unknown[]) => unknown) => {
    const exec = async (sql: string, p: unknown[] = []) => executar('ASSISTENCIAL', sql, p) as never;
    const cons = async (sql: string, p: unknown[] = []) => consultar('ASSISTENCIAL', sql, p) as never;
    return corpo(exec, cons);
  });
  const acesso = { consultar, executar, emTransacao } as unknown as BancoPorFinalidade;
  const auditoria = { registrar: vi.fn().mockResolvedValue('hash') } as unknown as AuditoriaService;
  return { acesso, auditoria, consultar, executar };
}

describe('abrir', () => {
  it('recusa aparelho nao autorizado', async () => {
    const { acesso, auditoria } = montar({ dispositivoLinhas: [] });
    await expect(
      new TurnoService(acesso, auditoria).abrir(
        { coDispositivo: 'D1', hrInicio: '07:00', hrFim: '19:00' }, 1,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa abrir um segundo turno para quem ja tem um aberto', async () => {
    // primeira chamada a ativoDe (checagem previa) ja acha turno aberto
    const { acesso, auditoria } = montar({ turnoAtivoLinhas: [TURNO_ATIVO] });
    expect.assertions(2);
    try {
      await new TurnoService(acesso, auditoria).abrir(
        { coDispositivo: 'D1', hrInicio: '07:00', hrFim: '19:00' }, 1,
      );
    } catch (erro) {
      expect(erro).toBeInstanceOf(BadRequestException);
      expect(JSON.stringify((erro as BadRequestException).getResponse())).toContain('já tem um turno aberto');
    }
  });

  it('mascara o CPF de colega fora do cadastro, sem derrubar a abertura', async () => {
    // A checagem "já tem turno aberto" roda antes do INSERT; o turno só
    // aparece nas consultas feitas depois dele.
    let chamadasTurnoAtivo = 0;
    const consultar = vi.fn().mockImplementation(async (_fin: string, sql: string) => {
      if (sql.includes('FROM mob_dispositivo')) return [DISPOSITIVO];
      if (sql.includes('FROM mob_turno t')) {
        chamadasTurnoAtivo += 1;
        return chamadasTurnoAtivo === 1 ? [] : [TURNO_ATIVO];
      }
      if (sql.includes('FROM mob_turno_guarnicao')) return [];
      if (sql.includes('FROM mob_usuario WHERE nu_cpf')) return []; // ninguem com esse CPF
      return [];
    });
    const executar = vi.fn().mockResolvedValue({ insertId: TURNO_ATIVO.id_turno });
    const emTransacao = vi.fn(async (_f: string, corpo: (...a: unknown[]) => unknown) => {
      const exec = async (sql: string, p: unknown[] = []) => executar(sql, p) as never;
      const cons = async (sql: string, p: unknown[] = []) => consultar('ASSISTENCIAL', sql, p) as never;
      return corpo(exec, cons);
    });
    const acesso = { consultar, executar, emTransacao } as unknown as BancoPorFinalidade;
    const auditoria = { registrar: vi.fn().mockResolvedValue('hash') } as unknown as AuditoriaService;

    const turno = await new TurnoService(acesso, auditoria).abrir(
      { coDispositivo: 'D1', hrInicio: '07:00', hrFim: '19:00', guarnicao: ['12345678901'] }, 1,
    );

    expect(turno.idTurno).toBe(TURNO_ATIVO.id_turno);
    const registro = (auditoria.registrar as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(registro.detalhe.naoCadastrados).toEqual(['***8901']);
  });

  it('aceita viatura de outra base, mas registra a divergencia na auditoria', async () => {
    let chamadasTurnoAtivo = 0;
    const consultar = vi.fn().mockImplementation(async (_fin: string, sql: string) => {
      if (sql.includes('FROM mob_dispositivo')) return [DISPOSITIVO];
      if (sql.includes('FROM mob_viatura')) return [{ id_viatura: 77, id_base: 999 }];
      if (sql.includes('FROM mob_turno t')) {
        chamadasTurnoAtivo += 1;
        return chamadasTurnoAtivo === 1 ? [] : [TURNO_ATIVO];
      }
      if (sql.includes('FROM mob_turno_guarnicao')) return [];
      return [];
    });
    const executar = vi.fn().mockResolvedValue({ insertId: 5 });
    const emTransacao = vi.fn(async (_f: string, corpo: (...a: unknown[]) => unknown) => {
      const exec = async (sql: string, p: unknown[] = []) => executar(sql, p) as never;
      const cons = async (sql: string, p: unknown[] = []) => consultar('ASSISTENCIAL', sql, p) as never;
      return corpo(exec, cons);
    });
    const acesso = { consultar, executar, emTransacao } as unknown as BancoPorFinalidade;
    const auditoria = { registrar: vi.fn().mockResolvedValue('hash') } as unknown as AuditoriaService;

    await new TurnoService(acesso, auditoria).abrir(
      { coDispositivo: 'D1', coViatura: 'V1', hrInicio: '07:00', hrFim: '19:00' }, 1,
    );

    const acoes = (auditoria.registrar as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].acao);
    expect(acoes).toContain('viatura_de_outra_base');
    expect(acoes).toContain('turno_aberto');
  });
});

describe('encerrar', () => {
  it('so audita quando de fato havia turno aberto para encerrar', async () => {
    const { acesso, auditoria, executar } = montar({});
    executar.mockResolvedValue({ affectedRows: 0 });
    await new TurnoService(acesso, auditoria).encerrar(1);
    expect(auditoria.registrar).not.toHaveBeenCalled();
  });

  it('audita quando um turno foi encerrado', async () => {
    const { acesso, auditoria, executar } = montar({});
    executar.mockResolvedValue({ affectedRows: 1 });
    await new TurnoService(acesso, auditoria).encerrar(1, 'fim do plantao');
    expect(auditoria.registrar).toHaveBeenCalledTimes(1);
  });
});

describe('ativoDe', () => {
  it('devolve null quando nao ha turno aberto', async () => {
    const { acesso, auditoria } = montar({ turnoAtivoLinhas: [] });
    await expect(new TurnoService(acesso, auditoria).ativoDe(1)).resolves.toBeNull();
  });

  it('monta a guarnicao junto do turno ativo', async () => {
    const { acesso, auditoria } = montar({
      turnoAtivoLinhas: [TURNO_ATIVO],
      guarnicaoLinhas: [{ no_usuario: 'Ana', ds_funcao: 'motorista' }],
    });
    const turno = await new TurnoService(acesso, auditoria).ativoDe(1);
    expect(turno?.guarnicao).toEqual([{ noUsuario: 'Ana', dsFuncao: 'motorista' }]);
  });
});
