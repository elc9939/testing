param(
  [ValidateSet('start', 'stop', 'restart', 'status')]
  [string]$Action = 'status',
  [ValidateSet('local', 'lan')]
  [string]$Profile = 'local',
  [switch]$HubUi,
  [string]$BridgeToken = '',
  [string]$RemoteHost = '',
  [string]$ExtraTrustedOrigins = ''
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
$FirewallScript = Join-Path $PSScriptRoot 'mini-hub-firewall.ps1'

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
  return Get-MiniHubBridgeHost $Profile $RemoteHost
}

function Get-ServiceUrl([int]$Port) {
  return "http://$(Get-BridgeHost):$Port"
}

function Get-BridgeUrl {
  $hub = Get-ServiceUrl 5173
  $gateway = [System.Uri]::EscapeDataString($hub)
  return "$hub/?apiUrl=$gateway&aiOsUrl=$gateway&macroLabUrl=$gateway&ollamaUrl=$gateway&gateway=single-port"
}

function Get-PortPid([int]$Port) {
  $conn = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
    Where-Object { $_.State -eq 'Listen' } |
    Select-Object -First 1
  if ($conn) { return [int]$conn.OwningProcess }
  return $null
}

function Get-ProcessCommandLine([int]$ProcessId) {
  try {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction Stop
    return [string]$process.CommandLine
  } catch {
    return ''
  }
}

function Test-HttpEndpoint([string]$Url) {
  try {
    Invoke-WebRequest -Uri $Url -TimeoutSec 4 -UseBasicParsing | Out-Null
    return $true
  } catch {
    return $false
  }
}

function Test-ManagedHubUiProcess([int]$ProcessId) {
  $commandLine = Get-ProcessCommandLine $ProcessId
  if (-not $commandLine) { return $false }
  return $commandLine -match '(?i)(vite|svelte-kit|@mini-hub/hub|pnpm|node)'
}

function Test-ManagedHubApiProcess([int]$ProcessId) {
  $commandLine = Get-ProcessCommandLine $ProcessId
  if (-not $commandLine) { return $false }
  return $commandLine -match '(?i)(@mini-hub/api|apps\\api|src/index\.ts|tsx)'
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

function Wait-JsonEndpoint([string]$Url, [string]$Token = '', [int]$TimeoutSeconds = 30) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-JsonEndpoint $Url $Token) { return $true }
    Start-Sleep -Seconds 2
  }
  return $false
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
    Write-Output 'Ollama already reachable on 127.0.0.1:11434; the Hub gateway will proxy phone requests.'
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
    if ($Profile -ne 'lan') {
      Write-Output 'Mini Hub API already reachable on 127.0.0.1:8787'
      return
    }
    $pidToRestart = Get-PortPid 8787
    if ($pidToRestart) {
      Write-Output "Restarting Mini Hub API in LAN/remote mode from PID $pidToRestart"
      Stop-Process -Id $pidToRestart -Force
      Start-Sleep -Seconds 1
    }
  }
  $existingPid = Get-PortPid 8787
  if ($existingPid) {
    if (Test-ManagedHubApiProcess $existingPid) {
      Write-Output "Restarting stale Mini Hub API process on port 8787 from PID $existingPid"
      Stop-Process -Id $existingPid -Force
      Start-Sleep -Seconds 1
    } else {
      throw "Port 8787 is already in use by PID $existingPid and Mini Hub API did not answer health."
    }
  }
  Ensure-BridgeDir
  $lanHost = Get-BridgeHost
  $privateHosts = @(Get-MiniHubPrivateHosts $RemoteHost)
  $env:PORT = '8787'
  $env:HUB_PUBLIC_URL = "http://${lanHost}:5173"
  $env:TRUSTED_ORIGINS = Get-MiniHubTrustedOrigins $privateHosts $ExtraTrustedOrigins 5173
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
      if ($Profile -eq 'lan') {
        Stop-Process -Id ([int]$existing) -Force
        Remove-Item -LiteralPath $HubUiPidFile -Force -ErrorAction SilentlyContinue
        Write-Output "Restarting Hub UI in LAN/remote mode from PID $existing"
        Start-Sleep -Seconds 1
      } else {
        Write-Output "Hub UI already started as PID $existing"
        return
      }
    }
  }
  Ensure-BridgeDir
  if ($BridgeToken) {
    $env:MINI_HUB_GATEWAY_TOKEN = $BridgeToken
    $env:MINI_HUB_BRIDGE_TOKEN = $BridgeToken
  } else {
    Remove-Item Env:MINI_HUB_GATEWAY_TOKEN -ErrorAction SilentlyContinue
  }
  $hostArg = if ($Profile -eq 'lan') { '0.0.0.0' } else { '127.0.0.1' }
  $portPid = Get-PortPid 5173
  if ($portPid) {
    $lanUiUrl = Get-ServiceUrl 5173
    if ($Profile -eq 'lan' -and -not (Test-HttpEndpoint $lanUiUrl)) {
      if (Test-ManagedHubUiProcess $portPid) {
        Write-Output "Restarting localhost-only Hub UI in LAN/remote mode from PID $portPid"
        Stop-Process -Id $portPid -Force
        Start-Sleep -Seconds 1
      } else {
        throw "Hub UI port 5173 is already in use by PID $portPid and $lanUiUrl is not reachable. Stop that process, then rerun bridge:start:lan."
      }
    } else {
      Write-Output "Hub UI port 5173 is already reachable by PID $portPid. Reusing it."
      return
    }
  }
  $process = Start-Process -FilePath $Pnpm `
    -ArgumentList 'exec', 'vite', '--host', $hostArg, '--port', '5173' `
    -WorkingDirectory (Join-Path $Root 'apps\hub') `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $BridgeDir 'hub-ui.out.log') `
    -RedirectStandardError (Join-Path $BridgeDir 'hub-ui.err.log') `
    -PassThru
  Set-Content -Path $HubUiPidFile -Value $process.Id
  Write-Output "Hub UI started as PID $($process.Id)"
}

function Invoke-BridgeChildScript([string]$ScriptPath, [string[]]$Arguments) {
  & powershell -ExecutionPolicy Bypass -File $ScriptPath @Arguments
  if ($LASTEXITCODE -ne 0) {
    $healthUrl = ''
    if ($ScriptPath -like '*ai-os.ps1') {
      $healthUrl = 'http://127.0.0.1:8791/api/ai/health'
    } elseif ($ScriptPath -like '*macro-lab.ps1') {
      $healthUrl = 'http://127.0.0.1:8792/api/macro-lab/health'
    }
    if ($healthUrl -and (Wait-JsonEndpoint $healthUrl $BridgeToken 45)) {
      Write-Output "Launcher returned exit code $LASTEXITCODE, but service health is reachable at $healthUrl. Continuing."
      return
    }
    throw "Launcher failed: $ScriptPath $($Arguments -join ' ')"
  }
}

function Start-Bridge {
  Start-Ollama
  Start-HubApi
  Remove-Item Env:PORT -ErrorAction SilentlyContinue
  $aiScript = Join-Path $Root 'scripts\ai-os.ps1'
  $macroScript = Join-Path $Root 'scripts\macro-lab.ps1'
  Invoke-BridgeChildScript -ScriptPath $aiScript -Arguments @('start')
  Invoke-BridgeChildScript -ScriptPath $macroScript -Arguments @('start')
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
  if ($Profile -eq 'lan' -and (Test-Path $FirewallScript)) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $FirewallScript status -Quiet
  }
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
