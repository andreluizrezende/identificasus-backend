# Aplica um arquivo de db/ no banco de PRODUCAO (CloudClusters).
#
# Uso (PowerShell, fora do Claude Code):
#   powershell -ExecutionPolicy Bypass -File C:\Pessoal\Desenvolvimento\identificasus-backend\scripts\aplicar-migracao-producao.ps1 db\07_historico_de_senhas.sql
#
# (!) RODE ANTES DO PUSH que traz o codigo que usa a migracao. O push dispara
#     o deploy na Vercel; se o codigo novo subir antes da tabela existir, a
#     rota que depende dela quebra em producao.
#
# A senha do banco e pedida escondida e vive so nesta execucao. Os GRANTs do
# arquivo sao pulados: em producao tudo roda como usr_samu (PENDENCIAS.md).

param([Parameter(Mandatory = $true)][string]$Arquivo)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path $Arquivo)) { Write-Host "Arquivo nao encontrado: $Arquivo" -ForegroundColor Red; exit 1 }

$seguro = Read-Host "Senha do usr_samu (banco de producao)" -AsSecureString
$senhaBanco = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro))
$env:DB_PROD = "mysql://usr_samu:" + [Uri]::EscapeDataString($senhaBanco) +
  "@mysql-133499-0.cloudclusters.net:10042/dbsamu"
Remove-Variable senhaBanco

try {
  node (Join-Path $PSScriptRoot 'aplicar-migracao.cjs') $Arquivo
} finally {
  Remove-Item Env:DB_PROD -ErrorAction SilentlyContinue
  Write-Host "`nPressione Enter para fechar."
  [void](Read-Host)
}
