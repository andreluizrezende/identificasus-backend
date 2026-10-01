# Mostra, no banco de PRODUCAO, o que aconteceu com os pedidos de recuperacao.
#
# Uso (PowerShell, fora do Claude Code):
#   powershell -ExecutionPolicy Bypass -File C:\Pessoal\Desenvolvimento\identificasus-backend\scripts\diagnosticar-recuperacao-producao.ps1
#
# So le; nao grava nada. Nao mostra codigo nem hash: so datas e contagens.
# As consultas ficam em diagnosticar-recuperacao.cjs.

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

$seguro = Read-Host "Senha do usr_samu (banco de producao)" -AsSecureString
$senhaBanco = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro))
$env:DB_PROD = "mysql://usr_samu:" + [Uri]::EscapeDataString($senhaBanco) +
  "@mysql-133499-0.cloudclusters.net:10042/dbsamu"
Remove-Variable senhaBanco

try {
  node (Join-Path $PSScriptRoot 'diagnosticar-recuperacao.cjs')
} catch {
  Write-Host "`n$_" -ForegroundColor Red
} finally {
  Remove-Item Env:DB_PROD -ErrorAction SilentlyContinue
  Write-Host "`nPressione Enter para fechar."
  [void](Read-Host)
}
