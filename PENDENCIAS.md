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
| ~~Senha da caixa `suporte@cicatribio.com.br` (SMTP)~~ | **Trocada em 2026-10-01** e conferida em produção (o e-mail de recuperação chegou) | — |

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
`CREATE USER` e `GRANT OPTION`), aplicar os grants de `db/02`, `db/05`,
`db/06` e `db/07`, e trocar as variáveis da Vercel para um usuário por
finalidade.
