param(
  [ValidateSet('start', 'stop', 'status', 'verify', 'watch', 'watch-start', 'watch-stop', 'watch-status', 'startup-install', 'startup-remove', 'startup-status')]
  [string]$Action = 'status',
  [string]$BridgeToken = '',
  [int]$WatchIntervalSeconds = 60,
  [switch]$NoDownload
)

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'script-utils.ps1')
$BridgeDir = Join-Path $Root '.mini-hub-bridge'
$ToolDir = Join-Path $BridgeDir 'tools'
$CloudflaredExe = Join-Path $ToolDir 'cloudflared.exe'
$TunnelPidFile = Join-Path $BridgeDir 'cloudflared.pid'
$TunnelOutLog = Join-Path $BridgeDir 'cloudflared.out.log'
$TunnelErrLog = Join-Path $BridgeDir 'cloudflared.err.log'
$TunnelLinkFile = Join-Path $Root 'remote-tunnel-link.txt'
$TunnelTokenFile = Join-Path $BridgeDir 'remote-tunnel-token.txt'
$TunnelWatchPidFile = Join-Path $BridgeDir 'cloudflared-watch.pid'
$TunnelWatchStopFile = Join-Path $BridgeDir 'cloudflared-watch.stop'
$TunnelWatchOutLog = Join-Path $BridgeDir 'cloudflared-watch.out.log'
$TunnelWatchErrLog = Join-Path $BridgeDir 'cloudflared-watch.err.log'
$StartupFolder = [Environment]::GetFolderPath([Environment+SpecialFolder]::Startup)
$TunnelStartupCommandFile = Join-Path $StartupFolder 'Mini Hub Remote Tunnel Watch.cmd'

function Ensure-Dir([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path | Out-Null
  }
}

function New-BridgeToken {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }
  return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Get-OrCreateBridgeToken {
  if ($BridgeToken.Trim()) { return $BridgeToken.Trim() }
  Ensure-Dir $BridgeDir
  if (Test-Path -LiteralPath $TunnelTokenFile) {
    $existing = (Get-Content -LiteralPath $TunnelTokenFile -ErrorAction SilentlyContinue | Select-Object -First 1).Trim()
    if ($existing) { return $existing }
  }
  $token = New-BridgeToken
  Set-Content -LiteralPath $TunnelTokenFile -Value $token
  return $token
}

function Ensure-Cloudflared {
  Ensure-Dir $ToolDir
  if (Test-Path -LiteralPath $CloudflaredExe) { return }
  if ($NoDownload) {
    throw "cloudflared is not installed at $CloudflaredExe. Rerun without -NoDownload or install cloudflared manually."
  }
  $url = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
  Write-Output "Downloading cloudflared from $url"
  Invoke-WebRequest -Uri $url -OutFile $CloudflaredExe -UseBasicParsing
}

function Get-PidFileProcess([string]$PidFile) {
  if (-not (Test-Path -LiteralPath $PidFile)) { return $null }
  $pidText = Get-Content -LiteralPath $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($pidText -notmatch '^\d+$') { return $null }
  return Get-Process -Id ([int]$pidText) -ErrorAction SilentlyContinue
}

function Get-TunnelUrlFromLogs {
  foreach ($path in @($TunnelOutLog, $TunnelErrLog)) {
    if (-not (Test-Path -LiteralPath $path)) { continue }
    $text = Get-Content -LiteralPath $path -Raw -ErrorAction SilentlyContinue
    if (-not $text) { continue }
    $match = [regex]::Match($text, 'https://[a-zA-Z0-9-]+\.trycloudflare\.com')
    if ($match.Success) { return $match.Value.TrimEnd('/') }
  }
  return ''
}

function Build-RemoteUrl([string]$BaseUrl, [string]$Token) {
  $encodedBase = [System.Uri]::EscapeDataString($BaseUrl)
  $encodedToken = [System.Uri]::EscapeDataString($Token)
  return "$BaseUrl/?apiUrl=$encodedBase&aiOsUrl=$encodedBase&macroLabUrl=$encodedBase&ollamaUrl=$encodedBase&gateway=cloudflare&bridgeToken=$encodedToken"
}

function Redact-RemoteUrl([string]$Url) {
  if (-not $Url) { return '' }
  return [regex]::Replace($Url, '([?&]bridgeToken=)[^&]+', '${1}<redacted>')
}

function Get-RemoteLink {
  if (-not (Test-Path -LiteralPath $TunnelLinkFile)) { return '' }
  $link = Get-Content -LiteralPath $TunnelLinkFile -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $link) { return '' }
  return $link.Trim()
}

function Get-SavedTunnelConfig {
  $link = Get-RemoteLink
  if (-not $link) { return $null }
  $token = Get-QueryParam $link 'bridgeToken'
  $baseUrl = Get-QueryParam $link 'apiUrl'
  if (-not $baseUrl) {
    try {
      $uri = [System.Uri]$link
      $baseUrl = "$($uri.Scheme)://$($uri.Host)"
    } catch {
      $baseUrl = ''
    }
  }
  if (-not $baseUrl -or -not $token) { return $null }
  return [pscustomobject]@{
    Link = $link
    BaseUrl = $baseUrl.TrimEnd('/')
    Token = $token
  }
}

function Get-QueryParam([string]$Url, [string]$Name) {
  $uri = [System.Uri]$Url
  $query = $uri.Query.TrimStart('?')
  if (-not $query) { return '' }
  foreach ($part in $query.Split('&')) {
    if (-not $part) { continue }
    $pair = $part.Split('=', 2)
    $key = [System.Uri]::UnescapeDataString($pair[0])
    if ($key -ne $Name) { continue }
    if ($pair.Count -lt 2) { return '' }
    return [System.Uri]::UnescapeDataString($pair[1])
  }
  return ''
}

function Test-TunnelEndpoint([string]$Label, [string]$Url, [string]$Token) {
  try {
    $response = Invoke-WebRequest -Uri $Url -Headers @{ 'X-Mini-Hub-Bridge-Token' = $Token } -TimeoutSec 15 -UseBasicParsing
    [pscustomobject]@{
      Service = $Label
      Status = 'reachable'
      Http = [int]$response.StatusCode
      Url = $Url
      Detail = 'ok'
    }
  } catch {
    $statusCode = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { $null }
    [pscustomobject]@{
      Service = $Label
      Status = 'failed'
      Http = $statusCode
      Url = $Url
      Detail = $_.Exception.Message
    }
  }
}

function Test-RemoteTunnelReachable([string]$BaseUrl, [string]$Token) {
  if (-not $BaseUrl -or -not $Token) { return $false }
  try {
    $response = Invoke-WebRequest -Uri "$($BaseUrl.TrimEnd('/'))/api/health" -Headers @{ 'X-Mini-Hub-Bridge-Token' = $Token } -TimeoutSec 12 -UseBasicParsing
    return [int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 300
  } catch {
    return $false
  }
}

function Test-SavedTunnelReachable {
  $config = Get-SavedTunnelConfig
  if (-not $config) { return $false }
  return Test-RemoteTunnelReachable $config.BaseUrl $config.Token
}

function Start-RemoteTunnel {
  $token = Get-OrCreateBridgeToken
  Ensure-Dir $BridgeDir
  Write-Output 'Starting Mini Hub single-port gateway with bridge token...'
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'mini-hub-bridge.ps1') restart -Profile lan -HubUi -BridgeToken $token
  Ensure-Cloudflared

  $existing = Get-PidFileProcess $TunnelPidFile
  if ($existing) {
    $url = Get-TunnelUrlFromLogs
    if ($url) {
      $remoteUrl = Build-RemoteUrl $url $token
      if (Test-RemoteTunnelReachable $url $token) {
        Set-Content -LiteralPath $TunnelLinkFile -Value $remoteUrl
        Write-Output "Cloudflare tunnel already running as PID $($existing.Id)"
        Write-Output "Open: $(Redact-RemoteUrl $remoteUrl)"
        Write-Output "Full private phone link: $TunnelLinkFile"
        return
      }
      Write-Output "Existing Cloudflare tunnel PID $($existing.Id) is stale; restarting it."
    }
    Stop-Process -Id $existing.Id -Force
    Remove-Item -LiteralPath $TunnelPidFile -Force -ErrorAction SilentlyContinue
  }

  Remove-Item -LiteralPath $TunnelOutLog, $TunnelErrLog -Force -ErrorAction SilentlyContinue
  $process = Start-Process -FilePath $CloudflaredExe `
    -ArgumentList 'tunnel', '--url', 'http://127.0.0.1:5173', '--no-autoupdate' `
    -WindowStyle Hidden `
    -RedirectStandardOutput $TunnelOutLog `
    -RedirectStandardError $TunnelErrLog `
    -PassThru
  Set-Content -LiteralPath $TunnelPidFile -Value $process.Id

  $deadline = (Get-Date).AddSeconds(35)
  $url = ''
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    $url = Get-TunnelUrlFromLogs
    if ($url) { break }
    if (-not (Get-Process -Id $process.Id -ErrorAction SilentlyContinue)) { break }
  }

  if (-not $url) {
    throw "Cloudflare tunnel did not report a trycloudflare.com URL yet. Check $TunnelErrLog"
  }

  $remoteUrl = Build-RemoteUrl $url $token
  Set-Content -LiteralPath $TunnelLinkFile -Value $remoteUrl
  $readyDeadline = (Get-Date).AddSeconds(25)
  $remoteReady = $false
  while ((Get-Date) -lt $readyDeadline) {
    if (Test-RemoteTunnelReachable $url $token) {
      $remoteReady = $true
      break
    }
    Start-Sleep -Seconds 2
  }
  try {
    Set-Clipboard -Value $remoteUrl
    Write-Output 'Remote tunnel URL copied to clipboard.'
  } catch {
    Write-Output 'Could not copy remote tunnel URL to the clipboard.'
  }
  Write-Output "Cloudflare tunnel started as PID $($process.Id)"
  if (-not $remoteReady) {
    Write-Output 'Cloudflare tunnel URL was created, but the public endpoint did not answer the health check yet. Run pnpm bridge:tunnel:verify in a moment.'
  }
  Write-Output "Open: $(Redact-RemoteUrl $remoteUrl)"
  Write-Output "Full private phone link: $TunnelLinkFile"
}

function Stop-RemoteTunnel {
  $process = Get-PidFileProcess $TunnelPidFile
  if ($process) {
    Stop-Process -Id $process.Id -Force
    Write-Output "Stopped Cloudflare tunnel PID $($process.Id)"
  } else {
    Write-Output 'Cloudflare tunnel is not running from this launcher.'
  }
  Remove-Item -LiteralPath $TunnelPidFile -Force -ErrorAction SilentlyContinue
}

function Show-RemoteTunnelStatus {
  $process = Get-PidFileProcess $TunnelPidFile
  $url = Get-TunnelUrlFromLogs
  $link = Get-RemoteLink
  [pscustomobject]@{
    Running = [bool]$process
    PID = if ($process) { $process.Id } else { $null }
    TunnelUrl = $url
    LinkFile = $TunnelLinkFile
    RemoteLink = Redact-RemoteUrl $link
    FullLink = if ($link) { "Saved in $TunnelLinkFile" } else { '' }
    Cloudflared = if (Test-Path -LiteralPath $CloudflaredExe) { $CloudflaredExe } else { '' }
  } | Format-List
}

function Verify-RemoteTunnel {
  $config = Get-SavedTunnelConfig
  if (-not $config) {
    throw "No remote tunnel link found at $TunnelLinkFile. Run pnpm bridge:tunnel:start first."
  }
  $baseUrl = $config.BaseUrl
  $token = $config.Token
  Write-Output "Verifying remote tunnel endpoints at $baseUrl"
  Write-Output "Full private phone link: $TunnelLinkFile"
  @(
    Test-TunnelEndpoint 'Mini Hub API' "$baseUrl/api/health" $token
    Test-TunnelEndpoint 'AI OS API' "$baseUrl/api/ai/health" $token
    Test-TunnelEndpoint 'Macro Lab API' "$baseUrl/api/macro-lab/health" $token
    Test-TunnelEndpoint 'Ollama' "$baseUrl/api/tags" $token
  ) | Format-Table -AutoSize
}

function Watch-RemoteTunnel {
  Ensure-Dir $BridgeDir
  Remove-Item -LiteralPath $TunnelWatchStopFile -Force -ErrorAction SilentlyContinue
  $interval = [Math]::Max(15, $WatchIntervalSeconds)
  Write-Output "Mini Hub remote tunnel watcher started. Interval: $interval seconds. Link file: $TunnelLinkFile"
  while (-not (Test-Path -LiteralPath $TunnelWatchStopFile)) {
    try {
      if (-not (Test-SavedTunnelReachable)) {
        Write-Output "$(Get-Date -Format o) Remote tunnel is missing or stale; repairing."
        Start-RemoteTunnel
      } else {
        Write-Output "$(Get-Date -Format o) Remote tunnel healthy."
      }
    } catch {
      Write-Output "$(Get-Date -Format o) Remote tunnel repair failed: $($_.Exception.Message)"
    }
    Start-Sleep -Seconds $interval
  }
  Write-Output "Mini Hub remote tunnel watcher stopped."
  Remove-Item -LiteralPath $TunnelWatchStopFile -Force -ErrorAction SilentlyContinue
}

function Start-RemoteTunnelWatch {
  Ensure-Dir $BridgeDir
  $existing = Get-PidFileProcess $TunnelWatchPidFile
  if ($existing) {
    Write-Output "Remote tunnel watcher already running as PID $($existing.Id)"
    return
  }
  Remove-Item -LiteralPath $TunnelWatchStopFile -Force -ErrorAction SilentlyContinue
  $interval = [Math]::Max(15, $WatchIntervalSeconds)
  $noDownloadArg = if ($NoDownload) { ' -NoDownload' } else { '' }
  $arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`" watch -WatchIntervalSeconds $interval$noDownloadArg"
  $process = Start-Process -FilePath 'powershell.exe' `
    -ArgumentList $arguments `
    -WorkingDirectory $Root `
    -WindowStyle Hidden `
    -RedirectStandardOutput $TunnelWatchOutLog `
    -RedirectStandardError $TunnelWatchErrLog `
    -PassThru
  Set-Content -LiteralPath $TunnelWatchPidFile -Value $process.Id
  Write-Output "Remote tunnel watcher started as PID $($process.Id)."
  Write-Output "Watcher logs: $TunnelWatchOutLog"
}

function Stop-RemoteTunnelWatch {
  Set-Content -LiteralPath $TunnelWatchStopFile -Value (Get-Date -Format o) -Encoding ASCII
  $process = Get-PidFileProcess $TunnelWatchPidFile
  if ($process) {
    Start-Sleep -Seconds 2
    if (Get-Process -Id $process.Id -ErrorAction SilentlyContinue) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
    Write-Output "Remote tunnel watcher stopped (PID $($process.Id))."
  } else {
    Write-Output 'Remote tunnel watcher is not running.'
  }
  Remove-Item -LiteralPath $TunnelWatchPidFile, $TunnelWatchStopFile -Force -ErrorAction SilentlyContinue
}

function Show-RemoteTunnelWatchStatus {
  $process = Get-PidFileProcess $TunnelWatchPidFile
  [pscustomobject]@{
    Running = [bool]$process
    PID = if ($process) { $process.Id } else { $null }
    IntervalSeconds = [Math]::Max(15, $WatchIntervalSeconds)
    StartupEntry = if (Test-Path -LiteralPath $TunnelStartupCommandFile) { $TunnelStartupCommandFile } else { '' }
    OutputLog = $TunnelWatchOutLog
    ErrorLog = $TunnelWatchErrLog
    LastHealth = if (Test-SavedTunnelReachable) { 'reachable' } else { 'stale or missing' }
  } | Format-List
}

function Install-RemoteTunnelStartup {
  if (-not (Test-Path -LiteralPath $StartupFolder)) {
    New-Item -ItemType Directory -Path $StartupFolder -Force | Out-Null
  }
  $interval = [Math]::Max(15, $WatchIntervalSeconds)
  $noDownloadArg = if ($NoDownload) { ' -NoDownload' } else { '' }
  $command = "@echo off`r`nstart `"`" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`" watch-start -WatchIntervalSeconds $interval$noDownloadArg`r`n"
  Set-Content -LiteralPath $TunnelStartupCommandFile -Value $command -Encoding ASCII
  Write-Output "Installed Mini Hub Remote Tunnel Watch startup entry for this Windows user."
  Show-RemoteTunnelWatchStatus
}

function Remove-RemoteTunnelStartup {
  if (Test-Path -LiteralPath $TunnelStartupCommandFile) {
    Remove-Item -LiteralPath $TunnelStartupCommandFile -Force
    Write-Output "Removed Mini Hub Remote Tunnel Watch startup entry."
  } else {
    Write-Output "Mini Hub Remote Tunnel Watch startup entry is already absent."
  }
}

function Show-RemoteTunnelStartupStatus {
  if (Test-Path -LiteralPath $TunnelStartupCommandFile) {
    [pscustomobject]@{
      Type = 'Startup Folder'
      File = $TunnelStartupCommandFile
      State = 'Installed for this Windows user'
    } | Format-List
  } else {
    Write-Output 'Mini Hub Remote Tunnel Watch startup is not installed.'
  }
}

switch ($Action) {
  'start' { Start-RemoteTunnel }
  'stop' { Stop-RemoteTunnel }
  'status' { Show-RemoteTunnelStatus }
  'verify' { Verify-RemoteTunnel }
  'watch' { Watch-RemoteTunnel }
  'watch-start' { Start-RemoteTunnelWatch }
  'watch-stop' { Stop-RemoteTunnelWatch }
  'watch-status' { Show-RemoteTunnelWatchStatus }
  'startup-install' { Install-RemoteTunnelStartup }
  'startup-remove' { Remove-RemoteTunnelStartup }
  'startup-status' { Show-RemoteTunnelStartupStatus }
}
