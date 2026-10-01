import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { RowDataPacket } from 'mysql2/promise';
import { BancoPorFinalidade } from '@/acesso/banco-por-finalidade.service';
import { conferirSenha } from '@/acesso/senha';
import { AssinaturaIndisponivel, TokenService } from '@/acesso/token.service';
import type { TokensEmitidos } from '@/acesso/token.service';
import { AuditoriaService } from '@/modulos/auditoria/auditoria.service';
import type { Entrada, SessaoAberta } from './sessao.esquemas';

/** Aparelho fora de `mob_dispositivo`, inativo ou revogado. */
export class DispositivoNaoAutorizado extends Error {}
/** Senha errada, conta inexistente, inativa ou bloqueada — tudo isto, e só isto. */
export class CredencialRecusada extends Error {}
/** Assinatura de token sem configuração. Não é culpa de quem está entrando. */
export class AutenticacaoIndisponivel extends Error {}

/** 72 horas: o limite da sessão fora de linha (RF-11.04). */
const HORAS_DE_SESSAO = 72;

/**
 * Freio de tentativas por conta: a partir da quinta senha errada seguida, a
 * conta espera 60 s a mais a cada erro, até o teto de 15 minutos. Não é bloqueio permanente de propósito — trancar a conta
 * de vez daria a qualquer um o poder de tirar um socorrista do plantão
 * digitando o e-mail dele com a senha errada cinco vezes.
 */
export const FALHAS_ANTES_DO_BLOQUEIO = 5;
const SEGUNDOS_POR_FALHA = 60;
const SEGUNDOS_MAXIMOS_DE_BLOQUEIO = 900;

interface LinhaDispositivo extends RowDataPacket {
  id_dispositivo: number;
  co_dispositivo: string;
  id_base: number;
  no_base: string;
}

interface LinhaUsuario extends RowDataPacket {
  id_usuario: number;
  no_usuario: string;
  ds_email: string | null;
  st_ativo: string;
  ds_senha_hash: string | null;
  co_finalidade: string | null;
  qt_falhas_login: number;
  /** 1 quando `st_bloqueio_ate` ainda está no futuro, pelo relógio do banco. */
  lg_bloqueado: number;
}

interface LinhaPerfil extends RowDataPacket {
  co_perfil: string;
}

/**
 * Entrada e saída do aplicativo de campo.
 *
 * (!) A SENHA EM CLARO NÃO SAI DESTA REQUISIÇÃO. É conferida contra o hash de
 *     `mob_usuario.ds_senha_hash` (ver `acesso/senha.ts`) e descartada: não é
 *     gravada, não entra em log e não vai para a trilha de auditoria.
 *
 * (!) O APARELHO É CONFERIDO ANTES DA SENHA. Aparelho não autorizado é recusado
 *     sem que a credencial chegue a ser avaliada — e, principalmente, sem que
 *     ele fique com um token válido na mão.
 *
 * (!) CONTA INEXISTENTE, INATIVA, BLOQUEADA E SENHA ERRADA SAEM IGUAIS, e no
 *     mesmo tempo: o hash é calculado em todos os casos (`conferirSenha` usa um
 *     engodo quando não há hash). Quem tenta descobrir contas não aprende nada
 *     com a resposta nem com o cronômetro.
 */
@Injectable()
export class SessaoService {
  private readonly log = new Logger('sessao');

  constructor(
    private readonly acesso: BancoPorFinalidade,
    private readonly token: TokenService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async entrar(dados: Entrada, origem: string): Promise<SessaoAberta> {
    const dispositivo = await this.aparelhoAutorizado(dados.coDispositivo);

    const usuario = await this.usuarioPorEmail(dados.ds_email);
    // Sempre calcula o hash, mesmo sem conta: ver o terceiro (!) acima.
    const senhaConfere = await conferirSenha(dados.senha, usuario?.ds_senha_hash ?? null);

    if (!usuario) throw new CredencialRecusada();
    if (Number(usuario.lg_bloqueado) === 1) {
      // Bloqueado não conta nova falha: senão o teto de 15 min viraria
      // permanente para quem continuasse tentando — inclusive o dono da conta.
      throw new CredencialRecusada();
    }
    if (!senhaConfere) {
      await this.registrarFalha(usuario.id_usuario);
      throw new CredencialRecusada();
    }
    if (usuario.st_ativo !== 'A') throw new CredencialRecusada();
    if (usuario.qt_falhas_login > 0) await this.zerarFalhas(usuario.id_usuario);

    const perfis = await this.acesso.consultar<LinhaPerfil>(
      'ASSISTENCIAL',
      `SELECT p.co_perfil
         FROM mob_usuario_perfil up
         JOIN mob_perfil p ON p.id_perfil = up.id_perfil
        WHERE up.id_usuario = ? AND p.st_ativo = 'A'`,
      [usuario.id_usuario],
    );

    const coSessao = randomUUID();
    const expiraEm = new Date(Date.now() + HORAS_DE_SESSAO * 3600 * 1000);
    const tokens = await this.emitir(usuario, coSessao);

    await this.acesso.executar(
      'ASSISTENCIAL',
      `INSERT INTO mob_sessao (id_usuario, id_dispositivo, co_token, st_expiracao)
       VALUES (?, ?, ?, ?)`,
      [usuario.id_usuario, dispositivo.id_dispositivo, coSessao, comoMySQL(expiraEm)],
    );

    await this.auditoria.registrar({
      usuarioId: usuario.id_usuario,
      finalidade: 'ASSISTENCIAL',
      acao: 'sessao_aberta',
      recurso: 'sessao',
      dispositivoId: dispositivo.id_dispositivo,
      detalhe: { coSessao, origem },
    });

    return {
      token: tokens.acesso,
      renovacao: tokens.renovacao,
      expiraEmSegundos: tokens.expiraEmSegundos,
      coSessao,
      st_expiracao: expiraEm.toISOString(),
      usuario: {
        id: usuario.id_usuario,
        no_usuario: usuario.no_usuario,
        ds_email: usuario.ds_email,
        perfis: perfis.map((p) => p.co_perfil),
      },
      dispositivo: {
        co_dispositivo: dispositivo.co_dispositivo,
        id_base: dispositivo.id_base,
        no_base: dispositivo.no_base,
      },
    };
  }

  /**
   * Encerra a sessão local. Não revoga o token de acesso, que morre sozinho em
   * 15 minutos — quem o descarta é o aplicativo, apagando o que guardou. O que esta linha registra é o instante
   * em que o aparelho declarou ter saído, que é o que a trilha precisa saber.
   */
  async sair(usuarioId: number, coSessao: string, motivo?: string): Promise<void> {
    const r = await this.acesso.executar(
      'ASSISTENCIAL',
      `UPDATE mob_sessao
          SET st_encerramento = CURRENT_TIMESTAMP(6),
              ds_motivo_encerramento = ?
        WHERE co_token = ? AND id_usuario = ? AND st_encerramento IS NULL`,
      [motivo ?? 'saida pelo aplicativo', coSessao, usuarioId],
    );
    if (r.affectedRows > 0) {
      await this.auditoria.registrar({
        usuarioId,
        finalidade: 'ASSISTENCIAL',
        acao: 'sessao_encerrada',
        recurso: 'sessao',
        detalhe: { coSessao, motivo: motivo ?? null },
      });
    }
  }

  /**
   * Marca que o aparelho apagou os dados locais depois do envio confirmado
   * (tela M13). É a contrapartida do "telefone perdido deixa de ser dado
   * vazado": sem esta marca, ninguém consegue afirmar que o expurgo aconteceu.
   */
  async confirmarExpurgo(usuarioId: number, coSessao: string): Promise<void> {
    await this.acesso.executar(
      'ASSISTENCIAL',
      `UPDATE mob_sessao SET lg_expurgo_local = 1
        WHERE co_token = ? AND id_usuario = ?`,
      [coSessao, usuarioId],
    );
    await this.auditoria.registrar({
      usuarioId,
      finalidade: 'ASSISTENCIAL',
      acao: 'expurgo_local_confirmado',
      recurso: 'sessao',
      detalhe: { coSessao },
    });
  }

  // ───────────────────────────── auxiliares ─────────────────────────────

  private async aparelhoAutorizado(coDispositivo: string): Promise<LinhaDispositivo> {
    const linhas = await this.acesso.consultar<LinhaDispositivo>(
      'ASSISTENCIAL',
      `SELECT d.id_dispositivo, d.co_dispositivo, d.id_base, b.no_base
         FROM mob_dispositivo d
         JOIN mob_base b ON b.id_base = d.id_base
        WHERE d.co_dispositivo = ?
          AND d.st_ativo = 'A'
          AND d.st_revogacao IS NULL
          AND b.st_ativo = 'A'
        LIMIT 1`,
      [coDispositivo],
    );
    const dispositivo = linhas[0];
    if (!dispositivo) throw new DispositivoNaoAutorizado();
    return dispositivo;
  }

  private async usuarioPorEmail(dsEmail: string): Promise<LinhaUsuario | null> {
    const linhas = await this.acesso.consultar<LinhaUsuario>(
      'ASSISTENCIAL',
      `SELECT id_usuario, no_usuario, ds_email, st_ativo, ds_senha_hash, co_finalidade,
              qt_falhas_login,
              (st_bloqueio_ate IS NOT NULL AND st_bloqueio_ate > NOW(6)) AS lg_bloqueado
         FROM mob_usuario WHERE ds_email = ? LIMIT 1`,
      [dsEmail],
    );
    return linhas[0] ?? null;
  }

  /**
   * Uma instrução só, para que duas tentativas simultâneas não se percam uma na
   * outra. No UPDATE de tabela única o MySQL avalia as atribuições da esquerda
   * para a direita: `st_bloqueio_ate` já enxerga o contador incrementado.
   */
  private async registrarFalha(idUsuario: number): Promise<void> {
    await this.acesso.executar(
      'ASSISTENCIAL',
      `UPDATE mob_usuario
          SET qt_falhas_login = LEAST(qt_falhas_login + 1, 255),
              st_bloqueio_ate = IF(
                qt_falhas_login >= ?,
                DATE_ADD(NOW(6), INTERVAL LEAST(? * (qt_falhas_login - ? + 1), ?) SECOND),
                st_bloqueio_ate)
        WHERE id_usuario = ?`,
      [
        FALHAS_ANTES_DO_BLOQUEIO,
        SEGUNDOS_POR_FALHA,
        FALHAS_ANTES_DO_BLOQUEIO,
        SEGUNDOS_MAXIMOS_DE_BLOQUEIO,
        idUsuario,
      ],
    );
  }

  private async zerarFalhas(idUsuario: number): Promise<void> {
    await this.acesso.executar(
      'ASSISTENCIAL',
      'UPDATE mob_usuario SET qt_falhas_login = 0, st_bloqueio_ate = NULL WHERE id_usuario = ?',
      [idUsuario],
    );
  }

  private async emitir(usuario: LinhaUsuario, coSessao: string): Promise<TokensEmitidos> {
    try {
      return await this.token.emitir({
        idUsuario: usuario.id_usuario,
        finalidade: usuario.co_finalidade,
        dsEmail: usuario.ds_email,
        coSessao,
      });
    } catch (erro) {
      if (erro instanceof AssinaturaIndisponivel) {
        this.log.error(erro.message);
        throw new AutenticacaoIndisponivel(erro.message);
      }
      throw erro;
    }
  }
}

/** `dateStrings: true` no pool: a data vai como texto UTC, sem passar pelo fuso do driver. */
function comoMySQL(d: Date): string {
  return d.toISOString().replace('T', ' ').replace('Z', '');
}
