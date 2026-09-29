# sccache-heal.ps1 — Self-healing sccache daemon for Windows CI runners
#
# Dot-source this script before any `cargo` command on self-hosted Windows runners.
# It ensures the sccache daemon is alive and reachable. If the daemon is dead, hung,
# or unreachable (the "Failed to read response header" error), it kills the old one
# and starts a fresh instance.
#
# Non-fatal by design: if sccache is not installed or refuses to start,
# compilation proceeds without the cache — never blocks the pipeline.
#
# Usage:
#   . .github\scripts\sccache-heal.ps1
#   # or call the function directly:
#   Invoke-SccacheHeal

function Invoke-SccacheHeal {
    $ErrorActionPreference = 'Continue'

    # 1. Check if sccache is installed
    $sccache = Get-Command sccache -ErrorAction SilentlyContinue
    if (-not $sccache) {
        Write-Host "[sccache-heal] sccache not installed - skipping"
        return
    }

    # 2. Stop any existing daemon (may be dead/hung)
    Write-Host "[sccache-heal] Stopping any existing sccache daemon..."
    & sccache --stop-server 2>$null
    # Give the process time to die
    Start-Sleep -Milliseconds 500

    # 3. Kill any zombie sccache processes
    Get-Process -Name "sccache" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

    # 4. Clear potentially corrupted lock file
    $cacheDir = if ($env:SCCACHE_DIR) { $env:SCCACHE_DIR } else { Join-Path $env:LOCALAPPDATA "Mozilla\sccache" }
    $lockFile = Join-Path $cacheDir ".sccache_lock"
    if (Test-Path $lockFile) {
        Remove-Item $lockFile -Force -ErrorAction SilentlyContinue
    }

    # 5. Start a fresh daemon
    Write-Host "[sccache-heal] Starting fresh sccache daemon..."
    $startResult = & sccache --start-server 2>&1
    if ($LASTEXITCODE -eq 0) {
        $env:RUSTC_WRAPPER = "sccache"
        if ($env:GITHUB_ENV) {
            "RUSTC_WRAPPER=sccache" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8
        }
        Write-Host "[sccache-heal] Daemon started successfully"
        & sccache --show-stats 2>$null
    } else {
        Write-Host "::warning::[sccache-heal] Daemon gagal start - kompilasi tanpa cache"
        Write-Host "[sccache-heal] Start output: $startResult"
        $env:RUSTC_WRAPPER = ""
        if ($env:GITHUB_ENV) {
            "RUSTC_WRAPPER=" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8
        }
    }
}

# Auto-run when dot-sourced
Invoke-SccacheHeal
