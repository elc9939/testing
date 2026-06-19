param(
  [int]$HubPort = 5173,
  [int]$ApiPort = 8787
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$ApiOutLog = Join-Path $Root '.tmp-api-lan.out.log'
$ApiErrLog = Join-Path $Root '.tmp-api-lan.err.log'

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

$lanIp = Get-LanIPv4
$serviceUrl = "http://$lanIp`:$HubPort/?apiUrl=$([System.Uri]::EscapeDataString("http://$lanIp`:$ApiPort"))&aiOsUrl=$([System.Uri]::EscapeDataString("http://$lanIp`:8791"))&macroLabUrl=$([System.Uri]::EscapeDataString("http://$lanIp`:8792"))"

Push-Location $Root
try {
  $apiPid = Get-PortPid $ApiPort
  if ($apiPid) {
    Write-Output "Mini Hub API already listening on $ApiPort as PID $apiPid"
  } else {
    $env:PORT = "$ApiPort"
    $env:HUB_PUBLIC_URL = "http://$lanIp`:$HubPort"
    $env:TRUSTED_ORIGINS = "http://localhost:$HubPort,http://127.0.0.1:$HubPort,http://$lanIp`:$HubPort,http://localhost:1420,http://127.0.0.1:1420,https://elc9939.github.io"
    $apiProcess = Start-Process -FilePath 'pnpm' `
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
  Write-Output ""
  & pnpm --filter @mini-hub/hub dev -- --host 0.0.0.0 --port $HubPort
} finally {
  Pop-Location
}
