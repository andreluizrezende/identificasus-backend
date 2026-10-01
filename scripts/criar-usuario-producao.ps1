# Cria um usuario no banco de PRODUCAO (CloudClusters) com o criar-administrador.
#
# Uso (PowerShell, fora do Claude Code):
#   powershell -ExecutionPolicy Bypass -File C:\Pessoal\Desenvolvimento\identificasus-backend\scripts\criar-usuario-producao.ps1
#
# (!) A senha do banco e pedida escondida e vive so nesta execucao: nao vai
#     para o .env, nao fica no historico e a variavel e apagada no fim.
#     O .env local continua apontando para o banco local.
#
# (!) Arquivo so com ASCII de proposito: o PowerShell 5.1 le .ps1 sem BOM na
#     pagina de codigo do Windows, e acento viraria lixo.

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

# 1. Conexao com o banco de producao
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

$listar = "require('mysql2/promise').createConnection({uri:process.env.DATABASE_URL_ADMINISTRACAO})" +
  ".then(async c=>{const [r]=await c.query('SELECT id_usuario, no_usuario, ds_email, co_finalidade," +
  " (ds_senha_hash IS NOT NULL) tem_senha FROM mob_usuario');console.table(r);await c.end()})"

try {
  # 2. Testa a conexao antes de perguntar qualquer coisa
  Write-Host "`nTestando conexao com o banco de producao..." -ForegroundColor Cyan
  node -e $testar
  if ($LASTEXITCODE -ne 0) { throw "Conexao com o banco falhou; nada foi gravado." }

  # 3. Cria o usuario (responda 's' no 'Gravar?')
  Write-Host "`nCriando usuario (finalidade ASSISTENCIAL; responda 's' no final)..." -ForegroundColor Cyan
  npm run criar-administrador

  # 4. Confere o que ficou gravado
  Write-Host "`nUsuarios em producao:" -ForegroundColor Cyan
  node -e $listar
} catch {
  Write-Host "`n$_" -ForegroundColor Red
} finally {
  Remove-Item Env:DATABASE_URL_ADMINISTRACAO -ErrorAction SilentlyContinue
  Write-Host "`nPressione Enter para fechar."
  [void](Read-Host)
}
