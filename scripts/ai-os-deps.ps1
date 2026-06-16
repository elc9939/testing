param(
  [ValidateSet('audit', 'outdated', 'models')]
  [string]$Action = 'audit'
)

$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
$Node = 'C:\Users\Edward\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin'
if (Test-Path $Node) {
  $env:Path = "$Node;$env:Path"
}
$Pnpm = Join-Path $Root 'node_modules\.bin\pnpm.cmd'
$Python = Join-Path $Root 'apps\ai-os-api\.venv\Scripts\python.exe'

switch ($Action) {
  'audit' {
    if (Test-Path $Pnpm) { & $Pnpm audit --prod }
    if (Test-Path $Python) { & $Python -m pip list --outdated --format=json }
  }
  'outdated' {
    if (Test-Path $Pnpm) { & $Pnpm outdated -r }
    if (Test-Path $Python) { & $Python -m pip list --outdated }
  }
  'models' {
    if (Get-Command ollama -ErrorAction SilentlyContinue) { ollama list } else { Write-Output 'ollama command not found' }
  }
}
