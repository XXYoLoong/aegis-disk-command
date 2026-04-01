param(
  [Parameter(Mandatory = $true)]
  [string]$DriveLetter,
  [int]$RootLimit = 12,
  [int]$FocusLimit = 4,
  [int]$ChildLimit = 8,
  [int]$FileLimit = 8
)

$ErrorActionPreference = 'Stop'
try { chcp 65001 > $null } catch {}
try { [Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false) } catch {}
try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false) } catch {}
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $projectRoot '.runtime'
$sourcePath = Join-Path $PSScriptRoot 'FastScanner.cs'
$assemblyPath = Join-Path $runtimeRoot 'FastScanner.dll'

New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null

$shouldCompile =
  -not (Test-Path -LiteralPath $assemblyPath) -or
  (Get-Item -LiteralPath $sourcePath).LastWriteTimeUtc -gt (Get-Item -LiteralPath $assemblyPath).LastWriteTimeUtc

if ($shouldCompile) {
  Remove-Item -LiteralPath $assemblyPath -Force -ErrorAction SilentlyContinue
  Add-Type `
    -Path $sourcePath `
    -ReferencedAssemblies @('System.dll', 'System.Core.dll', 'System.Web.Extensions.dll') `
    -OutputAssembly $assemblyPath `
    -OutputType Library
}

[System.Reflection.Assembly]::LoadFrom($assemblyPath) | Out-Null
[DiskCommand.FastScanner]::Run($DriveLetter, $RootLimit, $FocusLimit, $ChildLimit, $FileLimit)
