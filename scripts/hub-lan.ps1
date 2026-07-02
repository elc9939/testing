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
$serviceUrl = "$hubUrl/?apiUrl=$([System.Uri]::EscapeDataString("http://$lanIp`:8787"))&aiOsUrl=$([System.Uri]::EscapeDataString("http://$lanIp`:8791"))&macroLabUrl=$([System.Uri]::EscapeDataString("http://$lanIp`:8792"))&ollamaUrl=$([System.Uri]::EscapeDataString("http://$lanIp`:11434"))"

Write-Output "Mini Hub LAN mode: open this from your phone:"
Write-Output $serviceUrl
Write-Output "Keep this terminal running while using the phone UI."

Push-Location $Root
try {
  & $Pnpm --filter @mini-hub/hub dev -- --host 0.0.0.0 --port $Port
} finally {
  Pop-Location
}
