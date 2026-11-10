<#
.SYNOPSIS
  Prunes what Trail's source builds leave behind on the deploy host (Docker
  Desktop on Windows). Meant for Windows Task Scheduler; docs/operations.md
  ("Pruning build leftovers") has the registration commands.

.DESCRIPTION
  Production and every preview push build `trail-local:<commit>` and
  `trail-local-predeploy-dump:<commit>` on the host, and Launchway never
  removes them. This script:

    1. removes `trail-local:*` and `trail-local-predeploy-dump:*` tags that no
       container uses, never forcing (an image in use survives). Per
       repository it keeps the newest 2 images built by the production
       Compose project (-ProductionProject), and apart from those the 4 newest
       of everything else (previews included), by creation time;
    2. removes dangling images of Trail's own only: one
       `docker image prune -f` per label filter, for the images of the runtime
       stage (label org.opencontainers.image.title=Trail) and for the dump
       image (label com.docker.compose.service=predeploy-dump); prune spares
       images in use;
    3. caps the build cache with `docker builder prune -f --max-used-space 3GB`.
       The cache cannot be limited to one project: this trims the whole
       builder, least recently used first, so it is the one step that is not
       scoped to Trail.

  Steps 1 and 2 touch no image other than Trail's, no volume and nothing named
  zeus*: tags are matched by exact repository name, and prunes are filtered by
  label. A removal that docker refuses (in use) is logged and skipped. The exit
  code is non-zero when Docker is unreachable, when the list of containers or
  images cannot be read (nothing is removed then), or when a prune command
  fails, so Task Scheduler's Last Run Result shows it.

.PARAMETER DryRun
  Only lists what would be removed; nothing in Docker is changed.

.PARAMETER ProductionProject
  The Compose project of production, whose newest 2 images are always kept.

.PARAMETER LogFile
  Every log line is also appended here (the folder is created when missing).
  Set to an empty string for the console only.
#>
[CmdletBinding()]
param(
  [switch]$DryRun,
  [string]$ProductionProject = 'launchway-trail',
  [string]$LogFile = (Join-Path $env:ProgramData 'trail-prune\prune-build-artifacts.log')
)

# Native commands that fail are handled through $LASTEXITCODE; a non-zero exit
# or a line on stderr must not abort the script (Windows PowerShell 5.1 turns
# stderr into an error record under 'Stop').
$ErrorActionPreference = 'Continue'

$Repositories = @('trail-local', 'trail-local-predeploy-dump')
$KeepProduction = 2
$KeepOthers = 4
$BuildCacheMax = '3GB'
# one prune per filter: several --filter label= options are ANDed
$PruneLabels = @(
  'org.opencontainers.image.title=Trail',
  'com.docker.compose.service=predeploy-dump'
)
$failed = $false

function Write-Log {
  param([string]$Message)
  $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK'), $Message
  Write-Output $line
  if ($LogFile) {
    try {
      $folder = Split-Path -Parent $LogFile
      if ($folder -and -not (Test-Path -LiteralPath $folder)) {
        $null = New-Item -ItemType Directory -Path $folder -Force -ErrorAction Stop
      }
      # -ErrorAction Stop: without it a denied write is not terminating and
      # the catch below would never run
      Add-Content -LiteralPath $LogFile -Value $line -ErrorAction Stop
    } catch {
      # the log file is a convenience; the console line above is still written
    }
  }
}

$mode = if ($DryRun) { 'dry run, nothing is removed' } else { 'live' }
Write-Log "prune-build-artifacts start ($mode)"

# Docker unreachable (or not on PATH: $LASTEXITCODE stays $null) fails the task.
$null = & docker info 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Log 'ERROR: Docker is not reachable (docker info failed)'
  exit 1
}

# What containers (running or stopped) use, by image name and by image id. If
# they cannot be read, nothing is removed: an empty set would make every image
# look unused.
$usedRefs = @{}
$usedIds = @{}
$containerIds = @(& docker ps -a -q 2>$null | Where-Object { $_ })
if ($LASTEXITCODE -ne 0) {
  Write-Log 'ERROR: docker ps failed; removing nothing'
  exit 1
}
if ($containerIds.Count -gt 0) {
  $rows = @(& docker inspect --format '{{.Config.Image}}|{{.Image}}' $containerIds 2>$null)
  if ($LASTEXITCODE -ne 0 -or $rows.Count -eq 0) {
    Write-Log 'ERROR: docker inspect of the containers returned nothing; removing nothing'
    exit 1
  }
  foreach ($row in $rows) {
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

function Get-ImageRefs {
  # 'repo:tag' of the images matching docker image ls filters; $null on failure
  param([string[]]$Filters)
  $out = @(& docker image ls @Filters --format '{{.Repository}}|{{.Tag}}' 2>$null)
  if ($LASTEXITCODE -ne 0) { return $null }
  $refs = @()
  foreach ($row in $out) {
    $parts = "$row".Split('|')
    if ($parts.Count -ne 2 -or $parts[1] -eq '<none>') { continue }   # dangling: the prune below handles it
    $refs += ('{0}:{1}' -f $parts[0], $parts[1])
  }
  # the comma keeps an empty list from collapsing to $null (the failure value)
  return ,$refs
}

function Get-ImageInfo {
  # id and creation time of one tag, or $null
  param([string]$Ref)
  $info = @(& docker image inspect --format '{{.Id}}|{{.Created}}' $Ref 2>$null)
  if ($LASTEXITCODE -ne 0 -or $info.Count -eq 0) { return $null }
  $f = "$($info[0])".Split('|')
  if ($f.Count -ne 2) { return $null }
  return [pscustomobject]@{ Ref = $Ref; Id = $f[0]; Created = ConvertFrom-DockerTime $f[1] }
}

foreach ($repo in $Repositories) {
  # exact repository: the reference filter matches whole names, and the
  # repository is checked again below, so no other image is ever a candidate
  $all = Get-ImageRefs @('--filter', "reference=${repo}:*")
  $prod = Get-ImageRefs @('--filter', "reference=${repo}:*", '--filter', "label=com.docker.compose.project=$ProductionProject")
  if ($null -eq $all -or $null -eq $prod) {
    Write-Log "ERROR: cannot list the images of ${repo}; removing none of them"
    $failed = $true
    continue
  }
  $images = @()
  foreach ($ref in @($all | Where-Object { $_.StartsWith("${repo}:") })) {
    $info = Get-ImageInfo $ref
    if ($info) { $images += $info }
  }
  $sorted = @($images | Sort-Object -Property Created, Ref -Descending)
  $keepProd = @($sorted | Where-Object { $prod -contains $_.Ref } | Select-Object -First $KeepProduction)
  $rest = @($sorted | Where-Object { $keepProd.Ref -notcontains $_.Ref })
  $keepOthers = @($rest | Select-Object -First $KeepOthers)
  Write-Log ('{0}: {1} tag(s); keeping {2} newest of project {3} and {4} newest of the rest' -f $repo, $sorted.Count, $keepProd.Count, $ProductionProject, $keepOthers.Count)
  foreach ($image in @($rest | Select-Object -Skip $KeepOthers)) {
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

# Dangling images of Trail's own, by label; prune spares images in use.
foreach ($label in $PruneLabels) {
  if ($DryRun) {
    $dangling = @(& docker image ls --filter 'dangling=true' --filter "label=$label" --format '{{.ID}}' 2>$null | Where-Object { $_ })
    Write-Log "would run: docker image prune -f --filter label=$label ($($dangling.Count) dangling image(s) listed now)"
    continue
  }
  Write-Log "docker image prune -f --filter label=$label"
  $out = @(& docker image prune -f --filter "label=$label" 2>&1)
  $rc = $LASTEXITCODE
  foreach ($line in $out) { Write-Log "  $line" }
  if ($rc -ne 0) {
    Write-Log "ERROR: docker image prune exited with $rc"
    $failed = $true
  }
}

# Build cache: the whole builder, not Trail's alone (no per-project filter).
if ($DryRun) {
  Write-Log "would run: docker builder prune -f --max-used-space $BuildCacheMax"
} else {
  Write-Log "docker builder prune -f --max-used-space $BuildCacheMax"
  $out = @(& docker builder prune -f --max-used-space $BuildCacheMax 2>&1)
  $rc = $LASTEXITCODE
  foreach ($line in $out) { Write-Log "  $line" }
  if ($rc -ne 0) {
    Write-Log "ERROR: docker builder prune exited with $rc"
    $failed = $true
  }
}

Write-Log 'prune-build-artifacts done'
if ($failed) { exit 1 }
exit 0
