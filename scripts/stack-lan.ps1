param(
  [int]$HubPort = 5173,
  [int]$ApiPort = 8787
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'script-utils.ps1')
$Pnpm = Get-PnpmCommand $Root
$ApiOutLog = Join-Path $Root '.tmp-api-lan.out.log'
$ApiErrLog = Join-Path $Root '.tmp-api-lan.err.log'
$PhoneLinkFile = Join-Path $Root 'phone-link.txt'

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

function Get-PortPid([int]$Port) {
  $conn = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
    Where-Object { $_.State -eq 'Listen' } |
    Select-Object -First 1
  if ($conn) { return [int]$conn.OwningProcess }
  return $null
}

function Test-MiniHubApi([int]$Port) {
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 3
    return $health.service -eq 'mini-hub-api'
  } catch {
    return $false
  }
}

$lanIp = Get-LanIPv4
$serviceUrl = "http://$lanIp`:$HubPort/?apiUrl=$([System.Uri]::EscapeDataString("http://$lanIp`:$ApiPort"))&aiOsUrl=$([System.Uri]::EscapeDataString("http://$lanIp`:8791"))&macroLabUrl=$([System.Uri]::EscapeDataString("http://$lanIp`:8792"))"
Set-Content -Path $PhoneLinkFile -Value $serviceUrl
try {
  Set-Clipboard -Value $serviceUrl
  $clipboardMessage = "Copied the phone URL to your clipboard."
} catch {
  $clipboardMessage = "Could not copy the phone URL to the clipboard, but it was written to phone-link.txt."
}

Push-Location $Root
try {
  $apiPid = Get-PortPid $ApiPort
  if ($apiPid) {
    if (Test-MiniHubApi $ApiPort) {
      Write-Output "Restarting Mini Hub API in LAN mode from PID $apiPid"
      Stop-Process -Id $apiPid -Force
      Start-Sleep -Seconds 1
      $apiPid = $null
    } else {
      throw "Port $ApiPort is already in use by PID $apiPid and does not look like Mini Hub API."
    }
  }

  if (-not $apiPid) {
    $env:PORT = "$ApiPort"
    $env:HUB_PUBLIC_URL = "http://$lanIp`:$HubPort"
    $env:TRUSTED_ORIGINS = "http://localhost:$HubPort,http://127.0.0.1:$HubPort,http://$lanIp`:$HubPort,http://localhost:1420,http://127.0.0.1:1420,https://elc9939.github.io"
    $apiProcess = Start-Process -FilePath $Pnpm `
      -ArgumentList '--filter', '@mini-hub/api', 'start' `
      -WorkingDirectory $Root `
      -WindowStyle Hidden `
      -RedirectStandardOutput $ApiOutLog `
      -RedirectStandardError $ApiErrLog `
      -PassThru
    Write-Output "Mini Hub API LAN mode started as PID $($apiProcess.Id)"
  }

  & powershell -ExecutionPolicy Bypass -File (Join-Path $Root 'scripts\ai-os.ps1') start -Lan
  & powershell -ExecutionPolicy Bypass -File (Join-Path $Root 'scripts\macro-lab.ps1') start -Lan

  Write-Output ""
  Write-Output "Open this from your phone while this terminal stays running:"
  Write-Output $serviceUrl
  Write-Output $clipboardMessage
  Write-Output "The same URL is saved in phone-link.txt."
  Write-Output ""
  & $Pnpm --filter @mini-hub/hub dev -- --host 0.0.0.0 --port $HubPort
} finally {
  Pop-Location
}
