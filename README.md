# IdentificaSUS — backend

API do Núcleo de Resolução de Identidade. Recebe a captura vinda do campo,
mantém o caso, a trilha de auditoria e as integrações.

**O sistema sugere; a decisão é humana.** Nenhum caminho de código deste serviço
cria vínculo sem duas conferências independentes.

## Stack

NestJS 10 · TypeScript strict · mysql2 + MySQL 8.4 (`dbsamu`) · Zod · jose (OIDC) · RabbitMQ ·
Keycloak (OIDC) · Vitest · dependency-cruiser

Definida no documento `IdentificaSUS - arquitetura da solucao.md` (v2.0, ADR-13).

## Rodar

```bash
npm install
cp .env.example .env
docker compose up -d mysql keycloak rabbitmq minio
npm run dev                              # http://localhost:3000/api
```

Documentação da API em `http://localhost:3000/api/docs` (só fora de produção).

> **Sem Prisma.** Toda consulta deste serviço é SQL cru — cadeia de hash da
> auditoria, `CALL` de procedure, views por finalidade — e nenhuma usava o
> construtor de consultas. O Prisma virava um binário de engine baixado por
> ambiente para servir de cano de SQL. O acesso passa por `mysql2`, dentro de
> `BancoPorFinalidade`, e a fonte da verdade do esquema são os arquivos em
> `db/`.

| Comando | O que faz |
|---|---|
| `npm run dev` | servidor com recarga |
| `npm run build` | compilação de produção |
| `npm run typecheck` | checagem de tipos |
| `npm run lint` | ESLint |
| `npm run lint:arquitetura` | fronteiras de módulo (dependency-cruiser) |
| `npm test` | testes de unidade |
| `npm run test:banco` | testes contra o MySQL de verdade (precisa do `dbsamu`) |
| `npm run criar-administrador` | cria usuário no Keycloak **e** em `mob_usuario` |

## Ambiente de ponta a ponta, do zero

Cinco passos. Do primeiro ao último, dá para entrar no aplicativo, abrir turno,
registrar um caso e sincronizar.

```bash
# 1. sobe MySQL (que aplica db/*.sql na primeira subida) e Keycloak
#    (que importa keycloak/realm-identificasus.json)
docker compose up -d mysql keycloak

# 2. usuários de banco por finalidade e dados de homologação
npm run db:usuarios
npm run db:homologacao

# 3. o primeiro usuário. Pergunta tudo no terminal — inclusive a senha.
npm run criar-administrador

# 4. a API
npm run dev

# 5. o aplicativo, na outra pasta
cd ../identificasus-app && npm run dev
```

No passo 3, para testar a **captura em campo**, responda `ASSISTENCIAL` na
pergunta da finalidade. Isso não é um detalhe de configuração:

> **Finalidade não é cargo.** `purpose` é a finalidade do tratamento de dados
> (ADR-14, LGPD art. 6º) — diz *para que* aqueles dados podem ser lidos naquela
> sessão, e o token carrega uma só. `ADMINISTRACAO` não abre rota de
> atendimento, de propósito. Quem vai testar a captura precisa de
> `ASSISTENCIAL`, mesmo sendo quem administra o ambiente. O cargo mora em
> `mob_perfil`, que aceita mais de um.

Na tela de entrar, o **código do aparelho** é um dos que `db/04_homologacao.sql`
cadastrou — `APAR-HOM-0001`, por exemplo. `APAR-HOM-9999` existe justamente para
exercitar a recusa.

Para o "perdi minha senha" em desenvolvimento, `CORREIO_DRIVER=console` imprime
o código de 6 dígitos no log do servidor. Esse driver **se recusa a rodar fora de
desenvolvimento**: imprimir código de recuperação em log é vazamento em qualquer
outro lugar.

## Estrutura

```
src/
├── comum/       pipe de validação Zod, filtro de exceção, cadeia de hash
├── acesso/      finalidade, guard de autenticação, verificação de token,
│                pool de banco por propósito
└── modulos/
    ├── sessao/         entrar, sair e a sessão offline de 72 h
    ├── turno/          plantão, guarnição, base, viatura e aparelho
    ├── catalogo/       etapas, atributos e vocabulário do protocolo
    ├── caso/           caso NN
    ├── captura/        gravação versionada de atributo
    ├── sincronizacao/  lote idempotente vindo do aparelho
    ├── recuperacao/    "perdi minha senha"
    └── auditoria/      trilha encadeada (módulo-folha)
db/
├── 01_estrutura.sql               DDL do dbsamu (20 tabelas)
├── 02_usuarios_por_finalidade.sql grants por propósito (ADR-14)
├── 03_recuperacao_de_senha.sql    mob_recuperacao
├── 04_homologacao.sql             base, viatura e aparelho para testar
└── 05_cadeia_de_auditoria.sql     sp_mob_ultimo_elo (ver abaixo)
keycloak/
└── realm-identificasus.json       realm importado no `docker compose up`
test/banco/                        testes contra o MySQL de verdade
```

## Quatro invariantes que o código precisa preservar

**Rota sem finalidade declarada não passa.** O `FinalidadeGuard` é global e falha
fechado: sem `@ExigeFinalidade(...)`, a requisição é negada. Cinco testes cobrem
isso e são bloqueantes em CI — é a compensação pela ausência de row-level
security no MySQL (ADR-14).

**Nenhum módulo abre conexão própria.** Todo acesso passa por
`BancoPorFinalidade`, que escolhe o usuário de banco pelo propósito da
requisição. A regra `modulo-nao-abre-conexao` trava isso no build.

**Quem é vigiado pela trilha não lê a trilha.** `nri_assistencial` tem apenas
`INSERT` em `mob_auditoria`. Como o encadeamento por hash precisa do elo
anterior, esse elo vem de `sp_mob_ultimo_elo` — procedure `SQL SECURITY
DEFINER` que devolve uma linha e mantém o `FOR UPDATE` dentro da transação de
quem chamou. Dar `SELECT` resolveria e destruiria a propriedade; calcular o
hash em SQL criaria uma segunda implementação do mesmo algoritmo, e duas
implementações de um hash divergem em silêncio.

**A trilha de auditoria não se altera.** O encadeamento usa JSON canônico —
chaves ordenadas, sem espaços — porque sem isso a mesma informação gera hashes
diferentes e a cadeia fica inverificável. No banco, dois gatilhos recusam
`UPDATE` e `DELETE`, e o usuário da aplicação só recebe `INSERT`.

**Zod em toda fronteira.** TypeScript apaga tipos em tempo de execução; o
`ZodValidacaoPipe` é o que impede um payload malformado de virar objeto de
domínio.

## Dois defeitos que os testes de banco encontraram

Vale registrar, porque nenhum dos dois aparece em teste de unidade — os dois
eram *grants* faltando, e um deles falhava em silêncio.

1. **A cadeia de auditoria não fechava.** O serviço lia o último elo com um
   `SELECT` em `mob_auditoria`, e `nri_assistencial` só tem `INSERT` ali.
   Resolvido com `sp_mob_ultimo_elo` (`db/05`), sem afrouxar o grant.
2. **A troca de senha não derrubava as sessões.** `st_credenciais_alteradas`
   ficava nula porque faltava `UPDATE` em `mob_usuario` — e a rota respondia
   "senha redefinida" mesmo assim. Resolvido com um grant **por coluna**
   (`db/02`): a aplicação carimba a data e continua sem poder mexer em CPF,
   nome, e-mail ou `st_ativo`.

## Pendências

- Renovação do token (`refresh_token`) ainda não implementada: hoje o acesso
  vale 15 minutos e a sessão offline de 72 h depende de o aplicativo renovar
  quando houver rede.
- Outbox transacional e publicação na RNDS.
- Console da Central de Regulação: comparação, dupla conferência e adjudicação.
- Ponte pericial: propositalmente ausente. A regra
  `ponte-pericial-destacavel` já existe para que o build continue verde sem ela
  (RF-06.02).

## Nota sobre o ESLint

A regra `consistent-type-imports` está desligada de propósito: com
`emitDecoratorMetadata`, a injeção de dependência do Nest precisa do import como
valor. Trocar por `import type` quebra a DI em tempo de execução sem que o
compilador reclame — o pior tipo de erro para deixar passar.
