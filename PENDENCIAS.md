# Pendências

## Na entrada em operação

Duas coisas foram deixadas, por decisão, para quando o app entrar em operação.
Não são esquecimento: fazem parte da virada para a operação.

1. **Trocar a senha do `usr_samu`.** Passo a passo na seção abaixo.
2. **Trocar o remetente dos e-mails para um domínio do IdentificaSUS ou da
   SMS.** Hoje o "perdi minha senha" sai como `suporte@cicatribio.com.br`,
   caixa de outro projeto. Para trocar:
   - criar a caixa no domínio novo;
   - atualizar `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`,
     `SMTP_PASS` e `SMTP_FROM` em Production na Vercel;
   - configurar SPF e DKIM no DNS do domínio, ou os e-mails caem no spam;
   - refazer o deploy e testar com `scripts/testar-recuperacao-producao.ps1`:
     o código precisa chegar na caixa de entrada.

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
   se forem colados crus. **Não monte a URL à mão.** Gere com o PowerShell,
   que codifica a senha sozinho e copia o resultado:

   ```powershell
   $s = Read-Host "Senha nova do usr_samu" -AsSecureString
   $p = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
   $url = "mysql://usr_samu:" + [Uri]::EscapeDataString($p) + "@mysql-133499-0.cloudclusters.net:10042/dbsamu"
   Remove-Variable p
   if ($url -match '\s|"') { "URL com espaco ou aspas" } else { Set-Clipboard -Value $url; "URL copiada" }
   ```

   O mesmo valor vai nas quatro: `DATABASE_URL`, `DATABASE_URL_AUDITORIA`,
   `DATABASE_URL_PESQUISA` e `DATABASE_URL_ADMINISTRACAO`.
3. Fazer o redeploy da produção: variável nova só vale depois dele.
4. Conferir: o login com um aparelho cadastrado deve responder 401 para uma
   senha errada (e não 500), e "perdi minha senha" deve entregar o e-mail.

Entre os passos 1 e 3, a API fica sem banco ou sem e-mail. Vale fazer fora do
horário de uso.

**O que aconteceu na primeira tentativa (2026-10-01):** a senha do banco foi
trocada e as variáveis atualizadas, mas a produção ficou fora do ar (500 em
toda rota que usa o banco). A causa mais provável foi a URL montada à mão, com
`#` sem virar `%23`: na URL, `#` encerra o endereço, e o driver lê uma senha
truncada. A senha foi revertida para a anterior e a produção voltou. Por isso o
passo 2 manda gerar a URL pelo comando, e não à mão. Desde então, erro
inesperado no login vai para o log da Vercel com o código do driver (por
exemplo `ER_ACCESS_DENIED_ERROR`), o que mostra a causa na hora.

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

Aplicado em produção: `db/01`, `03`, `04`, `05`, `06`, `07`, `08`, `09` e `10`
(`04`, `08`, `09` e `10` em 2026-10-02), sem os `CREATE USER`, `GRANT` e
`FLUSH PRIVILEGES`.

**Bases e aparelhos de produção são os de homologação (`db/04`), fictícios.**
Servem para testar (`APAR-HOM-0001` no tablet, `APAR-HOM-0005` na estação da
regulação; `APAR-HOM-9999` é revogado de propósito). Quando a SMS mandar a
lista oficial de bases e aparelhos, cadastrar os reais e desativar os
`*-HOM-*` (`st_ativo = 'I'`; não apagar: a trilha referencia aparelho). As
contas de teste se criam com `scripts/criar-contas-de-teste-producao.ps1`.

**Verificação noturna da trilha:** criar a variável `CRON_SECRET` em Production
na Vercel (comando para gerar em `.env.example`). Sem ela, o agendamento de
`vercel.json` chama `/api/auditoria/verificacao` e recebe 503. O resultado sai
no log da função: "trilha integra" ou "TRILHA QUEBRADA no id_auditoria N".

**Para resolver:** criar `nri_assistencial`, `nri_auditoria`, `nri_pesquisa`,
`nri_administracao` e `nri_adjudicacao` (pelo painel da CloudClusters ou com
um usuário que tenha `CREATE USER` e `GRANT OPTION`), aplicar os grants de `db/02`, `db/05`,
`db/06`, `db/07` e `db/08`, e trocar as variáveis da Vercel para um usuário por
finalidade.
