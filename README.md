# IdentificaSUS — backend

[![CI](https://github.com/andreluizrezende/identificasus-backend/actions/workflows/ci.yml/badge.svg)](https://github.com/andreluizrezende/identificasus-backend/actions/workflows/ci.yml)

API do Núcleo de Resolução de Identidade. Recebe a captura vinda do campo,
mantém o caso, a trilha de auditoria e as integrações.

**O sistema sugere; a decisão é humana.** Nenhum caminho de código deste serviço
cria vínculo sem duas conferências independentes.

## Stack

NestJS 10 · TypeScript strict · mysql2 + MySQL 8.4 (`dbsamu`) · Zod · jose (JWT) · RabbitMQ ·
Vitest · dependency-cruiser

Definida no documento `IdentificaSUS - arquitetura da solucao.md` (v2.0, ADR-13).

## Rodar

```bash
npm install
cp .env.example .env                     # preencha JWT_SEGREDO (comando no próprio arquivo)
docker compose up -d mysql rabbitmq minio
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
| `npm run test:banco` | testes contra o MySQL de verdade (precisa do `dbsamu`; roda no CI) |
| `npm run criar-administrador` | cria usuário em `mob_usuario`, com finalidade e senha |
| `npm run semear-ambiente-local` | usuário de teste com senha conhecida (só desenvolvimento) |

## CI

`.github/workflows/ci.yml` roda a cada push na `main` e em todo pull request,
num runner `ubuntu-24.04` com o Node do `.nvmrc`. São dois jobs:

| Job | O que roda |
|---|---|
| `build-test` | typecheck, lint, lint de arquitetura, testes de unidade e build |
| `banco` | sobe um MySQL 8.4 como serviço, aplica os scripts de `db/` e roda `npm run test:banco` |

O job `banco` é o que prova que os grants do ADR-14 bastam: os serviços rodam
como `nri_assistencial`, e uma tabela esquecida num `GRANT` aparece como falha
de teste. Ele usa a mesma versão de MySQL do `docker-compose.yml`, e não o
MariaDB que às vezes ocupa a porta 3306 em máquina de desenvolvimento. Os dois
já divergiram neste projeto (ver `PENDENCIAS.md`).

A ordem dos scripts de `db/` no job está comentada no workflow. O `02` roda duas
vezes, porque ele dá grant em objetos criados no `03` e no `05`, enquanto o
`05` e o `06` dão grant a usuários criados no `02`. A última passada, sem
`--force`, tem de aplicar todos os grants.

O runner fica fixo em `ubuntu-24.04`, e não em `ubuntu-latest`, de propósito:
trocar a versão do sistema é um commit, com o CI mostrando o que quebra.

## Ambiente de ponta a ponta, do zero

Cinco passos. Do primeiro ao último, dá para entrar no aplicativo, abrir turno,
registrar um caso e sincronizar.

```bash
# 1. sobe o MySQL, que aplica db/*.sql na primeira subida
docker compose up -d mysql

# 2. usuários de banco por finalidade, credencial local e dados de homologação
npm run db:usuarios
npm run db:credencial      # só em banco criado antes de db/06 existir
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
> sessão, e o token carrega uma só. Ela mora em `mob_usuario.co_finalidade`. `ADMINISTRACAO` não abre rota de
> atendimento, de propósito. Quem vai testar a captura precisa de
> `ASSISTENCIAL`, mesmo sendo quem administra o ambiente. O cargo mora em
> `mob_perfil`, que aceita mais de um.

Na tela de entrar, o **código do aparelho** é um dos que `db/04_homologacao.sql`
cadastrou — `APAR-HOM-0001`, por exemplo. `APAR-HOM-9999` existe justamente para
exercitar a recusa.

## Autenticação

A API autentica sozinha, sem provedor de identidade externo. O Keycloak saiu da
arquitetura em `db/06_credencial_local.sql`.

- **Senha:** hash scrypt em `mob_usuario.ds_senha_hash` (`src/acesso/senha.ts`),
  com política de no mínimo 10 caracteres e diferente do e-mail. Continua
  existindo **um** lugar só que guarda credencial.
- **Token:** JWT HS256 emitido e conferido pela própria API
  (`src/acesso/token.service.ts`), assinado com `JWT_SEGREDO`. O de acesso vale
  15 minutos; o de renovação, 72 h, e não abre rota (`typ` diferente).
- **Renovação:** `POST /api/sessao/renovacao` troca o token de renovação por um
  token de acesso novo, sem senha. A cada renovação o banco é conferido de
  novo: sessão encerrada pelo "sair", fim das 72 h, conta desativada ou senha
  trocada depois do login dão o mesmo 401 ("Sua sessão foi encerrada"). A
  finalidade vem do banco, então uma mudança vale na próxima renovação.
- **Freio de tentativas:** a partir da 5ª senha errada seguida, a conta espera
  60 s a mais por erro, até 15 minutos. Conta inexistente, inativa, bloqueada e
  senha errada dão o mesmo 401, no mesmo tempo.
- **Troca de senha** (recuperação ou `criar-administrador`) carimba
  `st_credenciais_alteradas`, o que derruba os tokens emitidos antes.

Contas que existiam antes da migração ficam sem senha. Para entrar, a pessoa usa
o "perdi minha senha" ou alguém roda `npm run criar-administrador` com o mesmo
CPF.

Para o "perdi minha senha" em desenvolvimento, `CORREIO_DRIVER=console` imprime
o código de 6 dígitos no log do servidor. Esse driver **se recusa a rodar fora de
desenvolvimento**: imprimir código de recuperação em log é vazamento em qualquer
outro lugar.

## Estrutura

```
src/
├── comum/       pipe de validação Zod, filtro de exceção, cadeia de hash
├── acesso/      finalidade, guard de autenticação, emissão e verificação de
│                token, hash de senha, pool de banco por propósito
└── modulos/
    ├── sessao/         entrar, sair e a sessão offline de 72 h
    ├── turno/          plantão, guarnição, base, viatura e aparelho
    ├── catalogo/       etapas, atributos e vocabulário do protocolo
    ├── caso/           caso NN
    ├── captura/        gravação versionada de atributo
    ├── sincronizacao/  lote idempotente vindo do aparelho
    ├── midia/          token de upload direto pro Vercel Blob (identificasus-fotos)
    ├── recuperacao/    "perdi minha senha"
    └── auditoria/      trilha encadeada (módulo-folha)
db/
├── 01_estrutura.sql               DDL do dbsamu (20 tabelas)
├── 02_usuarios_por_finalidade.sql grants por propósito (ADR-14)
├── 03_recuperacao_de_senha.sql    mob_recuperacao
├── 04_homologacao.sql             base, viatura e aparelho para testar
├── 05_cadeia_de_auditoria.sql     sp_mob_ultimo_elo (ver abaixo)
└── 06_credencial_local.sql        senha, finalidade e freio em mob_usuario
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

- Histórico de senhas (o realm do Keycloak recusava as 3 últimas) não foi
  reimplementado.
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
