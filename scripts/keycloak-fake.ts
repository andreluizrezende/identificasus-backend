/**
 * Keycloak falso, só para rodar o backend localmente sem Docker.
 *
 * Uso:  npm run keycloak-fake   (deixa rodando, junto com `npm run dev`)
 *
 * (!) MESMA INFRA DO identificasus-app. O módulo mobile já resolveu "montar
 *     Keycloak + MySQL localmente é um passo grande só para navegar pelas
 *     telas" com um servidor fake em `ferramentas/mock-api.ts`, registrado só
 *     em `vite --mode mock`. Este arquivo é a mesma resposta do lado do
 *     backend — mesma motivação, mesma promessa de nunca entrar em produção —
 *     só que como processo HTTP próprio, porque o backend não roda sob Vite.
 *
 * (!) A ASSINATURA É RS256 DE VERDADE, e não um atalho. `token.service.ts`
 *     verifica a assinatura contra o JWKS do emissor — usar um segredo
 *     symmetrico ou pular a verificação exigiria mexer no código de produção
 *     só para testar localmente, e é exatamente esse tipo de atalho que faz
 *     um teste parar de significar alguma coisa.
 *
 * (!) ESTADO EM MEMÓRIA, PERDIDO AO REINICIAR — mesma escolha do mock do
 *     frontend. O usuário de teste é semeado de novo a cada subida, sempre
 *     com o mesmo `sub`, para casar com o `co_usuario_idp` que
 *     `scripts/semear-ambiente-local.ts` grava no dbsamu.
 */
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { KeyLike } from 'jose';
import { USUARIO_DE_TESTE } from './dev-fixture';

const PORTA = Number(process.env.KEYCLOAK_FAKE_PORTA ?? 8080);
const REALM = process.env.KEYCLOAK_REALM ?? 'identificasus';
const EMISSOR = `http://localhost:${PORTA}/realms/${REALM}`;
const AUDIENCIA = process.env.OIDC_AUDIENCE ?? 'identificasus-api';
const KID = 'fake-1';

interface UsuarioFake {
  id: string;
  email: string;
  nome: string;
  senha: string | null;
  purpose: string;
}

const usuarios = new Map<string, UsuarioFake>();
usuarios.set(USUARIO_DE_TESTE.sub, {
  id: USUARIO_DE_TESTE.sub,
  email: USUARIO_DE_TESTE.email,
  nome: USUARIO_DE_TESTE.nome,
  senha: USUARIO_DE_TESTE.senha,
  purpose: USUARIO_DE_TESTE.purpose,
});

async function principal(): Promise<void> {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const jwk = await exportJWK(publicKey);
  jwk.kid = KID;
  jwk.alg = 'RS256';
  jwk.use = 'sig';

  const servidor = createServer((req, res) => {
    void tratar(req, res, privateKey).catch((erro: unknown) => {
      json(res, 500, { mensagem: erro instanceof Error ? erro.message : 'erro no keycloak fake' });
    });
  });

  async function tratar(req: IncomingMessage, res: ServerResponse, chavePrivada: KeyLike): Promise<void> {
    const url = new URL(req.url ?? '/', `http://localhost:${PORTA}`);
    const caminho = url.pathname;
    const base = `/realms/${REALM}`;
    const baseAdmin = `/admin/realms/${REALM}`;

    if (caminho === `${base}/protocol/openid-connect/certs` && req.method === 'GET') {
      json(res, 200, { keys: [jwk] });
      return;
    }

    if (caminho === `${base}/protocol/openid-connect/token` && req.method === 'POST') {
      const corpo = new URLSearchParams(await lerTexto(req));
      const grant = corpo.get('grant_type');

      if (grant === 'password') {
        const email = corpo.get('username') ?? '';
        const senha = corpo.get('password') ?? '';
        const usuario = [...usuarios.values()].find((u) => u.email === email);
        if (!usuario || usuario.senha === null || usuario.senha !== senha) {
          json(res, 401, { error: 'invalid_grant', error_description: 'Invalid user credentials' });
          return;
        }
        const access_token = await new SignJWT({ email: usuario.email, purpose: usuario.purpose })
          .setProtectedHeader({ alg: 'RS256', kid: KID })
          .setSubject(usuario.id)
          .setIssuedAt()
          .setIssuer(EMISSOR)
          .setAudience(AUDIENCIA)
          .setExpirationTime('15m')
          .sign(chavePrivada);
        json(res, 200, {
          access_token, refresh_token: `fake-refresh-${randomUUID()}`,
          expires_in: 900, token_type: 'Bearer',
        });
        return;
      }

      if (grant === 'client_credentials') {
        // (!) SEM CONFERIR O SEGREDO. E' uso local, de uma pessoa so, contra um
        //     servidor que so escuta em localhost — a conferencia de verdade
        //     mora no Keycloak real, que este arquivo existe para nao precisar
        //     subir. Ver `scripts/keycloak-admin.ts`, que consome este token.
        json(res, 200, { access_token: `admin-fake-${randomUUID()}`, expires_in: 300, token_type: 'Bearer' });
        return;
      }

      json(res, 400, { error: 'unsupported_grant_type' });
      return;
    }

    if (caminho === `${baseAdmin}/users` && req.method === 'POST') {
      const corpo = JSON.parse(await lerTexto(req)) as Record<string, unknown>;
      const id = randomUUID();
      const purposes = corpo['attributes'] as Record<string, unknown[]> | undefined;
      usuarios.set(id, {
        id,
        email: texto(corpo, 'email') ?? texto(corpo, 'username') ?? '',
        nome: [texto(corpo, 'firstName'), texto(corpo, 'lastName')].filter(Boolean).join(' '),
        senha: null,
        purpose: (purposes?.['purpose']?.[0] as string | undefined) ?? 'ASSISTENCIAL',
      });
      res.statusCode = 201;
      res.setHeader('location', `${baseAdmin}/users/${id}`);
      res.end();
      return;
    }

    if (caminho === `${baseAdmin}/users` && req.method === 'GET') {
      const email = url.searchParams.get('email') ?? '';
      const achado = [...usuarios.values()].find((u) => u.email === email);
      json(res, 200, achado ? [{ id: achado.id }] : []);
      return;
    }

    const reset = /^\/admin\/realms\/[^/]+\/users\/([^/]+)\/reset-password$/.exec(caminho);
    if (reset && req.method === 'PUT') {
      const usuario = usuarios.get(reset[1] ?? '');
      if (!usuario) {
        json(res, 404, { error: 'user not found' });
        return;
      }
      const corpo = JSON.parse(await lerTexto(req)) as Record<string, unknown>;
      usuario.senha = texto(corpo, 'value');
      res.statusCode = 204;
      res.end();
      return;
    }

    json(res, 404, { mensagem: `rota nao implementada no keycloak fake: ${req.method ?? ''} ${caminho}` });
  }

  servidor.listen(PORTA, () => {
    console.log(`Keycloak falso em http://localhost:${PORTA} (realm ${REALM})`);
    console.log('Credencial de teste, ja semeada:');
    console.log(`  e-mail: ${USUARIO_DE_TESTE.email}`);
    console.log(`  senha:  ${USUARIO_DE_TESTE.senha}`);
    console.log('Rode "npm run semear-ambiente-local" para gravar esta pessoa no dbsamu.');
  });
}

function texto(corpo: Record<string, unknown>, chave: string): string | null {
  const v = corpo[chave];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function lerTexto(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let bruto = '';
    req.on('data', (pedaco: Buffer) => { bruto += pedaco.toString('utf8'); });
    req.on('end', () => resolve(bruto));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, corpo: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(corpo));
}

void principal();
