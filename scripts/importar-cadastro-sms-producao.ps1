# Carrega no banco de PRODUCAO o cadastro oficial da SMS (bases, viaturas e
# aparelhos). Regras e formato em cadastro-sms/README.md.
#
# Uso (PowerShell, fora do Claude Code):
#   powershell -ExecutionPolicy Bypass -File scripts\importar-cadastro-sms-producao.ps1 -Pasta C:\pasta\das\planilhas
#   ... -Aplicar                          # grava (mostra o plano e pede confirmacao)
#   ... -Aplicar -AposentarHomologacao    # e desativa os *-HOM-*
#
# Sem -Aplicar, so mostra o plano: nada e gravado.
#
# (!) SO QUEM RODA DIGITA A SENHA DO BANCO, escondida; ela vive so nesta
#     execucao e a variavel e apagada no fim.
#
# (!) Arquivo so com ASCII de proposito: o PowerShell 5.1 le .ps1 sem BOM na
#     pagina de codigo do Windows, e acento viraria lixo.

param(
  [Parameter(Mandatory = $true)][string]$Pasta,
  [switch]$Aplicar,
  [switch]$AposentarHomologacao
)

$ErrorActionPreference = 'Stop'
$Pasta = (Resolve-Path $Pasta).Path
Set-Location (Split-Path -Parent $PSScriptRoot)

$seguro = Read-Host "Senha do usr_samu (banco de producao)" -AsSecureString
$senhaBanco = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro))
$env:DATABASE_URL_ADMINISTRACAO = "mysql://usr_samu:" + [Uri]::EscapeDataString($senhaBanco) +
  "@mysql-133499-0.cloudclusters.net:10042/dbsamu"
Remove-Variable senhaBanco

$argumentos = @('--import', 'tsx', 'scripts/importar-cadastro-sms.ts', $Pasta)
if ($Aplicar) { $argumentos += '--aplicar' }
if ($AposentarHomologacao) { $argumentos += '--aposentar-homologacao' }

try {
  node @argumentos
} finally {
  Remove-Item Env:DATABASE_URL_ADMINISTRACAO -ErrorAction SilentlyContinue
  Write-Host "`nPressione Enter para fechar."
  [void](Read-Host)
}
