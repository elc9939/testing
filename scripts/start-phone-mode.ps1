param(
  [string]$RemoteHost = '',
  [string]$ExtraTrustedOrigins = ''
)

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$StackScript = Join-Path $PSScriptRoot 'stack-lan.ps1'

Write-Output "Mini Hub Phone Mode"
Write-Output "Starting the local API, AI OS, Macro Lab, and hub for this Wi-Fi network."
Write-Output "Keep this window open while you use the phone UI."
Write-Output ""

Push-Location $Root
try {
  $stackArgs = @()
  if ($RemoteHost) { $stackArgs += @('-RemoteHost', $RemoteHost) }
  if ($ExtraTrustedOrigins) { $stackArgs += @('-ExtraTrustedOrigins', $ExtraTrustedOrigins) }
  & powershell -NoLogo -ExecutionPolicy Bypass -File $StackScript @stackArgs
  if ($LASTEXITCODE -ne 0) { throw 'Mini Hub Phone Mode failed to start.' }
} finally {
  Pop-Location
}
