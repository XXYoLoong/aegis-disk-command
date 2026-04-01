param(
  [Parameter(Mandatory = $true)]
  [string]$DriveLetter,
  [int]$RootLimit = 12,
  [int]$FocusLimit = 4,
  [int]$ChildLimit = 8,
  [int]$FileLimit = 8
)

$ErrorActionPreference = 'SilentlyContinue'
try { chcp 65001 > $null } catch {}
try { [Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false) } catch {}
try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false) } catch {}
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$root = "$DriveLetter`:\"

function Get-DirSize {
  param([string]$Path)

  $sum = (Get-ChildItem -LiteralPath $Path -Force -Recurse -File -ErrorAction SilentlyContinue |
    Measure-Object Length -Sum).Sum

  if ($null -eq $sum) { return 0 }
  return [int64]$sum
}

function New-Entry {
  param($Item, [int64]$SizeBytes)

  [PSCustomObject]@{
    name      = $Item.Name
    path      = $Item.FullName
    type      = if ($Item.PSIsContainer) { 'dir' } else { 'file' }
    sizeBytes = $SizeBytes
    extension = if ($Item.PSIsContainer) { $null } else { $Item.Extension }
  }
}

$rootItems = @(Get-ChildItem -LiteralPath $root -Force -ErrorAction SilentlyContinue)

$topEntries = @(
  foreach ($item in $rootItems) {
    if ($item.PSIsContainer) {
      New-Entry $item (Get-DirSize $item.FullName)
    }
    else {
      New-Entry $item ([int64]$item.Length)
    }
  }
) | Sort-Object sizeBytes -Descending | Select-Object -First $RootLimit

$focusDirectories = @(
  foreach ($dir in @($topEntries | Where-Object { $_.type -eq 'dir' } | Select-Object -First $FocusLimit)) {
    $children = @(
      foreach ($child in @(Get-ChildItem -LiteralPath $dir.path -Force -ErrorAction SilentlyContinue)) {
        if ($child.PSIsContainer) {
          New-Entry $child (Get-DirSize $child.FullName)
        }
        else {
          New-Entry $child ([int64]$child.Length)
        }
      }
    ) | Sort-Object sizeBytes -Descending | Select-Object -First $ChildLimit

    [PSCustomObject]@{
      name      = $dir.name
      path      = $dir.path
      sizeBytes = $dir.sizeBytes
      children  = @($children)
    }
  }
)

$notableFiles = @(
  $topEntries | Where-Object { $_.type -eq 'file' }
  foreach ($focus in $focusDirectories) {
    Get-ChildItem -LiteralPath $focus.path -Force -File -ErrorAction SilentlyContinue |
      Sort-Object Length -Descending |
      Select-Object -First 2 |
      ForEach-Object {
        [PSCustomObject]@{
          name      = $_.Name
          path      = $_.FullName
          type      = 'file'
          sizeBytes = [int64]$_.Length
          extension = $_.Extension
        }
      }
  }
) | Sort-Object sizeBytes -Descending | Select-Object -First $FileLimit

[PSCustomObject]@{
  drive            = $DriveLetter
  root             = $root
  topEntries       = @($topEntries)
  focusDirectories = @($focusDirectories)
  notableFiles     = @($notableFiles)
} | ConvertTo-Json -Depth 8 -Compress
