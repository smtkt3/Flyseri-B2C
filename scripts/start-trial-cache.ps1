$ErrorActionPreference = 'Stop'
$cacheWorkspace = Split-Path -Parent $PSScriptRoot
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Docker is unavailable. Install and start Docker Desktop, then run this script again. The API memory cache remains usable meanwhile.'
}
$cacheCompose = Join-Path $cacheWorkspace 'compose.cache.yml'
& docker compose -f $cacheCompose up -d --wait
if ($LASTEXITCODE -ne 0) { throw 'Redis startup failed. No API configuration was changed.' }
& docker compose -f $cacheCompose exec -T redis redis-cli ping
if ($LASTEXITCODE -ne 0) { throw 'Redis health check failed. No API configuration was changed.' }
$cacheEnvPath = Join-Path $cacheWorkspace '.env'
if (-not (Test-Path -LiteralPath $cacheEnvPath)) { throw 'Workspace .env is missing. Redis started, but no configuration was changed.' }
$cacheSettings = [IO.File]::ReadAllText($cacheEnvPath)
if ($cacheSettings -match '(?m)^REDIS_URL=.+') {
  Write-Output 'Redis started. An existing REDIS_URL was preserved; verify its connection before restarting the API.'
  exit 0
}
if ($cacheSettings -match '(?m)^REDIS_URL=') {
  $cacheSettings = [regex]::Replace($cacheSettings, '(?m)^REDIS_URL=.*$', 'REDIS_URL=redis://127.0.0.1:6379')
} else { $cacheSettings += "`r`nREDIS_URL=redis://127.0.0.1:6379`r`n" }
[IO.File]::WriteAllText($cacheEnvPath, $cacheSettings, [Text.UTF8Encoding]::new($false))
Write-Output 'Redis is ready and REDIS_URL is configured. Restart the API to enable the shared cache.'
