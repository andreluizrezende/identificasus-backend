# Pendências

## Trocar duas senhas de produção expostas

**Situação (2026-10-01):** as senhas abaixo foram coladas em texto puro numa
sessão de assistente de código, durante a montagem da produção. Devem ser
tratadas como vazadas. Nenhuma delas está neste repositório.

**Decisão (2026-10-01): a troca fica para depois da entrada do app em
operação.** É um adiamento consciente, e não esquecimento. Até a troca, as duas
senhas continuam válidas: quem as tiver entra direto no `dbsamu` com acesso total
e envia e-mail como `suporte@cicatribio.com.br`. Quanto mais tempo passar, maior
a janela. Vale fazer logo depois que a operação estabilizar, e não esperar a
próxima revisão de segurança.

| Credencial | Onde trocar | Depois de trocar, atualizar |
|---|---|---|
| Senha do `usr_samu` (MySQL `dbsamu` na CloudClusters) | painel da CloudClusters | `DATABASE_URL`, `DATABASE_URL_AUDITORIA`, `DATABASE_URL_PESQUISA` e `DATABASE_URL_ADMINISTRACAO` em Production na Vercel |
| Senha da caixa `suporte@cicatribio.com.br` (SMTP) | painel de e-mail da Hostinger | `SMTP_PASS` em Production na Vercel |

**Ordem para não derrubar a produção:**

1. Trocar a senha no provedor.
2. Atualizar as variáveis na Vercel. A senha do banco vai na URL e precisa ser
   codificada para URL; caracteres como `#`, `%`, `$` e `&` quebram a conexão
   se forem colados crus.
3. Fazer o redeploy da produção: variável nova só vale depois dele.
4. Conferir: o login com um aparelho cadastrado deve responder 401 para uma
   senha errada (e não 500), e "perdi minha senha" deve entregar o e-mail.

Entre os passos 1 e 3, a API fica sem banco ou sem e-mail. Vale fazer fora do
horário de uso.

Os scripts `scripts/*-producao.ps1` pedem a senha do banco na hora, então não
precisam de mudança.

`JWT_SEGREDO` não precisa ser trocado: foi gerado e gravado direto na Vercel,
sem passar pela conversa.

## Produção sem separação por finalidade (ADR-14)

**Situação (2026-10-01):** a base de produção é um MySQL 8.0.26 gerenciado na
CloudClusters (`dbsamu`). O único usuário disponível, `usr_samu`, tem
`ALL PRIVILEGES` em `dbsamu.*`, mas não tem `CREATE USER` nem `GRANT OPTION`.
Por isso `db/02_usuarios_por_finalidade.sql` não foi aplicado, e as quatro
variáveis de produção na Vercel (`DATABASE_URL`, `DATABASE_URL_AUDITORIA`,
`DATABASE_URL_PESQUISA`, `DATABASE_URL_ADMINISTRACAO`) apontam para o mesmo
`usr_samu`.

O que deixa de valer em produção enquanto isso não for resolvido:

- **"Quem é vigiado pela trilha não lê a trilha."** O pool assistencial pode
  ler `mob_auditoria`. Os gatilhos continuam barrando `UPDATE` e `DELETE`, mas
  o `usr_samu` pode removê-los.
- **Pesquisa só nas views.** O pool de pesquisa enxerga as tabelas base.
- **Grants por coluna em `mob_usuario`.** A aplicação pode alterar qualquer
  coluna, inclusive CPF, finalidade e `st_ativo`.

O que continua valendo: o `FinalidadeGuard` (a rota exige a finalidade do
token) e a escolha do pool por finalidade no código.

Aplicado em produção: `db/01`, `03`, `05` e `06`, sem os `CREATE USER`,
`GRANT` e `FLUSH PRIVILEGES`. `db/04_homologacao.sql` não foi aplicado: não há
aparelho cadastrado, então ninguém consegue entrar até alguém cadastrar um em
`mob_dispositivo`.

**Para resolver:** criar `nri_assistencial`, `nri_auditoria`, `nri_pesquisa` e
`nri_administracao` (pelo painel da CloudClusters ou com um usuário que tenha
`CREATE USER` e `GRANT OPTION`), aplicar os grants de `db/02`, `db/05` e
`db/06`, e trocar as variáveis da Vercel para um usuário por finalidade.

## `npm run test:banco` só roda no CI, não nesta máquina

**Situação (atualizada em 2026-10-01):** desde o commit `8b24a40`, o job
`banco` do CI (`.github/workflows/ci.yml`) sobe um MySQL 8.4, aplica os scripts
de `db/` e roda `test:banco` a cada push na `main` e em todo pull request. A
primeira execução passou com os 14 testes (sincronização, recuperação de senha
e cadeia de auditoria). A cobertura existe; o que falta é rodar localmente,
antes do push.

Nesta máquina continua sem rodar (checado em 2026-09-10):

- Docker não está instalado (`docker: command not found`), então o serviço
  `mysql` do `docker-compose.yml` nunca foi de fato subido aqui.
- A porta `3306` já está ocupada por **outro** banco, rodando fora de Docker,
  alheio a este projeto. É um **MariaDB 10.4**, e não MySQL (confirmado em
  2026-10-01). Ele não tem o usuário `nri_migracao` (nem os demais `nri_*`)
  com a senha esperada (`trocar`):

  ```
  Error: Access denied for user 'nri_migracao'@'localhost' (using password: YES)
  ```

Os testes de banco (`test/banco/*.banco.test.ts`) esperam o schema `dbsamu` com
os usuários por finalidade do ADR-14 (`nri_migracao`, `nri_assistencial`,
`nri_auditoria`), provisionados pelos scripts em `db/` — ver `test/banco/apoio.ts`.

**Para retomar, duas opções:**

1. **Instalar Docker** e subir o `mysql` do `docker-compose.yml` do projeto
   (isolado do MySQL que já ocupa a `3306` — ajustar a porta exposta ou parar
   o outro serviço primeiro).
2. **Usar o MariaDB local existente**: aplicar os scripts de `db/` nele e criar
   os usuários `nri_migracao`, `nri_assistencial`, `nri_auditoria` com os
   grants do ADR-14. Cuidado: passar no MariaDB não prova o mesmo que passar no
   MySQL 8 do CI e da produção — os dois já divergiram antes neste projeto
   (`CAST(? AS JSON)`, ver o histórico do git).

Depois de qualquer uma das duas, `npm run test:banco` (ou
`npx vitest run --config vitest.banco.config.ts`) deve passar. Enquanto isso,
o CI é a fonte da verdade para estes testes.
