[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Command,

  [string]$Image = "n8n-rust-runner:latest",

  [string]$Workspace = $env:GITHUB_WORKSPACE
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Workspace)) {
  throw "GITHUB_WORKSPACE is required"
}

if (-not (Get-Command docker.exe -ErrorAction SilentlyContinue)) {
  throw "docker.exe is required for Linux-container jobs on the Windows runner"
}

docker version --format "{{.Server.Version}}" | Out-Host
if ($LASTEXITCODE -ne 0) {
  throw "Docker daemon is not available"
}

# Never turn a missing local CI image into an implicit network pull.
docker image inspect $Image *> $null
if ($LASTEXITCODE -ne 0) {
  throw "Required Linux runner image '$Image' is not present on this runner"
}

$resolved = (Resolve-Path -LiteralPath $Workspace).Path
$runnerName = if ([string]::IsNullOrWhiteSpace($env:RUNNER_NAME)) { "default" } else { $env:RUNNER_NAME }
$volumeSuffix = $runnerName.ToLowerInvariant() -replace '[^a-z0-9_.-]', '-'
$cargoTargetVolume = "n8n-rust-runner-cargo-target-$volumeSuffix"
$cargoHomeVolume = "n8n-rust-runner-cargo-home-$volumeSuffix"
$npmCacheVolume = "n8n-rust-runner-npm-cache"
$scriptPath = Join-Path $env:RUNNER_TEMP ("arena-linux-command-" + [guid]::NewGuid().ToString("N") + ".sh")

# Keep the command script Linux-native regardless of PowerShell line endings.
$lfCommand = [regex]::Replace($Command, "
?", ([char]10).ToString())
[System.IO.File]::WriteAllText(
  $scriptPath,
  $lfCommand + [char]10,
  [System.Text.UTF8Encoding]::new($false)
)

# Dynamic Fleet Resource Quota (Anti-Lag Guarantee)
$quotaFile = "C:\actions-runner-fleet\fleet-quota.json"
$dockerResourceArgs = @()
$hostLogicalCores = [Environment]::ProcessorCount
$reservedCores = 2
$cargoJobs = [Math]::Max(1, $hostLogicalCores - $reservedCores)

if (Test-Path $quotaFile) {
  try {
    $quota = Get-Content $quotaFile -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json
    if ($quota -and $quota.cargo_jobs_per_runner -gt 0) {
      $cargoJobs = $quota.cargo_jobs_per_runner
    }
    if ($quota -and $quota.cores_per_runner -gt 0) {
      $dockerResourceArgs += "--cpus=$($quota.cores_per_runner)"
    }
    if ($quota -and $quota.memory_per_runner_mb -gt 0) {
      $dockerResourceArgs += "-m=$($quota.memory_per_runner_mb)m"
    }
    Write-Host "Dynamic Fleet Quota: active=$($quota.active_runner_count), cpus/runner=$($quota.cores_per_runner), mem/runner=$($quota.memory_per_runner_mb)MB, cargo_jobs=$cargoJobs"
  } catch {}
}

Write-Host "Linux container image: $Image"
Write-Host "Workspace: $resolved"
Write-Host "Runner: $runnerName"
Write-Host "Cargo target volume: $cargoTargetVolume"
Write-Host "Cargo home volume: $cargoHomeVolume"
Write-Host "NPM cache volume: $npmCacheVolume"
Write-Host "Cargo build jobs: $cargoJobs (host logical CPUs: $hostLogicalCores; reserved: $reservedCores)"
Write-Host "Command script: $scriptPath"

# ── Performance telemetry (lightweight, no secrets) ──────────────────────────
$ciStart = [System.Diagnostics.Stopwatch]::StartNew()
Write-Host "::group::CI Telemetry"
Write-Host "[CI_TELEMETRY] CONTAINER_START $(Get-Date -Format 'o')"

try {
  docker run --pull=never --rm @dockerResourceArgs --mount "type=bind,source=$resolved,target=/workspace" --mount "type=volume,source=$cargoTargetVolume,target=/workspace/target" --mount "type=volume,source=$cargoHomeVolume,target=/cargo" --mount "type=volume,source=$npmCacheVolume,target=/root/.npm" --env CARGO_HOME=/cargo --env CARGO_TARGET_DIR=/workspace/target --env npm_config_cache=/root/.npm --env CARGO_BUILD_JOBS=$cargoJobs --mount "type=bind,source=$scriptPath,target=/tmp/arena-command.sh,readonly" --workdir /workspace $Image bash /tmp/arena-command.sh
  $dockerExit = $LASTEXITCODE
}
finally {
  $ciStart.Stop()
  $durationMs = $ciStart.ElapsedMilliseconds
  $durationSec = [Math]::Round($durationMs / 1000, 1)
  Write-Host "[CI_TELEMETRY] CONTAINER_DONE $(Get-Date -Format 'o') duration_ms=$durationMs duration_sec=$durationSec exit=$dockerExit"
  Write-Host "::endgroup::"
  Remove-Item -LiteralPath $scriptPath -Force -ErrorAction SilentlyContinue
}

if ($dockerExit -ne 0) {
  exit $dockerExit
}
