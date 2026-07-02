param(
  [ValidateSet('start', 'stop', 'restart', 'status')]
  [string]$Action = 'status',
  [ValidateSet('local', 'lan')]
  [string]$Profile = 'local',
  [switch]$HubUi,
  [string]$BridgeToken = ''
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'script-utils.ps1')
$Pnpm = Get-PnpmCommand $Root
$BridgeDir = Join-Path $Root '.mini-hub-bridge'
$HubApiPidFile = Join-Path $BridgeDir 'hub-api.pid'
$HubUiPidFile = Join-Path $BridgeDir 'hub-ui.pid'
$OllamaPidFile = Join-Path $BridgeDir 'ollama.pid'
$BridgeLinkFile = Join-Path $Root 'bridge-link.txt'

function Ensure-BridgeDir {
  if (-not (Test-Path $BridgeDir)) {
    New-Item -ItemType Directory -Path $BridgeDir | Out-Null
  }
}

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

function Get-BridgeHost {
  if ($Profile -eq 'lan') { return Get-LanIPv4 }
  return '127.0.0.1'
}

function Get-ServiceUrl([int]$Port) {
  return "http://$(Get-BridgeHost):$Port"
}

function Get-BridgeUrl {
  $hub = Get-ServiceUrl 5173
  $api = [System.Uri]::EscapeDataString((Get-ServiceUrl 8787))
  $ai = [System.Uri]::EscapeDataString((Get-ServiceUrl 8791))
  $macro = [System.Uri]::EscapeDataString((Get-ServiceUrl 8792))
  $ollama = [System.Uri]::EscapeDataString((Get-ServiceUrl 11434))
  return "$hub/?apiUrl=$api&aiOsUrl=$ai&macroLabUrl=$macro&ollamaUrl=$ollama"
}

function Get-PortPid([int]$Port) {
  $conn = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
    Where-Object { $_.State -eq 'Listen' } |
    Select-Object -First 1
  if ($conn) { return [int]$conn.OwningProcess }
  return $null
}

function Get-JsonEndpointStatus([string]$Url, [string]$Token = '') {
  try {
    $headers = @{}
    if ($Token) { $headers['X-Mini-Hub-Bridge-Token'] = $Token }
    Invoke-RestMethod -Uri $Url -Headers $headers -TimeoutSec 4 | Out-Null
    return @{ Ok = $true; Detail = 'ok' }
  } catch {
    return @{ Ok = $false; Detail = $_.Exception.Message }
  }
}

function Test-JsonEndpoint([string]$Url, [string]$Token = '') {
  return (Get-JsonEndpointStatus $Url $Token).Ok
}

function Stop-PidFile([string]$PidFile, [string]$Label) {
  if (-not (Test-Path $PidFile)) { return }
  $pidText = Get-Content -LiteralPath $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($pidText -match '^\d+$') {
    $process = Get-Process -Id ([int]$pidText) -ErrorAction SilentlyContinue
    if ($process) {
      Stop-Process -Id $process.Id -Force
      Write-Output "$Label stopped (PID $($process.Id))"
    }
  }
  Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
}

function Start-Ollama {
  if (Test-JsonEndpoint 'http://127.0.0.1:11434/api/tags') {
    Write-Output 'Ollama already reachable on 127.0.0.1:11434'
    return
  }
  $ollama = Get-Command ollama -ErrorAction SilentlyContinue
  if (-not $ollama) {
    Write-Output 'Ollama command not found. Install/start Ollama separately if you want local model serving.'
    return
  }
  Ensure-BridgeDir
  $process = Start-Process -FilePath $ollama.Source -ArgumentList 'serve' -WindowStyle Hidden -PassThru
  Set-Content -Path $OllamaPidFile -Value $process.Id
  Start-Sleep -Seconds 2
  if (Test-JsonEndpoint 'http://127.0.0.1:11434/api/tags') {
    Write-Output "Ollama started as PID $($process.Id)"
  } else {
    Write-Output 'Tried to start Ollama, but /api/tags is still unavailable.'
  }
}

function Start-HubApi {
  if (Test-JsonEndpoint 'http://127.0.0.1:8787/api/health' $BridgeToken) {
    Write-Output 'Mini Hub API already reachable on 127.0.0.1:8787'
    return
  }
  $pid = Get-PortPid 8787
  if ($pid) {
    throw "Port 8787 is already in use by PID $pid and Mini Hub API did not answer health."
  }
  Ensure-BridgeDir
  $lanHost = Get-BridgeHost
  $env:PORT = '8787'
  $env:HUB_PUBLIC_URL = "http://${lanHost}:5173"
  $env:TRUSTED_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173,http://${lanHost}:5173,http://localhost:1420,http://127.0.0.1:1420,https://elc9939.github.io"
  if ($BridgeToken) { $env:MINI_HUB_BRIDGE_TOKEN = $BridgeToken }
  $process = Start-Process -FilePath $Pnpm `
    -ArgumentList '--filter', '@mini-hub/api', 'start' `
    -WorkingDirectory $Root `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $BridgeDir 'hub-api.out.log') `
    -RedirectStandardError (Join-Path $BridgeDir 'hub-api.err.log') `
    -PassThru
  Set-Content -Path $HubApiPidFile -Value $process.Id
  Start-Sleep -Seconds 2
  Write-Output "Mini Hub API started as PID $($process.Id)"
}

function Start-HubUi {
  if (-not $HubUi) { return }
  if (Test-Path $HubUiPidFile) {
    $existing = Get-Content -LiteralPath $HubUiPidFile -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($existing -match '^\d+$' -and (Get-Process -Id ([int]$existing) -ErrorAction SilentlyContinue)) {
      Write-Output "Hub UI already started as PID $existing"
      return
    }
  }
  Ensure-BridgeDir
  $hostArg = if ($Profile -eq 'lan') { '0.0.0.0' } else { '127.0.0.1' }
  $process = Start-Process -FilePath $Pnpm `
    -ArgumentList '--filter', '@mini-hub/hub', 'dev', '--', '--host', $hostArg, '--port', '5173' `
    -WorkingDirectory $Root `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $BridgeDir 'hub-ui.out.log') `
    -RedirectStandardError (Join-Path $BridgeDir 'hub-ui.err.log') `
    -PassThru
  Set-Content -Path $HubUiPidFile -Value $process.Id
  Write-Output "Hub UI started as PID $($process.Id)"
}

function Start-Bridge {
  Start-Ollama
  Start-HubApi
  if ($Profile -eq 'lan') {
    & powershell -ExecutionPolicy Bypass -File (Join-Path $Root 'scripts\ai-os.ps1') start -Lan
    & powershell -ExecutionPolicy Bypass -File (Join-Path $Root 'scripts\macro-lab.ps1') start -Lan
  } else {
    & powershell -ExecutionPolicy Bypass -File (Join-Path $Root 'scripts\ai-os.ps1') start
    & powershell -ExecutionPolicy Bypass -File (Join-Path $Root 'scripts\macro-lab.ps1') start
  }
  Start-HubUi
  $url = Get-BridgeUrl
  Set-Content -Path $BridgeLinkFile -Value $url
  try {
    Set-Clipboard -Value $url
    Write-Output 'Bridge URL copied to clipboard.'
  } catch {
    Write-Output 'Could not copy bridge URL to clipboard.'
  }
  Write-Output "Bridge profile: $Profile"
  Write-Output "Open: $url"
  if ($BridgeToken) {
    Write-Output 'Bridge token is active for Mini Hub-controlled services. Save the same token in Settings -> Desktop Services.'
  } else {
    Write-Output 'No bridge token supplied. Keep services private to loopback/LAN/Tailscale, or restart with -BridgeToken when exposing them.'
  }
}

function Stop-Bridge {
  Stop-PidFile $HubUiPidFile 'Hub UI'
  Stop-PidFile $HubApiPidFile 'Mini Hub API'
  & powershell -ExecutionPolicy Bypass -File (Join-Path $Root 'scripts\ai-os.ps1') stop
  & powershell -ExecutionPolicy Bypass -File (Join-Path $Root 'scripts\macro-lab.ps1') stop
  Stop-PidFile $OllamaPidFile 'Ollama'
}

function Show-BridgeStatus {
  $token = $BridgeToken
  $hubStatus = Get-JsonEndpointStatus 'http://127.0.0.1:8787/api/health' $token
  $aiStatus = Get-JsonEndpointStatus 'http://127.0.0.1:8791/api/ai/health' $token
  $macroStatus = Get-JsonEndpointStatus 'http://127.0.0.1:8792/api/macro-lab/health' $token
  $ollamaStatus = Get-JsonEndpointStatus 'http://127.0.0.1:11434/api/tags'
  $rows = @(
    @{ Service = 'Mini Hub API'; Url = 'http://127.0.0.1:8787/api/health'; Status = $hubStatus; Pid = Get-PortPid 8787 },
    @{ Service = 'AI OS API'; Url = 'http://127.0.0.1:8791/api/ai/health'; Status = $aiStatus; Pid = Get-PortPid 8791 },
    @{ Service = 'Macro Lab API'; Url = 'http://127.0.0.1:8792/api/macro-lab/health'; Status = $macroStatus; Pid = Get-PortPid 8792 },
    @{ Service = 'Ollama'; Url = 'http://127.0.0.1:11434/api/tags'; Status = $ollamaStatus; Pid = Get-PortPid 11434 }
  )
  $rows | ForEach-Object {
    [pscustomobject]@{
      Service = $_.Service
      Status = if ($_.Status.Ok) { 'reachable' } else { 'offline' }
      PID = $_.Pid
      Health = $_.Url
      Detail = $_.Status.Detail
    }
  } | Format-Table -AutoSize
  Write-Output "Bridge profile URL: $(Get-BridgeUrl)"
  Write-Output "Saved bridge link file: $BridgeLinkFile"
  Write-Output "Launcher logs: $BridgeDir"
}

Push-Location $Root
try {
  switch ($Action) {
    'start' { Start-Bridge; Show-BridgeStatus }
    'stop' { Stop-Bridge; Show-BridgeStatus }
    'restart' { Stop-Bridge; Start-Bridge; Show-BridgeStatus }
    'status' { Show-BridgeStatus }
  }
} finally {
  Pop-Location
}
