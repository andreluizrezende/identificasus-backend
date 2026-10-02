# Cria em Production na Vercel a variavel DATABASE_URL_ADJUDICACAO e refaz o
# deploy. Sem ela, toda rota do console da regulacao (finalidade ADJUDICACAO)
# responde 500: o backend escolhe o banco pela finalidade e falha alto quando
# a URL da finalidade nao existe.
#
# Uso (PowerShell, fora do Claude Code):
#   powershell -ExecutionPolicy Bypass -File C:\Pessoal\Desenvolvimento\identificasus-backend\scripts\configurar-adjudicacao-producao.ps1
#
# (!) SO QUEM RODA DIGITA A SENHA DO usr_samu, escondida. A URL e montada aqui,
#     com a senha codificada para URL (um "#" cru truncava a senha; ver
#     PENDENCIAS.md), e vai direto para a Vercel como Secret.
#
# (!) Em producao todas as finalidades usam o usr_samu (ADR-14 pendente): o
#     valor e o mesmo das outras quatro DATABASE_URL*.
#
# (!) Arquivo so com ASCII de proposito: o PowerShell 5.1 le .ps1 sem BOM na
#     pagina de codigo do Windows, e acento viraria lixo.

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

$seguro = Read-Host "Senha do usr_samu (banco de producao)" -AsSecureString
$senha = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro))
$url = "mysql://usr_samu:" + [Uri]::EscapeDataString($senha) +
  "@mysql-133499-0.cloudclusters.net:10042/dbsamu"
Remove-Variable senha

try {
  Write-Host "`nTestando a URL no banco antes de gravar..." -ForegroundColor Cyan
  $env:URL_TESTE = $url
  node -e "require('mysql2/promise').createConnection({uri:process.env.URL_TESTE}).then(async c=>{await c.query('SELECT 1');console.log('Conexao OK');await c.end()}).catch(e=>{console.log('FALHA NA CONEXAO: '+e.code);process.exit(1)})"
  if ($LASTEXITCODE -ne 0) { throw "Senha recusada pelo banco; nada foi gravado na Vercel." }

  Write-Host "`nGravando DATABASE_URL_ADJUDICACAO em Production..." -ForegroundColor Cyan
  npx --yes vercel@62.1.0 env add DATABASE_URL_ADJUDICACAO production --sensitive --force --yes --value $url
  if ($LASTEXITCODE -ne 0) { throw "A Vercel nao aceitou a variavel." }

  Write-Host "`nRefazendo o deploy de producao (variavel nova so vale depois dele)..." -ForegroundColor Cyan
  npx --yes vercel@62.1.0 --prod --yes
  if ($LASTEXITCODE -ne 0) { throw "O deploy falhou; a variavel ja esta gravada, rode so o deploy de novo." }

  Write-Host "`nPronto. Atualize a fila no console da regulacao." -ForegroundColor Green
} catch {
  Write-Host "`n$_" -ForegroundColor Red
} finally {
  Remove-Item Env:URL_TESTE -ErrorAction SilentlyContinue
  Remove-Variable url -ErrorAction SilentlyContinue
  Write-Host "`nPressione Enter para fechar."
  [void](Read-Host)
}
