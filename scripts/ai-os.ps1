param(
  [ValidateSet('start', 'stop', 'restart', 'status', 'health', 'backup', 'verify', 'restore-test', 'integrity', 'cleanup')]
  [string]$Action = 'status',
  [string]$BackupId = '',
  [switch]$Lan,
  [string]$RemoteHost = '',
  [string]$ExtraTrustedOrigins = ''
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'script-utils.ps1')
Import-ProjectDotEnv $Root
$ApiDir = Join-Path $Root 'apps\ai-os-api'
$Python = Join-Path $ApiDir '.venv\Scripts\python.exe'
$PidFile = Join-Path $ApiDir '.ai-os.pid'
$SupervisorStopFile = Join-Path $ApiDir '.ai-os-supervisor.stop'
$OutLog = Join-Path $ApiDir 'dev-server.out.log'
$ErrLog = Join-Path $ApiDir 'dev-server.err.log'
$HealthUrl = 'http://127.0.0.1:8791/api/ai/health'
$ServiceName = 'mini-hub-ai-os-api'
$OllamaUrl = 'http://127.0.0.1:11434/api/tags'

function Get-LanIPv4 {
  $address = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
      $_.IPAddress -notlike '127.*' -and
      $_.IPAddress -notlike '169.254.*' -and
      $_.PrefixOrigin -ne 'WellKnown'
    } |
    Select-Object -First 1 -ExpandProperty IPAddress
  if ($address) { return $address }
  return 'YOUR-DESKTOP-IP'
}

function Get-AiOsPids {
  $pids = New-Object System.Collections.Generic.List[int]
  Get-NetTCPConnection -LocalPort 8791 -ErrorAction SilentlyContinue |
    Where-Object { $_.State -eq 'Listen' } |
    ForEach-Object {
      if ($_.OwningProcess -and -not $pids.Contains([int]$_.OwningProcess)) {
        $pids.Add([int]$_.OwningProcess)
      }
    }
  if (Test-Path $PidFile) {
    $pidText = (Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($pidText -match '^\d+$') {
      $process = Get-Process -Id ([int]$pidText) -ErrorAction SilentlyContinue
      if ($process -and -not $pids.Contains([int]$process.Id)) { $pids.Add([int]$process.Id) }
    }
  }
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match '(?i)(^| )-m ai_os( |$)' } |
    ForEach-Object {
      if (-not $pids.Contains([int]$_.ProcessId)) { $pids.Add([int]$_.ProcessId) }
    }
  return $pids
}

function Get-AiOsPid {
  return Get-AiOsPids | Select-Object -First 1
}

function Get-AiOsSupervisorPids {
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'ai-os-supervisor\.ps1' } |
    ForEach-Object { [int]$_.ProcessId }
}

function Test-AiOsApi {
  try {
    $health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 3
    return $health.service -eq $ServiceName
  } catch {
    return $false
  }
}

function Assert-Python {
  if (-not (Test-Path $Python)) {
    throw "Missing AI OS venv Python at $Python. Create it with: cd apps\ai-os-api; python -m venv .venv; .venv\Scripts\python -m pip install -r requirements.txt"
  }
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
  if (Test-Ollama) {
    if ($Lan) {
      Write-Output 'Ollama is reachable locally. If direct phone Ollama checks fail, restart Ollama with OLLAMA_HOST=0.0.0.0:11434 and matching OLLAMA_ORIGINS; AI OS can still use local Ollama.'
    }
    return
  }
  $ollama = Get-Command ollama -ErrorAction SilentlyContinue
  if (-not $ollama) {
    Write-Output 'Ollama is not reachable and the ollama command was not found. AI OS will start, but the local model provider will show offline.'
    return
  }
  if ($Lan) {
    $env:OLLAMA_HOST = '0.0.0.0:11434'
    $env:OLLAMA_ORIGINS = Get-MiniHubTrustedOrigins @(Get-MiniHubPrivateHosts $RemoteHost) $ExtraTrustedOrigins
  }
  Start-Process -FilePath $ollama.Source -ArgumentList 'serve' -WindowStyle Hidden | Out-Null
  Start-Sleep -Seconds 2
  if (Test-Ollama) {
    Write-Output 'Ollama started.'
  } else {
    Write-Output 'Tried to start Ollama, but http://127.0.0.1:11434 is still unavailable.'
  }
}

function Start-AiOs {
  Assert-Python
  Start-OllamaIfAvailable
  $aiOsPid = Get-AiOsPid
  if ($aiOsPid) {
    if (Test-AiOsApi) {
      if (-not $Lan) {
        Write-Output "AI OS already running as PID $aiOsPid"
        return
      }
      Write-Output "Restarting AI OS in LAN mode from PID $aiOsPid"
      Stop-AiOs | Out-Null
    } elseif ($Lan) {
      Write-Output "Stopping stale AI OS process before LAN restart (PID $aiOsPid)"
      Stop-AiOs | Out-Null
    } else {
      throw "Port 8791 is already in use by PID $aiOsPid, but it does not answer as $ServiceName. Stop that process or change AI_OS_PORT."
    }
  }
  if ($Lan) {
    $hosts = @(Get-MiniHubPrivateHosts $RemoteHost)
    $lanIp = Get-MiniHubBridgeHost 'lan' $RemoteHost
    $env:AI_OS_HOST = '0.0.0.0'
    $env:AI_OS_PORT = '8791'
    $env:AI_OS_REQUIRE_LOOPBACK = 'false'
    $env:AI_OS_TRUSTED_ORIGINS = Get-MiniHubTrustedOriginsJson $hosts $ExtraTrustedOrigins
    Write-Output "AI OS LAN mode: use http://${lanIp}:8791 from your phone."
  }
  Remove-Item Env:PORT -ErrorAction SilentlyContinue
  $process = Start-Process -FilePath $Python `
    -ArgumentList '-m', 'ai_os' `
    -WorkingDirectory $ApiDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $OutLog `
    -RedirectStandardError $ErrLog `
    -PassThru
  Set-Content -Path $PidFile -Value $process.Id
  Start-Sleep -Seconds 2
  if (-not (Test-AiOsApi)) {
    if (Test-Path $ErrLog) {
      $tail = (Get-Content -Tail 20 $ErrLog) -join "`n"
      throw "AI OS failed to become healthy after start. Recent error log:`n$tail"
    }
    throw "AI OS failed to become healthy after start."
  }
  Write-Output "AI OS started as PID $($process.Id)"
}

function Stop-AiOs {
  $supervisorPids = @(Get-AiOsSupervisorPids)
  if ($supervisorPids.Count) {
    Set-Content -LiteralPath $SupervisorStopFile -Value (Get-Date -Format o) -Encoding ASCII
    foreach ($supervisorPid in $supervisorPids) {
      Stop-Process -Id $supervisorPid -Force -ErrorAction SilentlyContinue
    }
    Write-Output "AI OS supervisor stopped (PID $($supervisorPids -join ', '))"
  }
  $aiOsPids = @(Get-AiOsPids)
  if (-not $aiOsPids.Count) {
    Write-Output 'AI OS is not running'
    return
  }
  foreach ($aiOsPid in $aiOsPids) {
    Stop-Process -Id $aiOsPid -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path $PidFile) { Remove-Item -LiteralPath $PidFile -Force }
  Write-Output "AI OS stopped (PID $($aiOsPids -join ', '))"
}

function Invoke-Maintenance([string[]]$ArgsList) {
  Assert-Python
  Push-Location $ApiDir
  try {
    & $Python -m ai_os.maintenance_cli @ArgsList
  } finally {
    Pop-Location
  }
}

switch ($Action) {
  'start' { Start-AiOs }
  'stop' { Stop-AiOs }
  'restart' { Stop-AiOs; Start-AiOs }
  'status' {
    $aiOsPid = Get-AiOsPid
    if ($aiOsPid) {
      $lanIp = Get-LanIPv4
      Write-Output "AI OS listening on 127.0.0.1:8791 as PID $aiOsPid"
      Write-Output "LAN URL if started with -Lan: http://${lanIp}:8791"
    } else { Write-Output 'AI OS is not running' }
  }
  'health' { Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 5 | ConvertTo-Json -Depth 8 }
  'backup' { Invoke-Maintenance @('backup', '--reason', 'script') }
  'verify' {
    if (-not $BackupId) { throw 'verify requires -BackupId <id>' }
    Invoke-Maintenance @('verify', $BackupId)
  }
  'restore-test' {
    if (-not $BackupId) { throw 'restore-test requires -BackupId <id>' }
    $tempTarget = Join-Path ([System.IO.Path]::GetTempPath()) "ai-os-restore-$BackupId.sqlite3"
    Invoke-Maintenance @('restore', $BackupId, '--target', $tempTarget, '--overwrite', '--confirm', 'RESTORE')
  }
  'integrity' { Invoke-Maintenance @('integrity') }
  'cleanup' { Invoke-Maintenance @('cleanup') }
}
