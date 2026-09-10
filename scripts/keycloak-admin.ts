/**
 * Cliente minimo da API administrativa do Keycloak, para os scripts de
 * operacao. Nao entra no runtime do servidor: o backend so valida token.
 */

export interface Ambiente {
  base: string;      // http://localhost:8080
  realm: string;     // identificasus
  clientId: string;
  clientSecret: string;
}

export function ambiente(): Ambiente {
  const emissor = process.env.OIDC_ISSUER ?? 'http://localhost:8080/realms/identificasus';
  const casado = /^(.*)\/realms\/([^/]+)$/.exec(emissor);
  if (!casado) throw new Error(`OIDC_ISSUER fora do formato esperado: ${emissor}`);
  return {
    base: casado[1] ?? '',
    realm: casado[2] ?? 'identificasus',
    clientId: process.env.KEYCLOAK_ADMIN_CLIENT_ID ?? 'identificasus-admin',
    clientSecret: process.env.KEYCLOAK_ADMIN_CLIENT_SECRET ?? '',
  };
}

export async function tokenAdministrativo(env: Ambiente): Promise<string> {
  const r = await fetch(`${env.base}/realms/${env.realm}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.clientId,
      client_secret: env.clientSecret,
    }),
  });
  if (!r.ok) {
    throw new Error(
      `keycloak recusou a credencial administrativa (${r.status}). ` +
      'Confira KEYCLOAK_ADMIN_CLIENT_SECRET e se o realm foi importado.',
    );
  }
  const dados: unknown = await r.json();
  const token = typeof dados === 'object' && dados !== null && 'access_token' in dados
    ? (dados as Record<string, unknown>)['access_token'] : null;
  if (typeof token !== 'string') throw new Error('keycloak devolveu resposta sem access_token');
  return token;
}

async function api(env: Ambiente, token: string, caminho: string, init?: RequestInit): Promise<Response> {
  return fetch(`${env.base}/admin/realms/${env.realm}${caminho}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...init?.headers,
    },
  });
}

export async function acharPorEmail(
  env: Ambiente, token: string, email: string,
): Promise<{ id: string } | null> {
  const r = await api(env, token, `/users?email=${encodeURIComponent(email)}&exact=true`);
  if (!r.ok) throw new Error(`keycloak respondeu ${r.status} ao buscar usuario`);
  const lista: unknown = await r.json();
  if (Array.isArray(lista) && lista.length > 0) {
    const primeiro: unknown = lista[0];
    if (typeof primeiro === 'object' && primeiro !== null && 'id' in primeiro) {
      const id = (primeiro as Record<string, unknown>)['id'];
      if (typeof id === 'string') return { id };
    }
  }
  return null;
}

/**
 * (!) `lastName` E OBRIGATORIO, e a falta dele nao aparece como erro na
 *     criacao: o usuario nasce, e o login falha depois com "Account is not
 *     fully set up" — mensagem que nao diz qual campo faltou. O perfil de
 *     usuario declarado no realm exige nome e sobrenome, entao o nome completo
 *     e dividido aqui.
 *
 * (!) `purpose` SO E GRAVADO PORQUE O REALM O DECLARA. No Keycloak 26 os
 *     atributos nao declarados no perfil de usuario sao descartados em
 *     silencio — a criacao responde 201 e o atributo simplesmente nao existe.
 *     Sem a declaracao em realm-identificasus.json, o token sairia sem a claim
 *     `purpose` e o guard de finalidade negaria todas as rotas, sem que nada
 *     no caminho tivesse reportado erro.
 */
export async function criarUsuario(
  env: Ambiente, token: string,
  dados: { email: string; nome: string; finalidade: string },
): Promise<string> {
  const partes = dados.nome.trim().split(/\s+/);
  const primeiro = partes[0] ?? dados.nome;
  const sobrenome = partes.length > 1 ? partes.slice(1).join(' ') : primeiro;

  const r = await api(env, token, '/users', {
    method: 'POST',
    body: JSON.stringify({
      username: dados.email,
      email: dados.email,
      firstName: primeiro,
      lastName: sobrenome,
      enabled: true,
      emailVerified: true,
      requiredActions: [],
      // O guard de finalidade le esta claim; o mapper do realm a copia do
      // atributo para o token.
      attributes: { purpose: [dados.finalidade] },
    }),
  });
  if (r.status !== 201) throw new Error(`keycloak respondeu ${r.status} ao criar usuario`);

  const local = r.headers.get('location');
  const id = local?.split('/').pop();
  if (!id) throw new Error('keycloak criou o usuario mas nao devolveu o identificador');
  return id;
}

export async function definirSenha(
  env: Ambiente, token: string, idUsuario: string, senha: string,
): Promise<void> {
  const r = await api(env, token, `/users/${idUsuario}/reset-password`, {
    method: 'PUT',
    body: JSON.stringify({ type: 'password', value: senha, temporary: false }),
  });
  if (!r.ok) throw new Error(`keycloak respondeu ${r.status} ao definir a senha`);
}
