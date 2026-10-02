import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { BancoPorFinalidade } from '@/acesso/banco-por-finalidade.service';
import type { Parametros } from '@/acesso/banco-por-finalidade.service';
import { AuditoriaService } from '@/modulos/auditoria/auditoria.service';
import { cpfMascarado } from './administracao.esquemas';
import type {
  AlteracaoProfissional, NovoAparelho, NovoProfissional, Revogacao,
} from './administracao.esquemas';

export interface Referencias {
  bases: { codigo: string; nome: string; ativa: boolean }[];
  perfis: { codigo: string; nome: string }[];
}

export interface Profissional {
  id: number;
  nome: string;
  email: string | null;
  /** Só o miolo: a lista não precisa do CPF inteiro (LGPD art. 6º, III). */
  cpf: string;
  cargo: string | null;
  conselho: string | null;
  finalidade: string | null;
  perfis: string[];
  ativo: boolean;
  /** Já definiu a senha (primeiro acesso feito). */
  temSenha: boolean;
}

export interface Aparelho {
  codigo: string;
  base: string;
  nomeBase: string;
  modelo: string | null;
  ativo: boolean;
  autorizadoEm: string;
  revogadoEm: string | null;
}

interface LinhaProfissional extends RowDataPacket {
  id_usuario: number; no_usuario: string; ds_email: string | null; nu_cpf: string;
  ds_cargo: string | null; co_conselho: string | null; co_finalidade: string | null;
  st_ativo: string; tem_senha: number; perfis: string | null;
}
interface LinhaAparelho extends RowDataPacket {
  co_dispositivo: string; co_base: string; no_base: string; ds_modelo: string | null;
  st_ativo: string; st_autorizacao: string; st_revogacao: string | null;
}
interface LinhaPerfil extends RowDataPacket { id_perfil: number; co_perfil: string; ds_perfil: string }
interface LinhaBase extends RowDataPacket { id_base: number; co_base: string; no_base: string; st_ativo: string }

const FINALIDADE = 'ADMINISTRACAO';

/**
 * Cadastro pela tela (US-34).
 *
 * (!) A ADMINISTRAÇÃO NÃO DEFINE SENHA DE NINGUÉM. A conta nasce sem senha, e
 *     a pessoa cria a própria no primeiro acesso, pelo "Perdi minha senha"
 *     (código por e-mail, recuperacao/). Quem cadastra não vê, não digita e
 *     não transmite a senha de outra pessoa; a lista mostra só se o primeiro
 *     acesso já foi feito.
 *
 * (!) NADA SE APAGA. Profissional sai com "inativo" (st_ativo = 'I'; o guard
 *     de autenticação confere a cada requisição, então o acesso cai na hora),
 *     aparelho sai revogado. A trilha e os casos apontam para os dois.
 *
 * (!) TODA ALTERAÇÃO VAI PARA A TRILHA, sem CPF: quem deu e quem tirou acesso
 *     de quem, e quando, é exatamente o que uma auditoria pergunta.
 *
 * (!) NINGUÉM SE TRANCA DO LADO DE FORA. Quem administra não desativa a
 *     própria conta nem tira de si a finalidade de administração.
 */
@Injectable()
export class AdministracaoService {
  constructor(
    private readonly acesso: BancoPorFinalidade,
    private readonly auditoria: AuditoriaService,
  ) {}

  async referencias(): Promise<Referencias> {
    const [bases, perfis] = await Promise.all([
      this.acesso.consultar<LinhaBase>(FINALIDADE, 'SELECT id_base, co_base, no_base, st_ativo FROM mob_base ORDER BY no_base'),
      this.acesso.consultar<LinhaPerfil>(FINALIDADE, 'SELECT id_perfil, co_perfil, ds_perfil FROM mob_perfil ORDER BY co_perfil'),
    ]);
    return {
      bases: bases.map((b) => ({ codigo: b.co_base, nome: b.no_base, ativa: b.st_ativo === 'A' })),
      perfis: perfis.map((p) => ({ codigo: p.co_perfil, nome: p.ds_perfil })),
    };
  }

  async profissionais(): Promise<Profissional[]> {
    const linhas = await this.acesso.consultar<LinhaProfissional>(
      FINALIDADE,
      `SELECT u.id_usuario, u.no_usuario, u.ds_email, u.nu_cpf, u.ds_cargo, u.co_conselho,
              u.co_finalidade, u.st_ativo, (u.ds_senha_hash IS NOT NULL) AS tem_senha,
              GROUP_CONCAT(p.co_perfil ORDER BY p.co_perfil SEPARATOR ',') AS perfis
         FROM mob_usuario u
         LEFT JOIN mob_usuario_perfil up ON up.id_usuario = u.id_usuario
         LEFT JOIN mob_perfil p ON p.id_perfil = up.id_perfil
        GROUP BY u.id_usuario
        ORDER BY u.st_ativo, u.no_usuario`,
    );
    return linhas.map((l) => ({
      id: Number(l.id_usuario),
      nome: l.no_usuario,
      email: l.ds_email,
      cpf: cpfMascarado(l.nu_cpf),
      cargo: l.ds_cargo,
      conselho: l.co_conselho,
      finalidade: l.co_finalidade,
      perfis: l.perfis ? l.perfis.split(',') : [],
      ativo: l.st_ativo === 'A',
      temSenha: Number(l.tem_senha) === 1,
    }));
  }

  async criarProfissional(dados: NovoProfissional, autorId: number): Promise<{ id: number }> {
    const id = await this.acesso.emTransacao(FINALIDADE, async (executar, consultar) => {
      const repetidos = await consultar<RowDataPacket & { campo: string }>(
        `SELECT CASE WHEN nu_cpf = ? THEN 'cpf' ELSE 'email' END AS campo
           FROM mob_usuario WHERE nu_cpf = ? OR ds_email = ? LIMIT 1`,
        [dados.cpf, dados.cpf, dados.email],
      );
      if (repetidos[0]) {
        throw new ConflictException({
          mensagem: repetidos[0].campo === 'cpf' ? 'Já existe uma conta com este CPF.' : 'Já existe uma conta com este e-mail.',
          campo: repetidos[0].campo,
        });
      }
      const idsDePerfil = await this.idsDePerfil(consultar, dados.perfis);
      const r: ResultSetHeader = await executar(
        `INSERT INTO mob_usuario (nu_cpf, no_usuario, ds_email, ds_cargo, co_conselho, co_finalidade, st_ativo)
         VALUES (?, ?, ?, ?, ?, ?, 'A')`,
        [dados.cpf, dados.nome, dados.email, dados.cargo, dados.conselho, dados.finalidade],
      );
      for (const idPerfil of idsDePerfil) {
        await executar('INSERT INTO mob_usuario_perfil (id_usuario, id_perfil) VALUES (?, ?)', [r.insertId, idPerfil]);
      }
      return r.insertId;
    });

    await this.auditoria.registrar({
      usuarioId: autorId, finalidade: FINALIDADE, acao: 'admin_profissional_criado',
      recurso: `admin/profissionais/${id}`,
      detalhe: { id, finalidade: dados.finalidade, perfis: dados.perfis },
    });
    return { id };
  }

  async alterarProfissional(id: number, dados: AlteracaoProfissional, autorId: number): Promise<void> {
    if (id === autorId && (dados.ativo === false || (dados.finalidade !== undefined && dados.finalidade !== FINALIDADE))) {
      throw new BadRequestException({
        mensagem: 'Você não pode desativar a própria conta nem tirar dela a administração. Peça a outra pessoa da administração.',
      });
    }
    const antes = (await this.profissionais()).find((p) => p.id === id);
    if (!antes) throw new NotFoundException({ mensagem: 'Profissional não encontrado.' });

    await this.acesso.emTransacao(FINALIDADE, async (executar, consultar) => {
      if (dados.ativo !== undefined || dados.finalidade !== undefined) {
        await executar(
          'UPDATE mob_usuario SET st_ativo = COALESCE(?, st_ativo), co_finalidade = COALESCE(?, co_finalidade) WHERE id_usuario = ?',
          [dados.ativo === undefined ? null : dados.ativo ? 'A' : 'I', dados.finalidade ?? null, id],
        );
      }
      if (dados.perfis !== undefined) {
        const idsDePerfil = await this.idsDePerfil(consultar, dados.perfis);
        await executar('DELETE FROM mob_usuario_perfil WHERE id_usuario = ?', [id]);
        for (const idPerfil of idsDePerfil) {
          await executar('INSERT INTO mob_usuario_perfil (id_usuario, id_perfil) VALUES (?, ?)', [id, idPerfil]);
        }
      }
    });

    await this.auditoria.registrar({
      usuarioId: autorId, finalidade: FINALIDADE, acao: 'admin_profissional_alterado',
      recurso: `admin/profissionais/${id}`,
      detalhe: {
        id,
        antes: { ativo: antes.ativo, finalidade: antes.finalidade, perfis: antes.perfis },
        depois: dados,
      },
    });
  }

  async aparelhos(): Promise<Aparelho[]> {
    const linhas = await this.acesso.consultar<LinhaAparelho>(
      FINALIDADE,
      `SELECT d.co_dispositivo, b.co_base, b.no_base, d.ds_modelo, d.st_ativo, d.st_autorizacao, d.st_revogacao
         FROM mob_dispositivo d JOIN mob_base b ON b.id_base = d.id_base
        ORDER BY (d.st_revogacao IS NOT NULL), b.no_base, d.co_dispositivo`,
    );
    return linhas.map((l) => ({
      codigo: l.co_dispositivo, base: l.co_base, nomeBase: l.no_base, modelo: l.ds_modelo,
      ativo: l.st_ativo === 'A' && l.st_revogacao === null,
      autorizadoEm: l.st_autorizacao, revogadoEm: l.st_revogacao,
    }));
  }

  async cadastrarAparelho(dados: NovoAparelho, autorId: number): Promise<void> {
    await this.acesso.emTransacao(FINALIDADE, async (executar, consultar) => {
      const bases = await consultar<LinhaBase>(
        'SELECT id_base, co_base, no_base, st_ativo FROM mob_base WHERE co_base = ? LIMIT 1',
        [dados.base],
      );
      const base = bases[0];
      if (!base || base.st_ativo !== 'A') throw new BadRequestException({ mensagem: 'Base não encontrada ou inativa.', campo: 'base' });
      const existe = await consultar<RowDataPacket>('SELECT 1 FROM mob_dispositivo WHERE co_dispositivo = ? LIMIT 1', [dados.codigo]);
      if (existe[0]) throw new ConflictException({ mensagem: 'Já existe um aparelho com este código.', campo: 'codigo' });
      await executar(
        "INSERT INTO mob_dispositivo (id_base, co_dispositivo, ds_modelo, st_ativo) VALUES (?, ?, ?, 'A')",
        [base.id_base, dados.codigo, dados.modelo],
      );
    });
    await this.auditoria.registrar({
      usuarioId: autorId, finalidade: FINALIDADE, acao: 'admin_aparelho_cadastrado',
      recurso: `admin/aparelhos/${dados.codigo}`, detalhe: { codigo: dados.codigo, base: dados.base },
    });
  }

  /**
   * (!) REVOGAR NÃO TEM VOLTA PELA TELA. É a resposta a tablet perdido ou
   *     roubado; reativar é decisão à parte, no banco, como no importador.
   */
  async revogarAparelho(codigo: string, dados: Revogacao, autorId: number): Promise<void> {
    const r = await this.acesso.executar(
      FINALIDADE,
      "UPDATE mob_dispositivo SET st_ativo = 'I', st_revogacao = CURRENT_TIMESTAMP(6) WHERE co_dispositivo = ? AND st_revogacao IS NULL",
      [codigo],
    );
    if (r.affectedRows !== 1) throw new NotFoundException({ mensagem: 'Aparelho não encontrado ou já revogado.' });
    await this.auditoria.registrar({
      usuarioId: autorId, finalidade: FINALIDADE, acao: 'admin_aparelho_revogado',
      recurso: `admin/aparelhos/${codigo}`, detalhe: { codigo, motivo: dados.motivo },
    });
  }

  private async idsDePerfil(
    consultar: <R extends RowDataPacket>(sql: string, p?: Parametros) => Promise<R[]>,
    codigos: string[],
  ): Promise<number[]> {
    if (codigos.length === 0) return [];
    const linhas = await consultar<LinhaPerfil>(
      `SELECT id_perfil, co_perfil, ds_perfil FROM mob_perfil WHERE co_perfil IN (${codigos.map(() => '?').join(', ')})`,
      codigos,
    );
    const conhecidos = new Set(linhas.map((l) => l.co_perfil));
    const desconhecidos = codigos.filter((c) => !conhecidos.has(c));
    if (desconhecidos.length > 0) {
      throw new BadRequestException({ mensagem: `Perfil desconhecido: ${desconhecidos.join(', ')}.`, campo: 'perfis' });
    }
    return linhas.map((l) => Number(l.id_perfil));
  }
}
