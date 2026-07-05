$ErrorActionPreference = 'Stop'

function Add-PathEntry([string]$PathEntry) {
  if (-not $PathEntry -or -not (Test-Path $PathEntry)) { return }
  $parts = $env:PATH -split ';'
  if ($parts -notcontains $PathEntry) {
    $env:PATH = "$PathEntry;$env:PATH"
  }
}

function Initialize-NodePath([string]$Root) {
  if (Get-Command node -ErrorAction SilentlyContinue) { return }

  $programFilesX86 = [Environment]::GetFolderPath('ProgramFilesX86')
  $candidates = @(
    (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
    $(if ($programFilesX86) { Join-Path $programFilesX86 'nodejs\node.exe' } else { $null }),
    (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe'),
    (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe')
  ) | Where-Object { $_ }

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) {
      Add-PathEntry (Split-Path -Parent $candidate)
      return
    }
  }

  throw "Node.js was not found. Install Node.js once, or open this from Codex where the bundled runtime is available."
}

function Get-PnpmCommand([string]$Root) {
  Initialize-NodePath $Root

  $localPnpm = Join-Path $Root 'node_modules\.bin\pnpm.CMD'
  if (Test-Path $localPnpm) { return $localPnpm }

  $pathPnpm = Get-Command pnpm -ErrorAction SilentlyContinue
  if ($pathPnpm) { return $pathPnpm.Source }

  $corepack = Get-Command corepack -ErrorAction SilentlyContinue
  if ($corepack) {
    & $corepack.Source enable | Out-Null
    $pathPnpm = Get-Command pnpm -ErrorAction SilentlyContinue
    if ($pathPnpm) { return $pathPnpm.Source }
  }

  throw "pnpm was not found. Run npm install -g pnpm once, or run pnpm install from an environment where pnpm is available."
}

function Convert-DotEnvValue([string]$Value) {
  $trimmed = $Value.Trim()
  if ($trimmed.Length -ge 2) {
    $first = $trimmed.Substring(0, 1)
    $last = $trimmed.Substring($trimmed.Length - 1, 1)
    if (($first -eq '"' -and $last -eq '"') -or ($first -eq "'" -and $last -eq "'")) {
      return $trimmed.Substring(1, $trimmed.Length - 2)
    }
  }
  return $trimmed
}

function Import-DotEnvFile([string]$Path, [switch]$Override) {
  if (-not (Test-Path $Path)) { return }
  Get-Content -LiteralPath $Path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith('#')) { return }
    $match = [regex]::Match($line, '^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$')
    if (-not $match.Success) { return }
    $name = $match.Groups[1].Value
    if (-not $Override -and [Environment]::GetEnvironmentVariable($name, 'Process') -ne $null) { return }
    $value = Convert-DotEnvValue $match.Groups[2].Value
    [Environment]::SetEnvironmentVariable($name, $value, 'Process')
  }
}

function Import-ProjectDotEnv([string]$Root) {
  Import-DotEnvFile (Join-Path $Root '.env')
  Import-DotEnvFile (Join-Path $Root '.env.local') -Override
}

function Get-MiniHubLanIPv4 {
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

function Get-MiniHubTailscaleIPv4 {
  $tailscale = Get-Command tailscale -ErrorAction SilentlyContinue
  if (-not $tailscale) { return '' }
  try {
    $ip = (& $tailscale.Source ip -4 2>$null | Select-Object -First 1).Trim()
    if ($ip -match '^100\.') { return $ip }
  } catch {
    return ''
  }
  return ''
}

function Normalize-MiniHubHost([string]$HostValue) {
  $value = ''
  if ($HostValue) { $value = $HostValue.Trim() }
  if (-not $value) { return '' }
  if ($value -match '^https?://') {
    try { return ([System.Uri]$value).Host } catch { return $value }
  }
  return ($value -replace '/+$', '')
}

function Get-MiniHubPrivateHosts([string]$RemoteHost = '') {
  $hosts = New-Object System.Collections.Generic.List[string]
  $lanIp = Get-MiniHubLanIPv4
  if ($lanIp -and $lanIp -ne 'YOUR-DESKTOP-IP') { $hosts.Add($lanIp) }
  $tailscaleIp = Get-MiniHubTailscaleIPv4
  if ($tailscaleIp) { $hosts.Add($tailscaleIp) }
  $normalizedRemote = Normalize-MiniHubHost $RemoteHost
  if ($normalizedRemote) { $hosts.Add($normalizedRemote) }
  if (-not $hosts.Count) { $hosts.Add('YOUR-DESKTOP-IP') }
  return $hosts | Select-Object -Unique
}

function Get-MiniHubBridgeHost([string]$Profile = 'local', [string]$RemoteHost = '') {
  if ($Profile -ne 'lan') { return '127.0.0.1' }
  $normalizedRemote = Normalize-MiniHubHost $RemoteHost
  if ($normalizedRemote) { return $normalizedRemote }
  return (Get-MiniHubPrivateHosts | Select-Object -First 1)
}

function Get-MiniHubTrustedOriginList(
  [string[]]$Hosts,
  [string]$ExtraTrustedOrigins = '',
  [int]$HubPort = 5173
) {
  $origins = New-Object System.Collections.Generic.List[string]
  @(
    "http://localhost:$HubPort",
    "http://127.0.0.1:$HubPort",
    'http://localhost:1420',
    'http://127.0.0.1:1420',
    'https://elc9939.github.io'
  ) | ForEach-Object { $origins.Add($_) }

  foreach ($hostValue in $Hosts) {
    $hostName = Normalize-MiniHubHost $hostValue
    if ($hostName -and $hostName -ne '127.0.0.1' -and $hostName -ne 'localhost') {
      $origins.Add("http://${hostName}:$HubPort")
    }
  }

  if ($ExtraTrustedOrigins) {
    $ExtraTrustedOrigins.Split(',') |
      ForEach-Object { $_.Trim() } |
      Where-Object { $_ } |
      ForEach-Object { $origins.Add($_) }
  }

  return @($origins | Select-Object -Unique)
}

function Get-MiniHubTrustedOrigins(
  [string[]]$Hosts,
  [string]$ExtraTrustedOrigins = '',
  [int]$HubPort = 5173
) {
  return (@(Get-MiniHubTrustedOriginList $Hosts $ExtraTrustedOrigins $HubPort) -join ',')
}

function Get-MiniHubTrustedOriginsJson(
  [string[]]$Hosts,
  [string]$ExtraTrustedOrigins = '',
  [int]$HubPort = 5173
) {
  return (@(Get-MiniHubTrustedOriginList $Hosts $ExtraTrustedOrigins $HubPort) | ConvertTo-Json -Compress)
}

function Get-MiniHubServiceUrl([string]$HostValue, [int]$Port) {
  $hostName = Normalize-MiniHubHost $HostValue
  return "http://${hostName}:$Port"
}
