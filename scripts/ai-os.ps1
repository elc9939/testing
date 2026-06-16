param(
  [ValidateSet('start', 'stop', 'restart', 'status', 'health', 'backup', 'verify', 'restore-test', 'integrity', 'cleanup')]
  [string]$Action = 'status',
  [string]$BackupId = ''
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$ApiDir = Join-Path $Root 'apps\ai-os-api'
$Python = Join-Path $ApiDir '.venv\Scripts\python.exe'
$PidFile = Join-Path $ApiDir '.ai-os.pid'
$OutLog = Join-Path $ApiDir 'dev-server.out.log'
$ErrLog = Join-Path $ApiDir 'dev-server.err.log'
$HealthUrl = 'http://127.0.0.1:8791/api/ai/health'

function Get-AiOsPid {
  $conn = Get-NetTCPConnection -LocalPort 8791 -ErrorAction SilentlyContinue |
    Where-Object { $_.State -eq 'Listen' } |
    Select-Object -First 1
  if ($conn) { return [int]$conn.OwningProcess }
  if (Test-Path $PidFile) {
    $pidText = (Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($pidText -match '^\d+$') {
      $process = Get-Process -Id ([int]$pidText) -ErrorAction SilentlyContinue
      if ($process) { return [int]$process.Id }
    }
  }
  return $null
}

function Assert-Python {
  if (-not (Test-Path $Python)) {
    throw "Missing AI OS venv Python at $Python. Create it with: cd apps\ai-os-api; python -m venv .venv; .venv\Scripts\python -m pip install -r requirements.txt"
  }
}

function Start-AiOs {
  Assert-Python
  $aiOsPid = Get-AiOsPid
  if ($aiOsPid) {
    Write-Output "AI OS already running as PID $aiOsPid"
    return
  }
  $process = Start-Process -FilePath $Python `
    -ArgumentList '-m', 'ai_os' `
    -WorkingDirectory $ApiDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $OutLog `
    -RedirectStandardError $ErrLog `
    -PassThru
  Set-Content -Path $PidFile -Value $process.Id
  Start-Sleep -Seconds 2
  Write-Output "AI OS started as PID $($process.Id)"
}

function Stop-AiOs {
  $aiOsPid = Get-AiOsPid
  if (-not $aiOsPid) {
    Write-Output 'AI OS is not running'
    return
  }
  Stop-Process -Id $aiOsPid -Force
  if (Test-Path $PidFile) { Remove-Item -LiteralPath $PidFile -Force }
  Write-Output "AI OS stopped (PID $aiOsPid)"
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
    if ($aiOsPid) { Write-Output "AI OS listening on 127.0.0.1:8791 as PID $aiOsPid" } else { Write-Output 'AI OS is not running' }
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
