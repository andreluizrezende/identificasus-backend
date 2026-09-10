import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { RowDataPacket } from 'mysql2/promise';
import { BancoPorFinalidade } from '@/acesso/banco-por-finalidade.service';
import { TokenService } from '@/acesso/token.service';
import { AuditoriaService } from '@/modulos/auditoria/auditoria.service';
import type { Entrada, SessaoAberta } from './sessao.esquemas';

/** Aparelho fora de `mob_dispositivo`, inativo ou revogado. */
export class DispositivoNaoAutorizado extends Error {}
/** Senha errada, conta inexistente, conta inativa — tudo isto, e só isto. */
export class CredencialRecusada extends Error {}
/** Keycloak fora do ar ou mal configurado. Não é culpa de quem está entrando. */
export class AutenticacaoIndisponivel extends Error {}

/** 72 horas: o limite da sessão fora de linha (RF-11.04). */
const HORAS_DE_SESSAO = 72;

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
}

interface LinhaPerfil extends RowDataPacket {
  co_perfil: string;
}

/**
 * Entrada e saída do aplicativo de campo.
 *
 * (!) A SENHA PASSA POR AQUI E NÃO PARA AQUI. É a consequência assumida da
 *     concessão direta (ver keycloak/LEIA-ME.md): ela é encaminhada ao Keycloak
 *     na mesma requisição e descartada. Não é gravada, não entra em log, não vai
 *     para a trilha de auditoria e `mob_usuario` continua sem coluna de senha.
 *
 * (!) O APARELHO É CONFERIDO ANTES DA SENHA, e essa ordem é o motivo de a rota
 *     existir em vez de o aplicativo falar direto com o Keycloak. Aparelho não
 *     autorizado é recusado sem que a credencial chegue a sair do backend — e,
 *     principalmente, sem que ele fique com um token válido na mão.
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

    const concessao = await this.concessaoDireta(dados.ds_email, dados.senha);
    const portador = await this.token.verificar(concessao.access_token);

    const usuario = await this.usuarioDo(portador.sub);
    if (!usuario) {
      // Credencial boa no Keycloak, pessoa ausente do cadastro local. Sai como
      // recusa, e não como erro: quem tenta descobrir contas não aprende com
      // isto qual das duas metades faltou.
      this.log.warn(`sub ${portador.sub} autenticou sem linha em mob_usuario`);
      throw new CredencialRecusada();
    }

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
      token: concessao.access_token,
      renovacao: concessao.refresh_token,
      expiraEmSegundos: concessao.expires_in,
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
   * Encerra a sessão local. Não derruba o token do Keycloak — quem faz isso é o
   * aplicativo, apagando o que guardou. O que esta linha registra é o instante
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

  private async usuarioDo(sub: string): Promise<LinhaUsuario | null> {
    const linhas = await this.acesso.consultar<LinhaUsuario>(
      'ASSISTENCIAL',
      `SELECT id_usuario, no_usuario, ds_email, st_ativo
         FROM mob_usuario WHERE co_usuario_idp = ? LIMIT 1`,
      [sub],
    );
    const usuario = linhas[0];
    return usuario && usuario.st_ativo === 'A' ? usuario : null;
  }

  private async concessaoDireta(
    email: string,
    senha: string,
  ): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
    const emissor = process.env.OIDC_ISSUER;
    if (!emissor) throw new AutenticacaoIndisponivel('OIDC_ISSUER não configurado');

    let resposta: Response;
    try {
      resposta = await fetch(`${emissor}/protocol/openid-connect/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'password',
          client_id: process.env.OIDC_CLIENT_ID ?? 'identificasus-app',
          scope: 'openid',
          username: email,
          password: senha,
        }),
      });
    } catch (erro) {
      const motivo = erro instanceof Error ? erro.message : 'falha desconhecida';
      throw new AutenticacaoIndisponivel(motivo);
    }

    // 400 e 401 são "credencial não serve" — inclusive a conta bloqueada pelo
    // freio de tentativas do próprio Keycloak. Qualquer outro código é problema
    // do servidor, e dizer "senha errada" nesse caso manda a pessoa procurar
    // erro onde não há.
    if (resposta.status === 400 || resposta.status === 401) throw new CredencialRecusada();
    if (!resposta.ok) throw new AutenticacaoIndisponivel(`keycloak respondeu ${resposta.status}`);

    const dados: unknown = await resposta.json();
    if (typeof dados !== 'object' || dados === null) {
      throw new AutenticacaoIndisponivel('keycloak devolveu resposta ilegível');
    }
    const mapa = dados as Record<string, unknown>;
    const acesso = mapa['access_token'];
    const renovacao = mapa['refresh_token'];
    const validade = mapa['expires_in'];
    if (typeof acesso !== 'string' || typeof renovacao !== 'string') {
      throw new AutenticacaoIndisponivel('keycloak devolveu concessão sem token');
    }
    return {
      access_token: acesso,
      refresh_token: renovacao,
      expires_in: typeof validade === 'number' ? validade : 900,
    };
  }
}

/** `dateStrings: true` no pool: a data vai como texto UTC, sem passar pelo fuso do driver. */
function comoMySQL(d: Date): string {
  return d.toISOString().replace('T', ' ').replace('Z', '');
}
