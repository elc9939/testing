param(
  [int]$RestartDelaySeconds = 5
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$ApiDir = Join-Path $Root 'apps\ai-os-api'
$Python = Join-Path $ApiDir '.venv\Scripts\python.exe'
$StopFile = Join-Path $ApiDir '.ai-os-supervisor.stop'
$OutLog = Join-Path $ApiDir 'supervisor.out.log'
$ErrLog = Join-Path $ApiDir 'supervisor.err.log'

if (-not (Test-Path $Python)) {
  throw "Missing AI OS venv Python at $Python"
}

if (Test-Path $StopFile) {
  Remove-Item -LiteralPath $StopFile -Force
}

while (-not (Test-Path $StopFile)) {
  $started = Get-Date -Format o
  Add-Content -Path $OutLog -Value "$started starting ai_os"
  $process = Start-Process -FilePath $Python `
    -ArgumentList '-m', 'ai_os' `
    -WorkingDirectory $ApiDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $ApiDir 'dev-server.out.log') `
    -RedirectStandardError (Join-Path $ApiDir 'dev-server.err.log') `
    -PassThru
  $process.WaitForExit()
  $ended = Get-Date -Format o
  Add-Content -Path $ErrLog -Value "$ended ai_os exited with code $($process.ExitCode)"
  if (-not (Test-Path $StopFile)) {
    Start-Sleep -Seconds $RestartDelaySeconds
  }
}
