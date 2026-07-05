param(
  [ValidateSet('start', 'stop', 'restart', 'status', 'health')]
  [string]$Action = 'status',
  [switch]$Lan,
  [string]$RemoteHost = '',
  [string]$ExtraTrustedOrigins = ''
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'script-utils.ps1')
$ApiDir = Join-Path $Root 'apps\macro-lab-api'
$Python = Join-Path $ApiDir '.venv\Scripts\python.exe'
$FallbackPython = Join-Path $Root 'apps\ai-os-api\.venv\Scripts\python.exe'
$PidFile = Join-Path $ApiDir '.macro-lab.pid'
$OutLog = Join-Path $ApiDir 'dev-server.out.log'
$ErrLog = Join-Path $ApiDir 'dev-server.err.log'
$HealthUrl = 'http://127.0.0.1:8792/api/macro-lab/health'

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

function Get-PythonPath {
  if (Test-Path $Python) { return $Python }
  if (Test-Path $FallbackPython) { return $FallbackPython }
  throw "Missing Macro Lab venv Python at $Python. Create it with: cd apps\macro-lab-api; py -3 -m venv .venv; .venv\Scripts\python -m pip install -r requirements.txt"
}

function Get-MacroLabPids {
  $pids = New-Object System.Collections.Generic.List[int]
  Get-NetTCPConnection -LocalPort 8792 -ErrorAction SilentlyContinue |
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
    Where-Object { $_.CommandLine -match '(?i)(^| )-m macro_lab( |$)' } |
    ForEach-Object {
      if (-not $pids.Contains([int]$_.ProcessId)) { $pids.Add([int]$_.ProcessId) }
    }
  return $pids
}

function Get-MacroLabPid {
  return Get-MacroLabPids | Select-Object -First 1
}

function Start-MacroLab {
  $macroLabPid = Get-MacroLabPid
  if ($macroLabPid) {
    if ($Lan) {
      Write-Output "Restarting Macro Lab in LAN mode from PID $macroLabPid"
      Stop-MacroLab | Out-Null
    } else {
      Write-Output "Macro Lab already running as PID $macroLabPid"
      return
    }
  }
  if ($Lan) {
    $hosts = @(Get-MiniHubPrivateHosts $RemoteHost)
    $lanIp = Get-MiniHubBridgeHost 'lan' $RemoteHost
    $env:MACRO_LAB_HOST = '0.0.0.0'
    $env:MACRO_LAB_PORT = '8792'
    $env:MACRO_LAB_REQUIRE_LOOPBACK = 'false'
    $env:MACRO_LAB_TRUSTED_ORIGINS = Get-MiniHubTrustedOriginsJson $hosts $ExtraTrustedOrigins
    Write-Output "Macro Lab LAN mode: use http://${lanIp}:8792 from your phone."
  }
  Remove-Item Env:PORT -ErrorAction SilentlyContinue
  $pythonPath = Get-PythonPath
  $process = Start-Process -FilePath $pythonPath `
    -ArgumentList '-m', 'macro_lab' `
    -WorkingDirectory $ApiDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $OutLog `
    -RedirectStandardError $ErrLog `
    -PassThru
  Set-Content -Path $PidFile -Value $process.Id
  Start-Sleep -Seconds 2
  Write-Output "Macro Lab started as PID $($process.Id)"
}

function Stop-MacroLab {
  $macroLabPids = @(Get-MacroLabPids)
  if (-not $macroLabPids.Count) {
    Write-Output 'Macro Lab is not running'
    return
  }
  foreach ($macroLabPid in $macroLabPids) {
    Stop-Process -Id $macroLabPid -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path $PidFile) { Remove-Item -LiteralPath $PidFile -Force }
  Write-Output "Macro Lab stopped (PID $($macroLabPids -join ', '))"
}

switch ($Action) {
  'start' { Start-MacroLab }
  'stop' { Stop-MacroLab }
  'restart' { Stop-MacroLab; Start-MacroLab }
  'status' {
    $macroLabPid = Get-MacroLabPid
    if ($macroLabPid) {
      $lanIp = Get-LanIPv4
      Write-Output "Macro Lab listening on 127.0.0.1:8792 as PID $macroLabPid"
      Write-Output "LAN URL if started with -Lan: http://${lanIp}:8792"
    } else { Write-Output 'Macro Lab is not running' }
  }
  'health' { Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 5 | ConvertTo-Json -Depth 8 }
}
