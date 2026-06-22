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
$OllamaGenerateUrl = 'http://127.0.0.1:11434/api/generate'
$HealthUrl = 'http://127.0.0.1:8791/api/ai/health'

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

function Test-AiOsApi {
  try {
    $health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 2
    return $health.service -eq 'mini-hub-ai-os-api'
  } catch {
    return $false
  }
}

function Wait-AiOsApi {
  param([int]$TimeoutSeconds = 45)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-AiOsApi) { return $true }
    Start-Sleep -Seconds 2
  }
  return $false
}

function Get-DotEnvValue {
  param(
    [string]$Name,
    [string]$DefaultValue = ''
  )
  $envValue = [System.Environment]::GetEnvironmentVariable($Name)
  if ($envValue) { return $envValue }
  $envPath = Join-Path $ApiDir '.env'
  if (-not (Test-Path $envPath)) {
    $envPath = Join-Path $Root '.env'
  }
  if (-not (Test-Path $envPath)) { return $DefaultValue }
  $line = Get-Content -Path $envPath | Where-Object { $_ -match "^\s*$([regex]::Escape($Name))\s*=" } | Select-Object -First 1
  if (-not $line) { return $DefaultValue }
  $raw = ($line -split '=', 2)[1].Trim()
  if (($raw.StartsWith('"') -and $raw.EndsWith('"')) -or ($raw.StartsWith("'") -and $raw.EndsWith("'"))) {
    return $raw.Substring(1, $raw.Length - 2)
  }
  return $raw
}

function Warm-OllamaModelIfEnabled {
  $enabled = Get-DotEnvValue -Name 'OLLAMA_STARTUP_WARMUP' -DefaultValue 'true'
  if ($enabled -match '^(0|false|no|off)$') {
    Add-Content -Path $OutLog -Value "$(Get-Date -Format o) skipped ollama warmup by OLLAMA_STARTUP_WARMUP=$enabled"
    return
  }
  if (-not (Test-Ollama)) {
    Add-Content -Path $ErrLog -Value "$(Get-Date -Format o) skipped ollama warmup because Ollama is unavailable"
    return
  }
  $model = Get-DotEnvValue -Name 'OLLAMA_CHAT_MODEL' -DefaultValue 'llama3.1:8b'
  $keepAlive = Get-DotEnvValue -Name 'OLLAMA_STARTUP_KEEP_ALIVE' -DefaultValue '30m'
  try {
    $body = @{
      model = $model
      prompt = 'Mini Hub startup warmup. Reply OK.'
      stream = $false
      keep_alive = $keepAlive
      options = @{
        num_predict = 4
        temperature = 0
      }
    } | ConvertTo-Json -Depth 4
    Invoke-RestMethod -Uri $OllamaGenerateUrl -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 120 | Out-Null
    Add-Content -Path $OutLog -Value "$(Get-Date -Format o) warmed ollama model $model with keep_alive=$keepAlive"
  } catch {
    Add-Content -Path $ErrLog -Value "$(Get-Date -Format o) ollama warmup failed: $($_.Exception.Message)"
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
  if (Wait-AiOsApi) {
    Add-Content -Path $OutLog -Value "$(Get-Date -Format o) ai_os health is reachable"
    Warm-OllamaModelIfEnabled
  } else {
    Add-Content -Path $ErrLog -Value "$(Get-Date -Format o) ai_os did not become healthy before warmup timeout"
  }
  $process.WaitForExit()
  $ended = Get-Date -Format o
  Add-Content -Path $ErrLog -Value "$ended ai_os exited with code $($process.ExitCode)"
  if (-not (Test-Path $StopFile)) {
    Start-Sleep -Seconds $RestartDelaySeconds
  }
}
