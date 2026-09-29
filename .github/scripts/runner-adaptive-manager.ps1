<#
.SYNOPSIS
    Runner Adaptive Manager -- Manajemen runner GitHub Actions otomatis berdasarkan beban.

.DESCRIPTION
    Script ini mengoptimalkan performa runner berdasarkan jumlah task di antrian:
    - BANYAK TASK (>= threshold): Nyalakan SEMUA runner -> distribusi paralel maksimal
    - SEDIKIT TASK (< threshold): Hanya nyalakan runner minimal -> performa terpusat,
      hemat resource

    Juga termasuk sccache daemon health check dan auto-restart.

.PARAMETER Mode
    'check'   - Cek status saja (default)
    'scale'   - Auto-scale runner berdasarkan beban
    'heal'    - Restart sccache daemon di semua runner aktif
    'wake'    - Paksa nyalakan semua runner
    'sleep'   - Matikan runner yang idle (hanya sisakan minimum)

.PARAMETER MinRunners
    Jumlah minimum runner yang harus aktif (default: 2)

.PARAMETER ScaleThreshold
    Jumlah queued workflow yang memicu scale-up penuh (default: 3)

.PARAMETER Token
    GitHub Personal Access Token (baca dari env GITHUB_TOKEN jika tidak disediakan)

.EXAMPLE
    .\runner-adaptive-manager.ps1 -Mode check
    .\runner-adaptive-manager.ps1 -Mode scale -MinRunners 2 -ScaleThreshold 3
    .\runner-adaptive-manager.ps1 -Mode heal
#>

param(
    [ValidateSet('check', 'scale', 'heal', 'wake', 'sleep')]
    [string]$Mode = 'check',

    [int]$MinRunners = 2,
    [int]$ScaleThreshold = 3,

    [string]$Token = $env:GITHUB_TOKEN,
    [string]$Repo = "Catzpro01/n8n-rust-v.4"
)

$ErrorActionPreference = 'Stop'

# --- Konfigurasi Runner -------------------------------------------------------
# Runner dikelompokkan berdasarkan tier prioritas:
# Tier 1 (Always On)  : Runner utama yang selalu nyala
# Tier 2 (Scale Out)  : Runner cadangan yang dinyalakan saat beban tinggi
# Tier 3 (Burst Only) : Runner burst yang hanya dinyalakan saat antrian sangat panjang

$RunnerConfig = @{
    Windows = @{
        Tier1 = @("laptop-build-worker", "laptop-build-worker-2")
        Tier2 = @("laptop-build-worker-3", "laptop-build-worker-4")
        Tier3 = @("laptop-build-worker-5")
        ServicePrefix = "actions.runner"
        ServiceSuffix = ""
    }
    Linux = @{
        Tier1 = @("MDMTEST-n8n-wsl", "MDMTEST-n8n-wsl-2")
        Tier2 = @("MDMTEST-n8n-wsl-3", "MDMTEST-n8n-wsl-4b")
        Tier3 = @("MDMTEST-n8n-wsl-5")
    }
}

# --- Helper Functions ----------------------------------------------------------

function Get-GHHeaders {
    if (-not $Token) {
        throw "Token GitHub tidak ditemukan. Set GITHUB_TOKEN atau gunakan parameter -Token"
    }
    @{
        "Authorization" = "token $Token"
        "Accept" = "application/vnd.github.v3+json"
    }
}

function Get-RunnerStatus {
    $headers = Get-GHHeaders
    $resp = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/actions/runners" -Headers $headers
    return $resp
}

function Get-QueuedRuns {
    $headers = Get-GHHeaders
    $resp = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/actions/runs?status=queued&per_page=30" -Headers $headers
    return $resp
}

function Get-InProgressRuns {
    $headers = Get-GHHeaders
    $resp = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/actions/runs?status=in_progress&per_page=30" -Headers $headers
    return $resp
}

function Start-WSLRunner {
    param([string]$RunnerName)
    Write-Host "  [WAKE] Menyalakan WSL runner: $RunnerName" -ForegroundColor Green

    $suffix = $RunnerName -replace "MDMTEST-n8n-wsl-?", ""
    $runnerDir = if ($suffix) { "~/actions-runner-$suffix" } else { "~/actions-runner" }

    try {
        wsl.exe -- bash -c "cd $runnerDir && nohup ./run.sh > /tmp/$RunnerName.log 2>&1 &"
        Write-Host "  [OK] Runner $RunnerName dimulai" -ForegroundColor Green
    } catch {
        Write-Host "  [FAIL] Gagal menyalakan ${RunnerName}: $_" -ForegroundColor Red
    }
}

function Start-WindowsRunner {
    param([string]$RunnerName)
    Write-Host "  [WAKE] Menyalakan Windows runner: $RunnerName" -ForegroundColor Green

    $serviceName = "actions.runner.${Repo}.${RunnerName}" -replace "/", "."
    $svc = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($svc) {
        if ($svc.Status -ne 'Running') {
            Start-Service $serviceName
            Write-Host "  [OK] Service $serviceName started" -ForegroundColor Green
        } else {
            Write-Host "  [SKIP] Service $serviceName sudah running" -ForegroundColor Yellow
        }
        return
    }

    $runnerDirs = @(
        "C:\actions-runner-$($RunnerName -replace 'laptop-build-worker-?','')",
        "C:\actions-runner",
        "$env:USERPROFILE\actions-runner"
    )
    foreach ($dir in $runnerDirs) {
        if (Test-Path "$dir\run.cmd") {
            Start-Process -FilePath "$dir\run.cmd" -WindowStyle Hidden
            Write-Host "  [OK] Runner $RunnerName dimulai dari $dir" -ForegroundColor Green
            return
        }
    }
    Write-Host "  [WARN] Tidak menemukan direktori runner untuk $RunnerName" -ForegroundColor Yellow
}

function Stop-WindowsRunner {
    param([string]$RunnerName)
    Write-Host "  [SLEEP] Menghentikan Windows runner: $RunnerName" -ForegroundColor Cyan

    $serviceName = "actions.runner.${Repo}.${RunnerName}" -replace "/", "."
    $svc = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($svc -and $svc.Status -eq 'Running') {
        Stop-Service $serviceName
        Write-Host "  [OK] Service $serviceName stopped" -ForegroundColor Cyan
    }
}

function Heal-Sccache {
    Write-Host "`n--- Sccache Health Check ---" -ForegroundColor Magenta

    $sccache = Get-Command sccache -ErrorAction SilentlyContinue
    if (-not $sccache) {
        Write-Host "  sccache tidak terinstall di host ini" -ForegroundColor Yellow
        return
    }

    Write-Host "  Stopping existing daemon..."
    $ErrorActionPreference = 'SilentlyContinue'
    & sccache --stop-server 2>$null | Out-Null
    $ErrorActionPreference = 'Stop'
    Start-Sleep -Milliseconds 500

    Get-Process -Name "sccache" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

    Write-Host "  Starting fresh daemon..."
    $ErrorActionPreference = 'SilentlyContinue'
    $result = & sccache --start-server 2>&1
    $startCode = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($startCode -eq 0) {
        $env:RUSTC_WRAPPER = "sccache"
        Write-Host "  [OK] sccache daemon aktif" -ForegroundColor Green
        & sccache --show-stats 2>$null
    } else {
        Write-Host "  [FAIL] sccache daemon gagal start: $result" -ForegroundColor Red
        $env:RUSTC_WRAPPER = ""
    }
}

# --- Mode Handlers -------------------------------------------------------------

function Show-Status {
    Write-Host "`n========================================================" -ForegroundColor Cyan
    Write-Host " Runner Adaptive Manager -- Status Report" -ForegroundColor Cyan
    Write-Host " $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')" -ForegroundColor DarkGray
    Write-Host "========================================================" -ForegroundColor Cyan

    $runners = Get-RunnerStatus
    $queued = Get-QueuedRuns
    $inProgress = Get-InProgressRuns

    $online = @($runners.runners | Where-Object { $_.status -eq 'online' }).Count
    $offline = @($runners.runners | Where-Object { $_.status -eq 'offline' }).Count
    $busy = @($runners.runners | Where-Object { $_.busy -eq $true }).Count
    $queuedCount = $queued.total_count
    $inProgressCount = $inProgress.total_count

    Write-Host "`n--- Runners ---" -ForegroundColor Yellow
    foreach ($r in $runners.runners) {
        $icon = if ($r.status -eq 'online') { '[ON] ' } else { '[OFF]' }
        $busyTag = if ($r.busy) { 'BUSY' } else { 'IDLE' }
        Write-Host "  $icon $($r.name.PadRight(25)) $($r.os.PadRight(8)) $busyTag"
    }

    Write-Host "`n--- Beban ---" -ForegroundColor Yellow
    Write-Host "  Queued    : $queuedCount workflow(s)"
    Write-Host "  Running   : $inProgressCount workflow(s)"
    Write-Host "  Online    : $online / $($runners.total_count) runner(s)"
    Write-Host "  Busy      : $busy / $online runner(s)"

    # Rekomendasi
    Write-Host "`n--- Rekomendasi ---" -ForegroundColor Yellow
    $totalLoad = $queuedCount + $inProgressCount
    if ($totalLoad -ge $ScaleThreshold -and $offline -gt 0) {
        Write-Host "  [!] SCALE UP direkomendasikan -- $totalLoad task aktif, $offline runner offline" -ForegroundColor Red
        Write-Host "      Jalankan: .\runner-adaptive-manager.ps1 -Mode scale" -ForegroundColor Yellow
    } elseif ($totalLoad -eq 0 -and $online -gt $MinRunners) {
        Write-Host "  [~] SCALE DOWN -- tidak ada task, bisa matikan $($online - $MinRunners) runner" -ForegroundColor Cyan
        Write-Host "      Jalankan: .\runner-adaptive-manager.ps1 -Mode sleep" -ForegroundColor Yellow
    } else {
        Write-Host "  [OK] Beban seimbang -- $totalLoad task, $online runner online" -ForegroundColor Green
    }

    return @{
        TotalLoad = $totalLoad
        Online = $online
        Offline = $offline
        Busy = $busy
        Queued = $queuedCount
        InProgress = $inProgressCount
        Runners = $runners
    }
}

function Invoke-AdaptiveScale {
    Write-Host "`n========================================================" -ForegroundColor Green
    Write-Host " Runner Adaptive Scaling" -ForegroundColor Green
    Write-Host "========================================================" -ForegroundColor Green

    $status = Show-Status
    $totalLoad = $status.TotalLoad
    $online = $status.Online

    Write-Host "`n--- Keputusan Scaling ---" -ForegroundColor Yellow

    if ($totalLoad -eq 0) {
        # Tidak ada task -> konsolidasi ke minimum
        Write-Host "  Mode: KONSOLIDASI (0 task)" -ForegroundColor Cyan
        Write-Host "  Target: $MinRunners runner aktif (performa terpusat)" -ForegroundColor Cyan

        foreach ($r in $RunnerConfig.Windows.Tier1) {
            $runner = $status.Runners.runners | Where-Object { $_.name -eq $r }
            if ($runner.status -eq 'offline') {
                Start-WindowsRunner -RunnerName $r
            }
        }

        foreach ($r in ($RunnerConfig.Windows.Tier2 + $RunnerConfig.Windows.Tier3)) {
            $runner = $status.Runners.runners | Where-Object { $_.name -eq $r }
            if ($runner.status -eq 'online' -and -not $runner.busy) {
                Stop-WindowsRunner -RunnerName $r
            }
        }

    } elseif ($totalLoad -lt $ScaleThreshold) {
        # Beban rendah -> Tier 1 cukup
        Write-Host "  Mode: TERPUSAT ($totalLoad task < threshold $ScaleThreshold)" -ForegroundColor Yellow
        Write-Host "  Target: Tier 1 runners saja" -ForegroundColor Yellow

        foreach ($r in $RunnerConfig.Windows.Tier1) {
            $runner = $status.Runners.runners | Where-Object { $_.name -eq $r }
            if ($runner.status -eq 'offline') {
                Start-WindowsRunner -RunnerName $r
            }
        }
        foreach ($r in $RunnerConfig.Linux.Tier1) {
            $runner = $status.Runners.runners | Where-Object { $_.name -eq $r }
            if ($runner.status -eq 'offline') {
                Start-WSLRunner -RunnerName $r
            }
        }

    } elseif ($totalLoad -lt ($ScaleThreshold * 2)) {
        # Beban sedang -> Tier 1 + Tier 2
        Write-Host "  Mode: DISTRIBUSI SEDANG ($totalLoad task)" -ForegroundColor Yellow
        Write-Host "  Target: Tier 1 + Tier 2 runners" -ForegroundColor Yellow

        foreach ($r in ($RunnerConfig.Windows.Tier1 + $RunnerConfig.Windows.Tier2)) {
            $runner = $status.Runners.runners | Where-Object { $_.name -eq $r }
            if ($runner.status -eq 'offline') {
                Start-WindowsRunner -RunnerName $r
            }
        }
        foreach ($r in ($RunnerConfig.Linux.Tier1 + $RunnerConfig.Linux.Tier2)) {
            $runner = $status.Runners.runners | Where-Object { $_.name -eq $r }
            if ($runner.status -eq 'offline') {
                Start-WSLRunner -RunnerName $r
            }
        }

    } else {
        # Beban tinggi -> SEMUA runner
        Write-Host "  Mode: DISTRIBUSI MAKSIMAL ($totalLoad task >= $($ScaleThreshold * 2))" -ForegroundColor Red
        Write-Host "  Target: SEMUA 10 runner aktif" -ForegroundColor Red

        foreach ($r in ($RunnerConfig.Windows.Tier1 + $RunnerConfig.Windows.Tier2 + $RunnerConfig.Windows.Tier3)) {
            $runner = $status.Runners.runners | Where-Object { $_.name -eq $r }
            if ($runner.status -eq 'offline') {
                Start-WindowsRunner -RunnerName $r
            }
        }
        foreach ($r in ($RunnerConfig.Linux.Tier1 + $RunnerConfig.Linux.Tier2 + $RunnerConfig.Linux.Tier3)) {
            $runner = $status.Runners.runners | Where-Object { $_.name -eq $r }
            if ($runner.status -eq 'offline') {
                Start-WSLRunner -RunnerName $r
            }
        }
    }

    # Selalu heal sccache setelah scaling
    Heal-Sccache
}

function Invoke-WakeAll {
    Write-Host "`n=== WAKE ALL -- Menyalakan semua runner ===" -ForegroundColor Green
    $status = Show-Status

    foreach ($r in ($RunnerConfig.Windows.Tier1 + $RunnerConfig.Windows.Tier2 + $RunnerConfig.Windows.Tier3)) {
        $runner = $status.Runners.runners | Where-Object { $_.name -eq $r }
        if ($runner.status -eq 'offline') {
            Start-WindowsRunner -RunnerName $r
        }
    }
    foreach ($r in ($RunnerConfig.Linux.Tier1 + $RunnerConfig.Linux.Tier2 + $RunnerConfig.Linux.Tier3)) {
        $runner = $status.Runners.runners | Where-Object { $_.name -eq $r }
        if ($runner.status -eq 'offline') {
            Start-WSLRunner -RunnerName $r
        }
    }

    Heal-Sccache
}

function Invoke-SleepIdle {
    Write-Host "`n=== SLEEP -- Menghentikan runner idle ===" -ForegroundColor Cyan
    $status = Show-Status

    foreach ($r in ($RunnerConfig.Windows.Tier2 + $RunnerConfig.Windows.Tier3)) {
        $runner = $status.Runners.runners | Where-Object { $_.name -eq $r }
        if ($runner.status -eq 'online' -and -not $runner.busy) {
            Stop-WindowsRunner -RunnerName $r
        }
    }
    Write-Host "`n  [OK] Runner idle dimatikan. Tier 1 tetap aktif." -ForegroundColor Green
}

# --- Main ----------------------------------------------------------------------

switch ($Mode) {
    'check' { Show-Status | Out-Null }
    'scale' { Invoke-AdaptiveScale }
    'heal'  { Heal-Sccache }
    'wake'  { Invoke-WakeAll }
    'sleep' { Invoke-SleepIdle }
}

Write-Host "`n========================================================" -ForegroundColor DarkGray
Write-Host " Selesai. $(Get-Date -Format 'HH:mm:ss')" -ForegroundColor DarkGray
Write-Host "========================================================" -ForegroundColor DarkGray
