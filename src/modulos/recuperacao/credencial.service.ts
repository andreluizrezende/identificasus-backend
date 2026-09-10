import { Injectable, Logger } from '@nestjs/common';

export type TrocaDeSenha = { trocada: true } | { trocada: false; motivo: string };

/**
 * Troca de senha do profissional.
 *
 * (!) AQUI ESTA A DIFERENCA EM RELACAO AO fiocruz-backend. La a senha e um
 *     hash bcrypt numa coluna de mob_usuarios, e a rota troca a coluna. Neste
 *     projeto quem guarda credencial e o Keycloak (ADR-09): mob_usuario nao tem
 *     e nao deve ganhar coluna de senha. Criar uma abriria um segundo
 *     armazenamento de credencial — dois lugares para revogar, dois para vazar,
 *     e duas respostas possiveis para "esta senha ainda vale?".
 *
 * (!) O QUE NAO MUDOU E O QUE IMPORTA: o codigo de uso unico, o teto de
 *     tentativas, a resposta neutra e a trilha continuam iguais aos do
 *     fiocruz. So o ultimo passo mudou de dono.
 *
 * (!) NAO LANCA, pelo mesmo motivo do correio: quem chama precisa escolher o
 *     que dizer a quem esta esperando.
 */
@Injectable()
export class Credencial {
  private readonly log = new Logger('credencial');

  configurado(): boolean {
    return Boolean(
      process.env.OIDC_ISSUER &&
        process.env.KEYCLOAK_ADMIN_CLIENT_ID &&
        process.env.KEYCLOAK_ADMIN_CLIENT_SECRET,
    );
  }

  async trocarSenha(coUsuarioIdp: string, novaSenha: string): Promise<TrocaDeSenha> {
    if (!this.configurado()) {
      return { trocada: false, motivo: 'keycloak sem credencial administrativa no ambiente' };
    }

    try {
      const token = await this.tokenAdministrativo();
      if (!token) return { trocada: false, motivo: 'keycloak recusou a credencial administrativa' };

      const base = String(process.env.OIDC_ISSUER);
      const resposta = await fetch(
        `${base}/../../admin/realms/${process.env.KEYCLOAK_REALM ?? 'identificasus'}/users/${coUsuarioIdp}/reset-password`,
        {
          method: 'PUT',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'password', value: novaSenha, temporary: false }),
        },
      );

      if (!resposta.ok) {
        return { trocada: false, motivo: `keycloak respondeu ${resposta.status}` };
      }
      return { trocada: true };
    } catch (erro) {
      const motivo = erro instanceof Error ? erro.message : 'falha desconhecida';
      this.log.error(`keycloak: ${motivo}`);
      return { trocada: false, motivo: `keycloak: ${motivo}` };
    }
  }

  private async tokenAdministrativo(): Promise<string | null> {
    const base = String(process.env.OIDC_ISSUER);
    const corpo = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: String(process.env.KEYCLOAK_ADMIN_CLIENT_ID),
      client_secret: String(process.env.KEYCLOAK_ADMIN_CLIENT_SECRET),
    });

    const r = await fetch(`${base}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: corpo,
    });
    if (!r.ok) return null;

    const dados: unknown = await r.json();
    if (typeof dados === 'object' && dados !== null && 'access_token' in dados) {
      const t = (dados as Record<string, unknown>)['access_token'];
      return typeof t === 'string' ? t : null;
    }
    return null;
  }
}
