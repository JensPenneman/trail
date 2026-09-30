<#
.SYNOPSIS
  Creates deploy\.env for a new Trail server from deploy\.env.example.

.DESCRIPTION
  Copies .env.example to .env, sets POSTGRES_PASSWORD to 32 random bytes
  (64 hex characters) and INGEST_BASE_URL to this computer's address on the
  home network, then lists what is left to fill in. An existing .env is only
  replaced with -Force: a new POSTGRES_PASSWORD does not change the password
  of a database that already exists.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File C:\trail\deploy\windows\new-env.ps1
#>
[CmdletBinding()]
param(
    [switch] $Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$deployDir = Split-Path -Parent $PSScriptRoot
$example = Join-Path $deployDir '.env.example'
$target = Join-Path $deployDir '.env'

if (-not (Test-Path -LiteralPath $example)) {
    throw "Not found: $example"
}
if ((Test-Path -LiteralPath $target) -and -not $Force) {
    throw "$target already exists. Edit it, or run again with -Force to replace it (the database keeps its current password)."
}

# 32 bytes from the OS cryptographic generator, as lowercase hex: URL-safe,
# because the password becomes part of the app's connection string
$bytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try {
    $rng.GetBytes($bytes)
}
finally {
    $rng.Dispose()
}
$password = -join ($bytes | ForEach-Object { $_.ToString('x2') })

# The IPv4 address Windows would use to reach the internet: the Wi-Fi or
# Ethernet adapter, not one of the virtual adapters of WSL or Hyper-V
$lanIp = $null
try {
    $source = Find-NetRoute -RemoteIPAddress '1.1.1.1' |
        Where-Object { $null -ne $_.PSObject.Properties['IPAddress'] } |
        Select-Object -First 1
    if ($null -ne $source) {
        $lanIp = $source.IPAddress
    }
}
catch {
    $lanIp = $null
}

$text = [System.IO.File]::ReadAllText($example)
$text = $text -replace '(?m)^POSTGRES_PASSWORD=[^\r\n]*', "POSTGRES_PASSWORD=$password"
if ($null -ne $lanIp) {
    $text = $text -replace '(?m)^INGEST_BASE_URL=[^\r\n]*', "INGEST_BASE_URL=http://${lanIp}:8080"
}

# UTF-8 without a byte order mark, which Docker Compose would read as part of
# the first line
$utf8 = New-Object System.Text.UTF8Encoding -ArgumentList $false
[System.IO.File]::WriteAllText($target, $text, $utf8)

Write-Host "Created $target"
Write-Host '  POSTGRES_PASSWORD  generated'
if ($null -ne $lanIp) {
    Write-Host "  INGEST_BASE_URL    http://${lanIp}:8080 (reserve this address for the laptop in the router)"
}
else {
    Write-Warning 'Could not detect the LAN address: set INGEST_BASE_URL in .env yourself.'
}
Write-Host ''
Write-Host 'Still to do in .env: SIGNUP_ALLOWLIST (your e-mail address) and BACKUP_DIR.'
Write-Host "Then, in $deployDir :  docker compose up -d"
