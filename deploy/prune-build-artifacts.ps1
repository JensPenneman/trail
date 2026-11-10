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
  images of a repository cannot be read (nothing is removed then, or nothing of
  that repository), when a prune command fails, or on any unexpected error
  (every error is terminating and caught once at the top, logged as an ERROR
  line), so Task Scheduler's Last Run Result shows it. A dry run fails the same
  way.

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

# Every error is terminating, and the whole run is caught once at the bottom:
# an unexpected failure must end the run with an ERROR line and exit code 1,
# never with a quiet 0. Native commands report through $LASTEXITCODE, which is
# checked after each one; their stderr is discarded (2>$null) or, where the
# output is logged, read with the preference lowered (Invoke-DockerLogged),
# since Windows PowerShell 5.1 turns redirected stderr into error records.
# PowerShell variable names ignore case: no two names below may differ only by
# case (a kept list once overwrote a constant that way).
$ErrorActionPreference = 'Stop'

$Repositories = @('trail-local', 'trail-local-predeploy-dump')
$KeepProductionCount = 2
$KeepOtherCount = 4
$BuildCacheMax = '3GB'
# one prune per filter: several --filter label= options are ANDed
$PruneLabels = @(
  'org.opencontainers.image.title=Trail',
  'com.docker.compose.service=predeploy-dump'
)
$failed = $false
$dockerRc = 0

function Write-Log {
  param([string]$Message)
  $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK'), $Message
  # Write-Host, not Write-Output: the functions' output is their return value
  Write-Host $line
  if ($LogFile) {
    try {
      $folder = Split-Path -Parent $LogFile
      if ($folder -and -not (Test-Path -LiteralPath $folder)) {
        $null = New-Item -ItemType Directory -Path $folder -Force
      }
      Add-Content -LiteralPath $LogFile -Value $line
    } catch {
      # the log file is a convenience; the console line above is still written
    }
  }
}

function Invoke-DockerLogged {
  # runs docker with stderr merged into the output; the exit code is left in
  # $script:dockerRc; returns the output lines
  param([string[]]$DockerArgs)
  $saved = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $lines = @(& docker @DockerArgs 2>&1)
    $script:dockerRc = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $saved
  }
  return , $lines
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
  $listed = @(& docker image ls @Filters --format '{{.Repository}}|{{.Tag}}' 2>$null)
  if ($LASTEXITCODE -ne 0) { return $null }
  $found = @()
  foreach ($row in $listed) {
    $parts = "$row".Split('|')
    if ($parts.Count -ne 2 -or $parts[1] -eq '<none>') { continue }   # dangling: the prune below handles it
    $found += ('{0}:{1}' -f $parts[0], $parts[1])
  }
  # the comma keeps an empty list from collapsing to $null (the failure value)
  return , $found
}

function Get-ImageInfo {
  # id and creation time of one tag, or $null
  param([string]$TagName)
  $info = @(& docker image inspect --format '{{.Id}}|{{.Created}}' $TagName 2>$null)
  if ($LASTEXITCODE -ne 0 -or $info.Count -eq 0) { return $null }
  $fields = "$($info[0])".Split('|')
  if ($fields.Count -ne 2) { return $null }
  return [pscustomobject]@{ Tag = $TagName; Id = $fields[0]; Created = ConvertFrom-DockerTime $fields[1] }
}

function Invoke-Prune {
  $mode = if ($DryRun) { 'dry run, nothing is removed' } else { 'live' }
  # the account is in the line so that a run's log shows who wrote it
  $account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  Write-Log "prune-build-artifacts start ($mode) as $account"

  # Docker unreachable fails the task.
  $null = & docker info 2>$null
  if ($LASTEXITCODE -ne 0) {
    Write-Log 'ERROR: Docker is not reachable (docker info failed)'
    return 1
  }

  # What containers (running or stopped) use, by image name and by image id. If
  # they cannot be read, nothing is removed: an empty set would make every
  # image look unused.
  $usedNames = @{}
  $usedIds = @{}
  $containerIds = @(& docker ps -a -q 2>$null | Where-Object { $_ })
  if ($LASTEXITCODE -ne 0) {
    Write-Log 'ERROR: docker ps failed; removing nothing'
    return 1
  }
  if ($containerIds.Count -gt 0) {
    $rows = @(& docker inspect --format '{{.Config.Image}}|{{.Image}}' $containerIds 2>$null)
    if ($LASTEXITCODE -ne 0 -or $rows.Count -eq 0) {
      Write-Log 'ERROR: docker inspect of the containers returned nothing; removing nothing'
      return 1
    }
    foreach ($row in $rows) {
      $parts = "$row".Split('|')
      if ($parts.Count -eq 2) {
        $usedNames[$parts[0]] = $true
        $usedIds[$parts[1]] = $true
      }
    }
  }

  foreach ($repo in $Repositories) {
    # exact repository: the reference filter matches whole names, and the
    # prefix is checked again below, so no other image is ever a candidate
    $allTags = Get-ImageRefs @('--filter', "reference=${repo}:*")
    $prodTags = Get-ImageRefs @('--filter', "reference=${repo}:*", '--filter', "label=com.docker.compose.project=$ProductionProject")
    if ($null -eq $allTags -or $null -eq $prodTags) {
      Write-Log "ERROR: cannot list the images of ${repo}; removing none of them"
      $script:failed = $true
      continue
    }
    $candidates = @()
    foreach ($tagRef in @($allTags | Where-Object { $_.StartsWith("${repo}:") })) {
      $info = Get-ImageInfo $tagRef
      if ($info) { $candidates += $info }
    }
    $sorted = @($candidates | Sort-Object -Property Created, Tag -Descending)
    $keptProd = @($sorted | Where-Object { $prodTags -contains $_.Tag } | Select-Object -First $KeepProductionCount)
    $keptProdTags = @($keptProd | ForEach-Object { $_.Tag })
    $others = @($sorted | Where-Object { $keptProdTags -notcontains $_.Tag })
    $keptOthers = @($others | Select-Object -First $KeepOtherCount)
    Write-Log ('{0}: {1} tag(s); keeping {2} newest of project {3} and {4} newest of the rest' -f $repo, $sorted.Count, $keptProd.Count, $ProductionProject, $keptOthers.Count)
    foreach ($keptImage in $keptProd) { Write-Log "keep $($keptImage.Tag): newest of project $ProductionProject" }
    foreach ($keptImage in $keptOthers) { Write-Log "keep $($keptImage.Tag): among the $KeepOtherCount newest of the rest" }
    foreach ($image in @($others | Select-Object -Skip $KeepOtherCount)) {
      if ($usedNames.ContainsKey($image.Tag) -or $usedIds.ContainsKey($image.Id)) {
        Write-Log "keep $($image.Tag): a container uses it"
        continue
      }
      if ($DryRun) {
        Write-Log "would remove $($image.Tag)"
        continue
      }
      # no -f: docker refuses an image that a container still uses
      $null = & docker rmi $image.Tag 2>$null
      if ($LASTEXITCODE -eq 0) {
        Write-Log "removed $($image.Tag)"
      } else {
        Write-Log "kept $($image.Tag): docker refused to remove it (in use)"
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
    $output = Invoke-DockerLogged @('image', 'prune', '-f', '--filter', "label=$label")
    foreach ($outLine in $output) { Write-Log "  $outLine" }
    if ($script:dockerRc -ne 0) {
      Write-Log "ERROR: docker image prune exited with $($script:dockerRc)"
      $script:failed = $true
    }
  }

  # Build cache: the whole builder, not Trail's alone (no per-project filter).
  if ($DryRun) {
    Write-Log "would run: docker builder prune -f --max-used-space $BuildCacheMax"
  } else {
    Write-Log "docker builder prune -f --max-used-space $BuildCacheMax"
    $output = Invoke-DockerLogged @('builder', 'prune', '-f', '--max-used-space', $BuildCacheMax)
    foreach ($outLine in $output) { Write-Log "  $outLine" }
    if ($script:dockerRc -ne 0) {
      Write-Log "ERROR: docker builder prune exited with $($script:dockerRc)"
      $script:failed = $true
    }
  }

  Write-Log 'prune-build-artifacts done'
  if ($script:failed) { return 1 }
  return 0
}

$exitCode = 1
try {
  $exitCode = Invoke-Prune
} catch {
  Write-Log ('ERROR: unexpected: {0} (line {1})' -f $_.Exception.Message, $_.InvocationInfo.ScriptLineNumber)
  $exitCode = 1
}
exit $exitCode
