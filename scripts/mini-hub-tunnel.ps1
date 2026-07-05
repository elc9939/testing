param(
  [ValidateSet('start', 'stop', 'status')]
  [string]$Action = 'status',
  [string]$BridgeToken = '',
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
      Set-Content -LiteralPath $TunnelLinkFile -Value $remoteUrl
      Write-Output "Cloudflare tunnel already running as PID $($existing.Id)"
      Write-Output "Open: $remoteUrl"
      return
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
  try {
    Set-Clipboard -Value $remoteUrl
    Write-Output 'Remote tunnel URL copied to clipboard.'
  } catch {
    Write-Output 'Could not copy remote tunnel URL to the clipboard.'
  }
  Write-Output "Cloudflare tunnel started as PID $($process.Id)"
  Write-Output "Open: $remoteUrl"
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
  $link = if (Test-Path -LiteralPath $TunnelLinkFile) {
    Get-Content -LiteralPath $TunnelLinkFile -ErrorAction SilentlyContinue | Select-Object -First 1
  } else {
    ''
  }
  [pscustomobject]@{
    Running = [bool]$process
    PID = if ($process) { $process.Id } else { $null }
    TunnelUrl = $url
    LinkFile = $TunnelLinkFile
    RemoteLink = $link
    Cloudflared = if (Test-Path -LiteralPath $CloudflaredExe) { $CloudflaredExe } else { '' }
  } | Format-List
}

switch ($Action) {
  'start' { Start-RemoteTunnel }
  'stop' { Stop-RemoteTunnel }
  'status' { Show-RemoteTunnelStatus }
}
