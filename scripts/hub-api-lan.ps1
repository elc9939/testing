param(
  [int]$Port = 8787
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot

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

$lanIp = Get-LanIPv4
$env:PORT = "$Port"
$env:HUB_PUBLIC_URL = "http://$lanIp`:5173"
$env:TRUSTED_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173,http://$lanIp`:5173,http://localhost:1420,http://127.0.0.1:1420,https://elc9939.github.io"

Write-Output "Mini Hub API LAN mode: use http://$lanIp`:$Port from your phone."
Push-Location $Root
try {
  & pnpm --filter @mini-hub/api start
} finally {
  Pop-Location
}
