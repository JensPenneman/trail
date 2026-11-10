<#
.SYNOPSIS
  Prunes what Trail's source builds leave behind on the deploy host (Docker
  Desktop on Windows). Meant for Windows Task Scheduler; docs/operations.md
  ("Pruning build leftovers") has the registration command.

.DESCRIPTION
  Production and every preview push build `trail-local:<commit>` and
  `trail-local-predeploy-dump:<commit>` on the host, and Launchway never
  removes them. This script:

    1. removes `trail-local:*` and `trail-local-predeploy-dump:*` tags that no
       container uses, always keeping the four newest of each repository, and
       never forcing: an image a container uses survives, since docker refuses
       to remove it;
    2. removes dangling images with `docker image prune -f` (which spares
       images in use);
    3. caps the build cache with `docker builder prune -f --keep-storage 3GB`.

  It touches no other image, no volume and nothing named zeus*: tags are
  matched by exact repository name, and only the three commands above remove
  anything. It exits non-zero only when Docker is unreachable; a failed
  removal is logged and skipped.

.PARAMETER DryRun
  Only lists what would be removed; nothing is changed.

.PARAMETER LogFile
  Every log line is also appended here (the folder is created when missing).
  Set to an empty string for the console only.
#>
[CmdletBinding()]
param(
  [switch]$DryRun,
  [string]$LogFile = (Join-Path $env:ProgramData 'trail-prune\prune-build-artifacts.log')
)

# Native commands that fail are handled through $LASTEXITCODE; a non-zero exit
# or a line on stderr must not abort the script (Windows PowerShell 5.1 turns
# stderr into an error record under 'Stop').
$ErrorActionPreference = 'Continue'

$Repositories = @('trail-local', 'trail-local-predeploy-dump')
$KeepNewest = 4
$BuildCacheKeep = '3GB'

function Write-Log {
  param([string]$Message)
  $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK'), $Message
  Write-Output $line
  if ($LogFile) {
    try {
      $folder = Split-Path -Parent $LogFile
      if ($folder -and -not (Test-Path -LiteralPath $folder)) {
        $null = New-Item -ItemType Directory -Path $folder -Force
      }
      Add-Content -LiteralPath $LogFile -Value $line
    } catch {
      # the log file is a convenience; never let it stop the pruning
    }
  }
}

$mode = if ($DryRun) { 'dry run, nothing is removed' } else { 'live' }
Write-Log "prune-build-artifacts start ($mode)"

# Docker unreachable is the one failure that makes the task fail.
$null = & docker info 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Log 'ERROR: Docker is not reachable (docker info failed)'
  exit 1
}

# What containers (running or stopped) use, by image name and by image id.
$usedRefs = @{}
$usedIds = @{}
$containerIds = @(& docker ps -a -q 2>$null | Where-Object { $_ })
if ($containerIds.Count -gt 0) {
  foreach ($row in @(& docker inspect --format '{{.Config.Image}}|{{.Image}}' $containerIds 2>$null)) {
    $parts = "$row".Split('|')
    if ($parts.Count -eq 2) {
      $usedRefs[$parts[0]] = $true
      $usedIds[$parts[1]] = $true
    }
  }
}

function ConvertFrom-DockerTime {
  # '2026-11-10T18:20:00.123456789Z' -> UTC DateTime, to the second
  param([string]$Text)
  if ($Text -match '^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})') {
    return [datetime]::ParseExact($Matches[1], 'yyyy-MM-ddTHH:mm:ss', [Globalization.CultureInfo]::InvariantCulture)
  }
  return [datetime]::MinValue
}

# every tagged image once, with its creation time and id
$images = @()
foreach ($row in @(& docker image ls --format '{{.Repository}}|{{.Tag}}' 2>$null)) {
  $parts = "$row".Split('|')
  if ($parts.Count -ne 2) { continue }
  if ($Repositories -notcontains $parts[0]) { continue }   # exact match: any other image is left alone
  if ($parts[1] -eq '<none>') { continue }                 # dangling: the prune below handles it
  $ref = '{0}:{1}' -f $parts[0], $parts[1]
  $info = @(& docker image inspect --format '{{.Id}}|{{.Created}}' $ref 2>$null)
  if ($LASTEXITCODE -ne 0 -or $info.Count -eq 0) { continue }
  $f = "$($info[0])".Split('|')
  if ($f.Count -ne 2) { continue }
  $images += [pscustomobject]@{
    Repository = $parts[0]
    Ref        = $ref
    Id         = $f[0]
    Created    = ConvertFrom-DockerTime $f[1]
  }
}

foreach ($repo in $Repositories) {
  $mine = @($images | Where-Object { $_.Repository -eq $repo } | Sort-Object -Property Created, Ref -Descending)
  Write-Log ('{0}: {1} tag(s), keeping the {2} newest' -f $repo, $mine.Count, $KeepNewest)
  foreach ($image in @($mine | Select-Object -Skip $KeepNewest)) {
    if ($usedRefs.ContainsKey($image.Ref) -or $usedIds.ContainsKey($image.Id)) {
      Write-Log "keep $($image.Ref): a container uses it"
      continue
    }
    if ($DryRun) {
      Write-Log "would remove $($image.Ref)"
      continue
    }
    # no -f: docker refuses an image that a container still uses
    $null = & docker rmi $image.Ref 2>$null
    if ($LASTEXITCODE -eq 0) {
      Write-Log "removed $($image.Ref)"
    } else {
      Write-Log "kept $($image.Ref): docker refused to remove it (in use)"
    }
  }
}

# Dangling images: only through `docker image prune -f`, which spares any image
# a container uses.
if ($DryRun) {
  $dangling = @(& docker image ls --filter 'dangling=true' --format '{{.ID}}' 2>$null | Where-Object { $_ })
  Write-Log "would run: docker image prune -f ($($dangling.Count) dangling image(s) listed now)"
} else {
  Write-Log 'docker image prune -f'
  $out = @(& docker image prune -f 2>&1)
  $rc = $LASTEXITCODE
  foreach ($line in $out) { Write-Log "  $line" }
  if ($rc -ne 0) { Write-Log "WARNING: docker image prune exited with $rc" }
}

# Build cache: keep enough that a rollback rebuild of the previous production
# ref stays fast.
if ($DryRun) {
  Write-Log "would run: docker builder prune -f --keep-storage $BuildCacheKeep"
} else {
  Write-Log "docker builder prune -f --keep-storage $BuildCacheKeep"
  $out = @(& docker builder prune -f --keep-storage $BuildCacheKeep 2>&1)
  $rc = $LASTEXITCODE
  foreach ($line in $out) { Write-Log "  $line" }
  if ($rc -ne 0) { Write-Log "WARNING: docker builder prune exited with $rc" }
}

Write-Log 'prune-build-artifacts done'
exit 0
