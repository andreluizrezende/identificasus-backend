# Realm `identificasus`

Importado automaticamente pelo `docker-compose up` em desenvolvimento
(`start-dev --import-realm`). Em produção o realm é criado uma vez pela equipe
de infraestrutura da SMS e este arquivo serve de referência do que ele precisa
conter.

## Por que o app de campo usa concessão direta, e não redirecionamento

O padrão para aplicação web é *authorization code* com PKCE: o navegador vai ao
Keycloak, a pessoa entra lá, e volta com um código. É a escolha certa quando o
Keycloak está a um salto de distância.

O aplicativo de campo não está nessa situação:

- **Ele entra em turno sem rede.** A viatura sai da base e o 4G cai no primeiro
  túnel da Avenida Bonocô. Um fluxo que depende de duas idas ao Keycloak mais
  um retorno ao aplicativo falha em pontos que ninguém consegue depurar às
  três da manhã.
- **A sessão dura 72 horas fora de linha (RF-11.04).** O token precisa estar no
  armazenamento do próprio aplicativo, cifrado junto com a fila local — não numa
  sessão de navegador que o sistema operacional descarta quando a memória
  aperta.
- **A checagem de aparelho é do servidor, não do Keycloak.** `mob_dispositivo`
  diz quais aparelhos podem carregar dado. Se o aplicativo falasse direto com o
  Keycloak, um aparelho não autorizado já teria um token válido na mão antes de
  o backend tomar conhecimento dele. Passando por `POST /api/sessao`, o
  aparelho é verificado **antes** de a senha sequer ser encaminhada.

O que isso custa, dito com todas as letras: concessão direta significa que a
senha trafega pelo backend. É por isso que o backend **não a guarda, não a
registra e não a repassa a mais ninguém** — ele a encaminha ao Keycloak na
mesma requisição e a descarta. O Keycloak continua sendo o único dono de
credencial (ADR-09), e é dele a política de senha e o bloqueio por tentativas,
ambos declarados no realm acima.

O console da Central de Regulação é outra história: roda em mesa, com rede, e
usa *authorization code* com PKCE normalmente.

## Os três clientes

| Cliente | O que é | Quem usa |
|---|---|---|
| `identificasus-api` | Recurso protegido; existe para ser a audiência do token | ninguém faz login nele |
| `identificasus-app` | Cliente público, concessão direta | PWA de campo, via `POST /api/sessao` |
| `identificasus-admin` | Conta de serviço, `manage-users` | `scripts/criar-administrador.ts` e a troca de senha do "perdi minha senha" |

## A claim `purpose`

O guard de finalidade (ADR-14) lê a claim `purpose` do token. Ela vem do
atributo `purpose` do usuário, copiado por um *protocol mapper* declarado no
cliente `identificasus-app`. Usuário sem esse atributo recebe token sem a
claim — e **nenhuma rota o aceita**, porque o guard falha fechado. Isso é
proposital: acesso não declarado não é acesso concedido.

## O segredo neste arquivo

`identificasus-admin` vem com um segredo literal, e ele serve para uma coisa
só: subir o ambiente no seu computador. Em qualquer outro lugar, gere outro e
passe por variável de ambiente. O arquivo está no repositório justamente para
que ninguém precise inventar um segredo "temporário" e esquecê-lo lá.
