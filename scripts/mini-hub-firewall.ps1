param(
  [ValidateSet('status', 'install', 'remove')]
  [string]$Action = 'status',
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'

$RuleGroup = 'Mini Hub Private Remote'
$Ports = @(
  @{ Name = 'Hub UI'; Port = 5173 },
  @{ Name = 'Mini Hub API'; Port = 8787 },
  @{ Name = 'AI OS API'; Port = 8791 },
  @{ Name = 'Macro Lab API'; Port = 8792 },
  @{ Name = 'Ollama'; Port = 11434 }
)

function Test-Admin {
  $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Rule-Name($PortSpec) {
  return "$RuleGroup - $($PortSpec.Name) ($($PortSpec.Port))"
}

function Get-ActiveNetworkProfiles {
  @(Get-NetConnectionProfile -ErrorAction SilentlyContinue | Where-Object { $_.IPv4Connectivity -ne 'Disconnected' -or $_.IPv6Connectivity -ne 'Disconnected' })
}

function Get-RuleStatus($PortSpec) {
  $displayName = Rule-Name $PortSpec
  $rule = Get-NetFirewallRule -DisplayName $displayName -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $rule) {
    return [pscustomobject]@{
      Service = $PortSpec.Name
      Port = $PortSpec.Port
      Installed = $false
      Enabled = $false
      Profile = ''
      Action = ''
      Detail = 'missing'
    }
  }

  $portFilter = Get-NetFirewallPortFilter -AssociatedNetFirewallRule $rule -ErrorAction SilentlyContinue | Select-Object -First 1
  $portOk = $portFilter -and $portFilter.Protocol -eq 'TCP' -and [string]$portFilter.LocalPort -eq [string]$PortSpec.Port
  $profileOk = [string]$rule.Profile -match 'Private'
  $ready = $rule.Enabled -eq 'True' -and $rule.Action -eq 'Allow' -and $profileOk -and $portOk
  return [pscustomobject]@{
    Service = $PortSpec.Name
    Port = $PortSpec.Port
    Installed = $true
    Enabled = $rule.Enabled -eq 'True'
    Profile = [string]$rule.Profile
    Action = [string]$rule.Action
    Detail = if ($ready) { 'ready' } elseif (-not $portOk) { 'wrong port/protocol' } elseif (-not $profileOk) { 'not private-profile scoped' } else { 'needs attention' }
  }
}

function Get-StatusRows {
  $Ports | ForEach-Object { Get-RuleStatus $_ }
}

function Show-Status {
  $profiles = @(Get-ActiveNetworkProfiles)
  $rows = @(Get-StatusRows)
  $missing = @($rows | Where-Object { $_.Detail -ne 'ready' })
  $publicProfiles = @($profiles | Where-Object { $_.NetworkCategory -eq 'Public' })
  $privateProfiles = @($profiles | Where-Object { $_.NetworkCategory -in @('Private', 'DomainAuthenticated') })

  if ($Quiet) {
    $ruleText = if ($missing.Count -eq 0) { 'rules ready' } else { "$($missing.Count) rule(s) need install/fix" }
    $profileText = if ($privateProfiles.Count) { 'private network active' } elseif ($publicProfiles.Count) { 'active network is Public' } else { 'network profile unknown' }
    $adminText = if (Test-Admin) { 'elevated' } else { 'not elevated' }
    Write-Output "Firewall: $ruleText; $profileText; $adminText. Private remote ports: $(@($Ports | ForEach-Object { $_.Port }) -join ', ')."
    if ($missing.Count -gt 0 -or $publicProfiles.Count -gt 0) {
      Write-Output 'Firewall fix: run pnpm bridge:firewall:install from an elevated terminal and set trusted home Wi-Fi to Private before phone access.'
    }
    return
  }

  Write-Output 'Mini Hub private remote firewall status'
  Write-Output "Rule group: $RuleGroup"
  Write-Output "Admin shell: $(if (Test-Admin) { 'yes' } else { 'no' })"
  Write-Output ''
  if ($profiles.Count) {
    Write-Output 'Active network profiles:'
    $profiles |
      Select-Object Name, InterfaceAlias, NetworkCategory, IPv4Connectivity, IPv6Connectivity |
      Format-Table -AutoSize
  } else {
    Write-Output 'Active network profiles: none reported'
  }
  Write-Output ''
  Write-Output 'Firewall rules:'
  $rows | Format-Table -AutoSize
  Write-Output ''
  if ($missing.Count -eq 0 -and $privateProfiles.Count) {
    Write-Output 'Readiness: private-network inbound rules look ready for phone/LAN access.'
  } elseif ($publicProfiles.Count -and -not $privateProfiles.Count) {
    Write-Output 'Readiness: active network is Public. Windows may block Private-profile rules until this trusted Wi-Fi/network is marked Private.'
  } elseif ($missing.Count -gt 0) {
    Write-Output 'Readiness: firewall rules are missing or incomplete. Install rules from an elevated terminal.'
  } else {
    Write-Output 'Readiness: check network profile and firewall rules before phone access.'
  }
}

function Request-ElevatedSelf([string]$RequestedAction) {
  $quotedPath = '"' + $PSCommandPath + '"'
  Start-Process `
    -FilePath 'powershell.exe' `
    -Verb RunAs `
    -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File $quotedPath $RequestedAction"
  Write-Output "Opened an elevated PowerShell prompt to run firewall action '$RequestedAction'. Approve the Windows prompt to continue."
}

function Assert-AdminForChange([string]$RequestedAction) {
  if (Test-Admin) { return $true }
  Request-ElevatedSelf $RequestedAction
  return $false
}

function Install-Rules {
  if (-not (Assert-AdminForChange 'install')) { return }
  foreach ($portSpec in $Ports) {
    $displayName = Rule-Name $portSpec
    $existing = Get-NetFirewallRule -DisplayName $displayName -ErrorAction SilentlyContinue
    if ($existing) {
      $existing | Remove-NetFirewallRule
    }
    New-NetFirewallRule `
      -DisplayName $displayName `
      -DisplayGroup $RuleGroup `
      -Direction Inbound `
      -Action Allow `
      -Enabled True `
      -Profile Private `
      -Protocol TCP `
      -LocalPort $portSpec.Port `
      -Description 'Allows Mini Hub private remote access from trusted Private LAN/Tailscale networks only.' | Out-Null
  }
  Write-Output "Installed $($Ports.Count) Private-profile Mini Hub firewall rule(s)."
  Show-Status
}

function Remove-Rules {
  if (-not (Assert-AdminForChange 'remove')) { return }
  $existing = @(Get-NetFirewallRule -DisplayGroup $RuleGroup -ErrorAction SilentlyContinue)
  if (-not $existing.Count) {
    Write-Output 'Mini Hub private remote firewall rules are already absent.'
    return
  }
  $existing | Remove-NetFirewallRule
  Write-Output "Removed $($existing.Count) Mini Hub private remote firewall rule(s)."
}

switch ($Action) {
  'status' { Show-Status }
  'install' { Install-Rules }
  'remove' { Remove-Rules }
}
