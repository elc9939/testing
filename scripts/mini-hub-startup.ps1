param(
  [ValidateSet('install', 'remove', 'status', 'run-now')]
  [string]$Action = 'status',
  [ValidateSet('local', 'lan')]
  [string]$Profile = 'local',
  [switch]$HubUi,
  [string]$BridgeToken = '',
  [string]$RemoteHost = '',
  [string]$ExtraTrustedOrigins = ''
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$TaskName = 'Mini Hub Bridge'
$BridgeScript = Join-Path $PSScriptRoot 'mini-hub-bridge.ps1'
$StartupFolder = [Environment]::GetFolderPath([Environment+SpecialFolder]::Startup)
$StartupCommandFile = Join-Path $StartupFolder 'Mini Hub Bridge.cmd'

function Get-Task {
  return Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
}

function Show-TaskStatus {
  $task = Get-Task
  if (-not $task -and -not (Test-Path $StartupCommandFile)) {
    Write-Output "Mini Hub Bridge startup is not installed."
    return
  }

  if ($task) {
    $info = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
    [pscustomobject]@{
      Type = 'Scheduled Task'
      Task = $task.TaskName
      State = $task.State
      LastRun = $info.LastRunTime
      LastResult = $info.LastTaskResult
      NextRun = $info.NextRunTime
      Action = $task.Actions.Execute
      Arguments = $task.Actions.Arguments
    } | Format-List
  }

  if (Test-Path $StartupCommandFile) {
    [pscustomobject]@{
      Type = 'Startup Folder'
      File = $StartupCommandFile
      State = 'Installed for this Windows user'
    } | Format-List
  }
}

function Install-StartupCommandFile {
  if (-not (Test-Path $StartupFolder)) {
    New-Item -ItemType Directory -Path $StartupFolder -Force | Out-Null
  }

  $hubUiArg = if ($HubUi) { ' -HubUi' } else { '' }
  $bridgeTokenArg = if ($BridgeToken) { " -BridgeToken `"$BridgeToken`"" } else { '' }
  $remoteHostArg = if ($RemoteHost) { " -RemoteHost `"$RemoteHost`"" } else { '' }
  $extraOriginsArg = if ($ExtraTrustedOrigins) { " -ExtraTrustedOrigins `"$ExtraTrustedOrigins`"" } else { '' }
  $command = "@echo off`r`nstart `"`" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$BridgeScript`" start -Profile $Profile$hubUiArg$bridgeTokenArg$remoteHostArg$extraOriginsArg`r`n"
  Set-Content -LiteralPath $StartupCommandFile -Value $command -Encoding ASCII
  Write-Output "Installed Mini Hub Bridge startup entry in the current user's Startup folder."
}

function Install-Task {
  if (-not (Test-Path $BridgeScript)) {
    throw "Bridge script not found at $BridgeScript"
  }

  $arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$BridgeScript`" start -Profile $Profile"
  if ($HubUi) { $arguments += ' -HubUi' }
  if ($BridgeToken) { $arguments += " -BridgeToken `"$BridgeToken`"" }
  if ($RemoteHost) { $arguments += " -RemoteHost `"$RemoteHost`"" }
  if ($ExtraTrustedOrigins) { $arguments += " -ExtraTrustedOrigins `"$ExtraTrustedOrigins`"" }
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory $Root
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Hours 0)
  $principal = New-ScheduledTaskPrincipal `
    -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive `
    -RunLevel Limited

  try {
    Register-ScheduledTask `
      -TaskName $TaskName `
      -Action $action `
      -Trigger $trigger `
      -Settings $settings `
      -Principal $principal `
      -Description 'Starts the Mini Hub local bridge services after Windows login.' `
      -Force | Out-Null

    Write-Output "Installed Mini Hub Bridge startup task for profile '$Profile'."
  } catch {
    Write-Output "Scheduled Task install was not allowed in this shell: $($_.Exception.Message)"
    Install-StartupCommandFile
  }
}

function Remove-Task {
  $task = Get-Task
  $removed = $false
  if ($task) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Output 'Removed Mini Hub Bridge startup task.'
    $removed = $true
  }
  if (Test-Path $StartupCommandFile) {
    Remove-Item -LiteralPath $StartupCommandFile -Force
    Write-Output 'Removed Mini Hub Bridge Startup folder entry.'
    $removed = $true
  }
  if (-not $removed) {
    Write-Output "Mini Hub Bridge startup is already absent."
  }
}

switch ($Action) {
  'install' {
    Install-Task
    Show-TaskStatus
  }
  'remove' {
    Remove-Task
  }
  'status' {
    Show-TaskStatus
  }
  'run-now' {
    $task = Get-Task
    if (-not $task) {
      Install-Task
    }
    $task = Get-Task
    if ($task) {
      Start-ScheduledTask -TaskName $TaskName
      Write-Output 'Started Mini Hub Bridge startup task.'
    } else {
      $bridgeArgs = @('start', '-Profile', $Profile)
      if ($HubUi) { $bridgeArgs += '-HubUi' }
      if ($BridgeToken) { $bridgeArgs += @('-BridgeToken', $BridgeToken) }
      if ($RemoteHost) { $bridgeArgs += @('-RemoteHost', $RemoteHost) }
      if ($ExtraTrustedOrigins) { $bridgeArgs += @('-ExtraTrustedOrigins', $ExtraTrustedOrigins) }
      & powershell -NoProfile -ExecutionPolicy Bypass -File $BridgeScript @bridgeArgs
    }
    Start-Sleep -Seconds 2
    Show-TaskStatus
  }
}
