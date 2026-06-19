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
