import { BadRequestException, Injectable } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { BancoPorFinalidade } from '@/acesso/banco-por-finalidade.service';
import { AuditoriaService } from '@/modulos/auditoria/auditoria.service';
import type { AberturaDeTurno, TurnoAberto } from './turno.esquemas';

interface LinhaDispositivo extends RowDataPacket {
  id_dispositivo: number;
  id_base: number;
  no_base: string;
}
interface LinhaViatura extends RowDataPacket { id_viatura: number; id_base: number }
interface LinhaTurno extends RowDataPacket {
  id_turno: number;
  id_base: number;
  no_base: string;
  id_viatura: number | null;
  co_viatura: string | null;
  id_dispositivo: number;
  hr_inicio: string;
  hr_fim: string;
  st_abertura: string;
}
interface LinhaUsuario extends RowDataPacket { id_usuario: number }

/**
 * Turno: quem está de plantão, em qual base, em qual viatura, em qual aparelho.
 *
 * (!) A GUARNIÇÃO NÃO TRANSFERE AUTORIA. Registrar quem mais está na viatura
 *     serve para a leitura do caso e para a busca depois — não para dizer que
 *     qualquer um deles capturou o dado. `mob_caso_atributo.id_usuario` continua
 *     sendo quem digitou, uma pessoa só, sempre (RF-10.01). É por isso que
 *     `mob_turno_guarnicao` é uma tabela separada e não uma coluna do caso.
 */
@Injectable()
export class TurnoService {
  constructor(
    private readonly acesso: BancoPorFinalidade,
    private readonly auditoria: AuditoriaService,
  ) {}

  async abrir(dados: AberturaDeTurno, usuarioId: number): Promise<TurnoAberto> {
    const dispositivo = await this.aparelho(dados.coDispositivo);
    const viatura = dados.coViatura
      ? await this.viatura(dados.coViatura, dispositivo.id_base, usuarioId)
      : null;

    // (!) UM TURNO ABERTO POR PESSOA. Dois turnos simultâneos deixariam o caso
    //     sem saber a qual pertence — e é o turno que responde "quem estava
    //     junto" quando alguém precisar reconstituir o atendimento.
    const aberto = await this.ativoDe(usuarioId);
    if (aberto) {
      throw new BadRequestException({
        mensagem: 'Você já tem um turno aberto.',
        acao: 'Encerre o turno anterior antes de abrir outro.',
      });
    }

    const naoCadastrados: string[] = [];
    const idTurno = await this.acesso.emTransacao('ASSISTENCIAL', async (executar, consultar) => {
      const r = await executar(
        `INSERT INTO mob_turno
           (id_usuario, id_base, id_viatura, id_dispositivo, hr_inicio, hr_fim, st_turno)
         VALUES (?, ?, ?, ?, ?, ?, 'A')`,
        [
          usuarioId, dispositivo.id_base, viatura?.id_viatura ?? null,
          dispositivo.id_dispositivo, dados.hrInicio, dados.hrFim,
        ],
      );

      // Quem abriu entra na guarnição também: é o caso mais comum e esquecê-lo
      // faria a própria pessoa sumir da composição.
      await executar(
        'INSERT IGNORE INTO mob_turno_guarnicao (id_turno, id_usuario, ds_funcao) VALUES (?, ?, ?)',
        [r.insertId, usuarioId, dados.dsFuncao ?? 'responsável pelo registro'],
      );

      for (const cpf of dados.guarnicao ?? []) {
        const linhas = await consultar<LinhaUsuario>(
          "SELECT id_usuario FROM mob_usuario WHERE nu_cpf = ? AND st_ativo = 'A' LIMIT 1",
          [cpf],
        );
        const colega = linhas[0];
        // Colega fora do cadastro não derruba a abertura do turno: a viatura
        // sai mesmo assim, e um turno não aberto é um plantão inteiro sem
        // registro. Quem faltou vai para a trilha, com o CPF mascarado —
        // é o suficiente para a coordenação achar a pendência de cadastro.
        if (colega) {
          await executar(
            'INSERT IGNORE INTO mob_turno_guarnicao (id_turno, id_usuario) VALUES (?, ?)',
            [r.insertId, colega.id_usuario],
          );
        } else {
          naoCadastrados.push(`***${cpf.slice(-4)}`);
        }
      }
      return r.insertId;
    });

    await this.auditoria.registrar({
      usuarioId,
      finalidade: 'ASSISTENCIAL',
      acao: 'turno_aberto',
      recurso: 'turno',
      dispositivoId: dispositivo.id_dispositivo,
      detalhe: {
        idTurno,
        base: dispositivo.no_base,
        viatura: dados.coViatura ?? null,
        naoCadastrados,
      },
    });

    const atual = await this.ativoDe(usuarioId);
    if (!atual) throw new Error('turno gravado mas não encontrado — abortando.');
    return atual;
  }

  async encerrar(usuarioId: number, motivo?: string): Promise<void> {
    const r = await this.acesso.executar(
      'ASSISTENCIAL',
      `UPDATE mob_turno
          SET st_turno = 'E', st_encerramento = CURRENT_TIMESTAMP(6)
        WHERE id_usuario = ? AND st_turno = 'A'`,
      [usuarioId],
    );
    if (r.affectedRows > 0) {
      await this.auditoria.registrar({
        usuarioId,
        finalidade: 'ASSISTENCIAL',
        acao: 'turno_encerrado',
        recurso: 'turno',
        detalhe: { motivo: motivo ?? null },
      });
    }
  }

  async ativoDe(usuarioId: number): Promise<TurnoAberto | null> {
    const linhas = await this.acesso.consultar<LinhaTurno>(
      'ASSISTENCIAL',
      `SELECT t.id_turno, t.id_base, b.no_base, t.id_viatura, v.co_viatura,
              t.id_dispositivo, t.hr_inicio, t.hr_fim, t.st_abertura
         FROM mob_turno t
         JOIN mob_base b ON b.id_base = t.id_base
         LEFT JOIN mob_viatura v ON v.id_viatura = t.id_viatura
        WHERE t.id_usuario = ? AND t.st_turno = 'A'
        ORDER BY t.id_turno DESC LIMIT 1`,
      [usuarioId],
    );
    const t = linhas[0];
    if (!t) return null;

    const guarnicao = await this.acesso.consultar<RowDataPacket & { no_usuario: string; ds_funcao: string | null }>(
      'ASSISTENCIAL',
      `SELECT u.no_usuario, g.ds_funcao
         FROM mob_turno_guarnicao g
         JOIN mob_usuario u ON u.id_usuario = g.id_usuario
        WHERE g.id_turno = ? ORDER BY g.id_turno_guarnicao`,
      [t.id_turno],
    );

    return {
      idTurno: t.id_turno,
      idBase: t.id_base,
      noBase: t.no_base,
      idViatura: t.id_viatura,
      coViatura: t.co_viatura,
      idDispositivo: t.id_dispositivo,
      hrInicio: t.hr_inicio,
      hrFim: t.hr_fim,
      abertoEm: t.st_abertura,
      guarnicao: guarnicao.map((g) => ({ noUsuario: g.no_usuario, dsFuncao: g.ds_funcao })),
    };
  }

  private async aparelho(coDispositivo: string): Promise<LinhaDispositivo> {
    const linhas = await this.acesso.consultar<LinhaDispositivo>(
      'ASSISTENCIAL',
      `SELECT d.id_dispositivo, d.id_base, b.no_base
         FROM mob_dispositivo d JOIN mob_base b ON b.id_base = d.id_base
        WHERE d.co_dispositivo = ? AND d.st_ativo = 'A' AND d.st_revogacao IS NULL
        LIMIT 1`,
      [coDispositivo],
    );
    const d = linhas[0];
    if (!d) {
      throw new BadRequestException({
        mensagem: 'Este aparelho não está autorizado.',
        acao: 'Procure a coordenação da base.',
      });
    }
    return d;
  }

  private async viatura(coViatura: string, idBase: number, usuarioId: number): Promise<LinhaViatura> {
    const linhas = await this.acesso.consultar<LinhaViatura>(
      'ASSISTENCIAL',
      `SELECT id_viatura, id_base FROM mob_viatura
        WHERE co_viatura = ? AND st_ativo = 'A' LIMIT 1`,
      [coViatura],
    );
    const v = linhas[0];
    if (!v) {
      throw new BadRequestException({ mensagem: `Viatura ${coViatura} não encontrada.` });
    }
    // Viatura de outra base é aceita, com o registro: remanejamento entre bases
    // acontece, e recusar aqui deixaria a equipe sem turno numa noite em que a
    // viatura foi emprestada. O que não pode é passar despercebido.
    if (v.id_base !== idBase) {
      await this.auditoria.registrar({
        usuarioId,
        finalidade: 'ASSISTENCIAL',
        acao: 'viatura_de_outra_base',
        recurso: 'turno',
        detalhe: { coViatura, baseDoAparelho: idBase, baseDaViatura: v.id_base },
      });
    }
    return v;
  }
}
