# Cria no banco de PRODUCAO as duas contas de teste (campo e regulacao), com
# nome, e-mail e CPF ficticios gerados na hora.
#
# Uso (PowerShell, fora do Claude Code):
#   powershell -ExecutionPolicy Bypass -File C:\Pessoal\Desenvolvimento\identificasus-backend\scripts\criar-contas-de-teste-producao.ps1
#
# (!) SO QUEM RODA DIGITA AS SENHAS: a do banco e a de cada conta, escondidas.
#     Nenhuma vai para arquivo ou historico; a do banco vive so nesta execucao
#     e a variavel e apagada no fim. Ver scripts/criar-contas-de-teste.ts.
#
# (!) Arquivo so com ASCII de proposito: o PowerShell 5.1 le .ps1 sem BOM na
#     pagina de codigo do Windows, e acento viraria lixo.

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

$seguro = Read-Host "Senha do usr_samu (banco de producao)" -AsSecureString
$senhaBanco = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro))
$env:DATABASE_URL_ADMINISTRACAO = "mysql://usr_samu:" + [Uri]::EscapeDataString($senhaBanco) +
  "@mysql-133499-0.cloudclusters.net:10042/dbsamu"
Remove-Variable senhaBanco

$testar = "require('mysql2/promise').createConnection({uri:process.env.DATABASE_URL_ADMINISTRACAO})" +
  ".then(async c=>{const [[r]]=await c.query('SELECT COUNT(*) n FROM mob_usuario');" +
  "console.log('Conexao OK - usuarios ja cadastrados: '+r.n);await c.end()})" +
  ".catch(e=>{console.log('FALHA NA CONEXAO: '+e.code+' - '+e.message);process.exit(1)})"

try {
  Write-Host "`nTestando conexao com o banco de producao..." -ForegroundColor Cyan
  node -e $testar
  if ($LASTEXITCODE -ne 0) { throw "Conexao com o banco falhou; nada foi gravado." }

  Write-Host "`nCriando as contas de teste (voce digita a senha de cada uma)..." -ForegroundColor Cyan
  node --import tsx scripts/criar-contas-de-teste.ts
  if ($LASTEXITCODE -ne 0) { throw "As contas nao foram criadas." }
} catch {
  Write-Host "`n$_" -ForegroundColor Red
} finally {
  Remove-Item Env:DATABASE_URL_ADMINISTRACAO -ErrorAction SilentlyContinue
  Write-Host "`nPressione Enter para fechar."
  [void](Read-Host)
}
