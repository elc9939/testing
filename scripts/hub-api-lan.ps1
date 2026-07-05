param(
  [int]$Port = 8787,
  [string]$RemoteHost = '',
  [string]$ExtraTrustedOrigins = ''
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'script-utils.ps1')
$Pnpm = Get-PnpmCommand $Root

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

$privateHosts = @(Get-MiniHubPrivateHosts $RemoteHost)
$lanIp = Get-MiniHubBridgeHost 'lan' $RemoteHost
$env:PORT = "$Port"
$env:HUB_PUBLIC_URL = "http://$lanIp`:5173"
$env:TRUSTED_ORIGINS = Get-MiniHubTrustedOrigins $privateHosts $ExtraTrustedOrigins 5173

Write-Output "Mini Hub API LAN mode: use http://$lanIp`:$Port from your phone."
Push-Location $Root
try {
  & $Pnpm --filter @mini-hub/api start
} finally {
  Pop-Location
}
