param(
  [ValidateSet('status', 'repair')]
  [string]$Action = 'status',
  [string]$InterfaceAlias = '',
  [switch]$NoPause
)

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$FirewallScript = Join-Path $PSScriptRoot 'mini-hub-firewall.ps1'

function Test-Admin {
  $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-TargetProfiles {
  $profiles = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue | Where-Object {
      ($_.IPv4Connectivity -ne 'Disconnected' -or $_.IPv6Connectivity -ne 'Disconnected') -and
      (-not $InterfaceAlias -or $_.InterfaceAlias -eq $InterfaceAlias)
    })
  return $profiles
}

function Show-RepairStatus {
  Write-Output 'Mini Hub private remote repair status'
  Write-Output "Admin shell: $(if (Test-Admin) { 'yes' } else { 'no' })"
  Write-Output ''
  $profiles = @(Get-TargetProfiles)
  if ($profiles.Count) {
    Write-Output 'Active network profiles:'
    $profiles |
      Select-Object Name, InterfaceAlias, InterfaceIndex, NetworkCategory, IPv4Connectivity, IPv6Connectivity |
      Format-Table -AutoSize
  } else {
    Write-Output 'Active network profiles: none reported'
  }
  Write-Output ''
  & powershell -NoProfile -ExecutionPolicy Bypass -File $FirewallScript status
}

function Start-ElevatedRepair {
  $interfaceArg = if ($InterfaceAlias) { " -InterfaceAlias `"$InterfaceAlias`"" } else { '' }
  $repairArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" repair$interfaceArg -NoPause"
  $escapedRepairArgs = $repairArgs.Replace("'", "''")
  $launcherCommand = "Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList '$escapedRepairArgs'"
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($launcherCommand))
  Start-Process `
    -FilePath 'powershell.exe' `
    -WindowStyle Hidden `
    -ArgumentList "-NoProfile -EncodedCommand $encoded"
  Write-Output 'Opened a Windows administrator prompt for Mini Hub private remote repair. Approve it to mark the trusted network Private and install scoped firewall rules.'
}

function Set-TargetProfilesPrivate {
  $profiles = @(Get-TargetProfiles)
  if (-not $profiles.Count) {
    Write-Output 'No active network profiles found to repair.'
    return
  }
  foreach ($profile in $profiles) {
    if ($profile.NetworkCategory -eq 'Public') {
      Set-NetConnectionProfile -InterfaceIndex $profile.InterfaceIndex -NetworkCategory Private
      Write-Output "Marked network '$($profile.Name)' on $($profile.InterfaceAlias) as Private."
    } else {
      Write-Output "Network '$($profile.Name)' is already $($profile.NetworkCategory)."
    }
  }
}

function Repair-PrivateRemote {
  if (-not (Test-Admin)) {
    Start-ElevatedRepair
    return
  }
  if (-not (Test-Path $FirewallScript)) {
    throw "Firewall helper not found at $FirewallScript"
  }
  Set-TargetProfilesPrivate
  & powershell -NoProfile -ExecutionPolicy Bypass -File $FirewallScript install
  Write-Output ''
  Write-Output 'Repair complete. Current status:'
  Show-RepairStatus
  if (-not $NoPause) {
    Read-Host 'Press Enter to close'
  }
}

switch ($Action) {
  'status' { Show-RepairStatus }
  'repair' { Repair-PrivateRemote }
}
