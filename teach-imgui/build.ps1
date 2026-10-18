# build.ps1 - build, test and (optionally) self-test the native AFVI teaching app.
# Windows PowerShell 5.1 compatible: no &&, ||, ternary or ?? operators.
[CmdletBinding()]
param(
    [switch]$Selftest,
    [string]$Out = '',
    [switch]$Offline
)

$ErrorActionPreference = 'Stop'

# Always run from the script's own directory.
Set-Location -LiteralPath $PSScriptRoot
# $PSScriptRoot is empty inside param() defaults on Windows PowerShell 5.1, so resolve here.
if ($Out -eq '') { $Out = Join-Path $PSScriptRoot 'selftest-out' }

# --- Toolchain: MinGW-w64 (gcc) is required for cgo. -------------------------
$mingwBin = Join-Path $env:USERPROFILE 'scoop\apps\mingw\current\bin'
if (-not (Test-Path -LiteralPath $mingwBin)) {
    Write-Error "MinGW-w64 not found at $mingwBin. Install it with: scoop install mingw"
    exit 1
}
$env:PATH = $mingwBin + ';' + $env:PATH
$env:CGO_ENABLED = '1'

if ($Offline) {
    $env:GOPROXY = 'off'
    $env:GOFLAGS = '-mod=readonly'
}

# --- 1. gofmt ----------------------------------------------------------------
Write-Host '==> gofmt -l .'
$unformatted = & gofmt -l .
if ($LASTEXITCODE -ne 0) {
    Write-Error 'gofmt failed to run.'
    exit 1
}
if ($unformatted) {
    Write-Host 'The following files are not gofmt-clean:'
    $unformatted | ForEach-Object { Write-Host "  $_" }
    exit 1
}

# --- 2. go vet ---------------------------------------------------------------
Write-Host '==> go vet ./...'
& go vet ./...
if ($LASTEXITCODE -ne 0) {
    Write-Error 'go vet failed.'
    exit 1
}

# --- 3. core tests (pure Go, CGO_ENABLED has no effect) ----------------------
Write-Host '==> go test ./core/...'
& go test ./core/...
if ($LASTEXITCODE -ne 0) {
    Write-Error 'go test ./core/... failed.'
    exit 1
}

# --- 4. build ----------------------------------------------------------------
Write-Host '==> go build'
& go build -ldflags "-s -w -extldflags=-static" -o teach-imgui.exe .
if ($LASTEXITCODE -ne 0) {
    Write-Error 'go build failed.'
    exit 1
}

$exe = Join-Path $PSScriptRoot 'teach-imgui.exe'
$sizeMB = [math]::Round((Get-Item -LiteralPath $exe).Length / 1MB, 2)
Write-Host ("Built {0} ({1} MB)" -f $exe, $sizeMB)

# --- 5. optional self-test ---------------------------------------------------
if ($Selftest) {
    if (-not (Test-Path -LiteralPath $Out)) {
        New-Item -ItemType Directory -Path $Out -Force | Out-Null
    }
    Write-Host "==> selftest -> $Out"
    $raw = & $exe -selftest -out $Out
    if ($LASTEXITCODE -ne 0) {
        Write-Error 'selftest process exited with a non-zero code.'
        exit 1
    }
    $text = ($raw | Out-String)
    $metrics = $null
    try {
        $metrics = $text | ConvertFrom-Json
    } catch {
        Write-Error "Could not parse selftest output as JSON: $text"
        exit 1
    }
    $errCount = 0
    if ($null -ne $metrics.errors) {
        $errCount = @($metrics.errors).Count
    }
    $shotCount = 0
    if ($null -ne $metrics.screenshots) {
        $shotCount = @($metrics.screenshots).Count
    }
    Write-Host ("selftest: {0} errors, {1} screenshots" -f $errCount, $shotCount)
    if ($errCount -gt 0) {
        Write-Error 'selftest reported errors.'
        exit 1
    }
}

Write-Host 'OK'
