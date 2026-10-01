# Pede o codigo de recuperacao de senha na API de PRODUCAO.
#
# Uso (PowerShell, fora do Claude Code):
#   powershell -ExecutionPolicy Bypass -File C:\Pessoal\Desenvolvimento\identificasus-backend\scripts\testar-recuperacao-producao.ps1
#
# A resposta e sempre a mesma mensagem neutra (a API nao revela quais
# e-mails existem); o resultado se confere na caixa de entrada.

$api = 'https://identificasus-backend.vercel.app/api/sessao/recuperacao'
$email = Read-Host 'E-mail cadastrado'
$corpo = @{ ds_email = $email } | ConvertTo-Json

try {
  $r = Invoke-RestMethod -Method Post -Uri $api -ContentType 'application/json' -Body $corpo
  Write-Host "`nResposta da API: $($r.mensagem)" -ForegroundColor Green
  Write-Host $r.acao
  Write-Host "`nConfira a caixa de entrada (e o spam) de $email." -ForegroundColor Cyan
} catch {
  $status = $_.Exception.Response.StatusCode.value__
  Write-Host "`nFALHOU - HTTP $status" -ForegroundColor Red
  if ($_.Exception.Response) {
    $leitor = New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())
    Write-Host $leitor.ReadToEnd()
  } else {
    Write-Host $_
  }
} finally {
  Write-Host "`nPressione Enter para fechar."
  [void](Read-Host)
}
