<#
.SYNOPSIS
Setup Dedicated Laptop Build Worker (GitHub Actions Self-Hosted Runner)

.DESCRIPTION
Downloads, configures, and installs the GitHub Actions Runner on the local Windows laptop
with dedicated project labels: self-hosted, windows, x64, rust-build, n8n-rust.
#>

param(
    [string]$RunnerDir = "C:\actions-runner",
    [string]$RepoUrl = "https://github.com/Catzpro01/n8n-rust-v.4",
    [string]$RunnerToken = ""
)

Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host " Setup Laptop Build Worker (GitHub Actions Self-Hosted Runner) " -ForegroundColor Cyan
Write-Host "===============================================================" -ForegroundColor Cyan

if (-not (Test-Path $RunnerDir)) {
    New-Item -ItemType Directory -Force -Path $RunnerDir | Out-Null
    Write-Host "Created runner directory: $RunnerDir" -ForegroundColor Green
}

$runnerZip = Join-Path $RunnerDir "actions-runner-win-x64.zip"
$runnerUrl = "https://github.com/actions/runner/releases/download/v2.322.0/actions-runner-win-x64-2.322.0.zip"

if (-not (Test-Path (Join-Path $RunnerDir "config.cmd"))) {
    Write-Host "Downloading GitHub Actions Runner v2.322.0..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri $runnerUrl -OutFile $runnerZip
    Write-Host "Extracting runner..." -ForegroundColor Yellow
    Expand-Archive -Path $runnerZip -DestinationPath $RunnerDir -Force
    Remove-Item $runnerZip -Force
}

Write-Host "Runner binaries ready in $RunnerDir." -ForegroundColor Green

if ($RunnerToken -ne "") {
    Write-Host "Configuring runner with labels: self-hosted, windows, x64, rust-build, n8n-rust..." -ForegroundColor Yellow
    Push-Location $RunnerDir
    .\config.cmd --url $RepoUrl --token $RunnerToken --name "laptop-worker" --labels "self-hosted,windows,x64,rust-build,n8n-rust" --unattended --replace
    Write-Host "Runner configured. Starting runsvc..." -ForegroundColor Green
    .\run.cmd
    Pop-Location
} else {
    Write-Host "`nTo complete registration, obtain a runner registration token from:" -ForegroundColor Yellow
    Write-Host "https://github.com/Catzpro01/n8n-rust-v.4/settings/actions/runners/new" -ForegroundColor White
    Write-Host "`nThen execute in PowerShell:" -ForegroundColor Yellow
    Write-Host "cd $RunnerDir" -ForegroundColor White
    Write-Host ".\config.cmd --url $RepoUrl --token <YOUR_TOKEN> --labels `"self-hosted,windows,x64,rust-build,n8n-rust`"" -ForegroundColor White
    Write-Host ".\run.cmd" -ForegroundColor White
}