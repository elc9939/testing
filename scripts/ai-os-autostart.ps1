param(
  [ValidateSet('install', 'uninstall', 'status')]
  [string]$Action = 'status',
  [switch]$StartNow
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$ApiDir = Join-Path $Root 'apps\ai-os-api'
$Python = Join-Path $ApiDir '.venv\Scripts\python.exe'
$SupervisorScript = Join-Path $PSScriptRoot 'ai-os-supervisor.ps1'
$TaskName = 'Mini Hub AI OS Supervisor'
$HealthUrl = 'http://127.0.0.1:8791/api/ai/health'
$StatusUrl = 'http://127.0.0.1:8791/api/ai/status'
$ServiceName = 'mini-hub-ai-os-api'

function Assert-Windows {
  if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {
    throw 'AI OS autostart uses Windows Task Scheduler and can only be installed on Windows.'
  }
}

function Assert-Inputs {
  if (-not (Test-Path $Python)) {
    throw "Missing AI OS venv Python at $Python. Create it with: cd apps\ai-os-api; python -m venv .venv; .venv\Scripts\python -m pip install -e .[test]"
  }
  if (-not (Test-Path $SupervisorScript)) {
    throw "Missing supervisor script at $SupervisorScript"
  }
}

function Get-AiOsTask {
  Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
}

function Test-AiOsApi {
  try {
    $health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 3
    return $health.service -eq $ServiceName
  } catch {
    return $false
  }
}

function Write-AiOsReadiness {
  try {
    $status = Invoke-RestMethod -Uri $StatusUrl -TimeoutSec 15
    $ollama = @($status.providers | Where-Object { $_.id -eq 'ollama' } | Select-Object -First 1)
    if ($ollama.Count -and $ollama[0].available) {
      $models = @($ollama[0].models)
      $suffix = if ($models.Count -eq 1) { '' } else { 's' }
      Write-Output "Ollama: ready ($($models.Count) model$suffix)"
    } elseif ($ollama.Count) {
      Write-Output "Ollama: not ready ($($ollama[0].error))"
    } else {
      Write-Output 'Ollama: not reported by AI OS'
    }

    $gpus = @($status.hardware.gpus)
    if ($gpus.Count) {
      $gpu = $gpus[0]
      $used = if ($null -ne $gpu.memory_used_mb) { [math]::Round([double]$gpu.memory_used_mb / 1024, 1) } else { $null }
      $total = if ($null -ne $gpu.memory_total_mb) { [math]::Round([double]$gpu.memory_total_mb / 1024, 1) } else { $null }
      $vram = if ($null -ne $used -and $null -ne $total) { "$used / $total GB VRAM" } else { 'VRAM n/a' }
      Write-Output "GPU: $($gpu.name) ($vram)"
    } else {
      $detail = if ($status.hardware.error) { $status.hardware.error } else { 'no GPU telemetry rows returned' }
      Write-Output "GPU: not ready ($detail)"
    }

    $loadedModels = @($status.hardware.loaded_models)
    if ($loadedModels.Count) {
      $modelSummary = ($loadedModels | ForEach-Object {
          $processor = if ($_.processor) { " - $($_.processor)" } else { '' }
          "$($_.name)$processor"
        }) -join ', '
      Write-Output "Model load: $modelSummary"
    } else {
      Write-Output 'Model load: none resident yet. The supervisor warmup should load the configured Ollama model after the next task restart/logon.'
    }
  } catch {
    Write-Output "Readiness detail unavailable: $($_.Exception.Message)"
  }
}

function Format-TaskResult([int]$Code) {
  if ($Code -eq 0) { return '0 (success)' }
  if ($Code -eq 267009) { return '267009 (currently running)' }
  return [string]$Code
}

function Write-Status {
  $task = Get-AiOsTask
  if (-not $task) {
    Write-Output 'AI OS autostart task is not installed.'
  } else {
    $info = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
    Write-Output "AI OS autostart task is installed. State: $($task.State)"
    if ($info) {
      Write-Output "Last run: $($info.LastRunTime)"
      Write-Output "Last result: $(Format-TaskResult $info.LastTaskResult)"
      Write-Output "Next run: $($info.NextRunTime)"
    }
  }

  if (Test-AiOsApi) {
    Write-Output 'AI OS API is reachable at http://127.0.0.1:8791'
    Write-AiOsReadiness
  } else {
    Write-Output 'AI OS API is not reachable at http://127.0.0.1:8791'
  }
}

function Install-AiOsTask {
  Assert-Windows
  Assert-Inputs

  $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  $actionArgs = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$SupervisorScript`""
  $taskAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $actionArgs -WorkingDirectory $Root
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Seconds 0)
  $principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
  $description = 'Starts and supervises the local Mini Hub AI OS API at Windows logon so GPU telemetry, Ollama status, and local AI tools are available when the hub opens.'

  Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $taskAction `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description $description `
    -Force | Out-Null

  Write-Output "Installed scheduled task '$TaskName' for $currentUser."
  if ($StartNow) {
    Start-ScheduledTask -TaskName $TaskName
    Start-Sleep -Seconds 4
  }
  Write-Status
}

function Uninstall-AiOsTask {
  Assert-Windows
  $task = Get-AiOsTask
  if (-not $task) {
    Write-Output 'AI OS autostart task is already absent.'
    return
  }
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Output "Removed scheduled task '$TaskName'."
  Write-Status
}

switch ($Action) {
  'install' { Install-AiOsTask }
  'uninstall' { Uninstall-AiOsTask }
  'status' {
    Assert-Windows
    Write-Status
  }
}
