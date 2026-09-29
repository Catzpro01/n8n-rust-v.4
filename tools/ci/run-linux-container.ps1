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

docker version --format '{{.Server.Version}}' | Out-Host
if ($LASTEXITCODE -ne 0) {
  throw "Docker daemon is not available"
}

docker image inspect $Image *> $null
if ($LASTEXITCODE -ne 0) {
  throw "Required Linux runner image '$Image' is not present on this runner"
}

$resolved = (Resolve-Path -LiteralPath $Workspace).Path

Write-Host "Linux container image: $Image"
Write-Host "Workspace: $resolved"
Write-Host "Command: $Command"

docker run --rm `
  --mount "type=bind,source=$resolved,target=/workspace" `
  --workdir /workspace `
  $Image `
  bash -lc $Command

if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
