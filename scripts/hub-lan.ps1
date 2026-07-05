param(
  [int]$Port = 5173
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

$lanIp = Get-LanIPv4
$hubUrl = "http://$lanIp`:$Port"
$gateway = [System.Uri]::EscapeDataString($hubUrl)
$serviceUrl = "$hubUrl/?apiUrl=$gateway&aiOsUrl=$gateway&macroLabUrl=$gateway&ollamaUrl=$gateway&gateway=single-port"

Write-Output "Mini Hub LAN mode: open this from your phone:"
Write-Output $serviceUrl
Write-Output "Keep this terminal running while using the phone UI."

Push-Location $Root
try {
  Push-Location (Join-Path $Root 'apps\hub')
  try {
    & $Pnpm exec vite --host 0.0.0.0 --port $Port
  } finally {
    Pop-Location
  }
} finally {
  Pop-Location
}
