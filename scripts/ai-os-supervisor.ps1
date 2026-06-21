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
$OllamaUrl = 'http://127.0.0.1:11434/api/tags'

if (-not (Test-Path $Python)) {
  throw "Missing AI OS venv Python at $Python"
}

if (Test-Path $StopFile) {
  Remove-Item -LiteralPath $StopFile -Force
}

function Test-Ollama {
  try {
    Invoke-RestMethod -Uri $OllamaUrl -TimeoutSec 2 | Out-Null
    return $true
  } catch {
    return $false
  }
}

function Start-OllamaIfAvailable {
  if (Test-Ollama) { return }
  $ollama = Get-Command ollama -ErrorAction SilentlyContinue
  if (-not $ollama) {
    Add-Content -Path $ErrLog -Value "$(Get-Date -Format o) ollama command not found; AI OS will still start"
    return
  }
  try {
    Start-Process -FilePath $ollama.Source -ArgumentList 'serve' -WindowStyle Hidden | Out-Null
    Start-Sleep -Seconds 2
    if (Test-Ollama) {
      Add-Content -Path $OutLog -Value "$(Get-Date -Format o) started ollama serve"
    } else {
      Add-Content -Path $ErrLog -Value "$(Get-Date -Format o) attempted ollama serve but API is still unavailable"
    }
  } catch {
    Add-Content -Path $ErrLog -Value "$(Get-Date -Format o) failed to start ollama: $($_.Exception.Message)"
  }
}

while (-not (Test-Path $StopFile)) {
  Start-OllamaIfAvailable
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
