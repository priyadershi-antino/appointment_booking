<#
.SYNOPSIS
  Serves this project publicly over HTTPS, free, with no hosting account.

.DESCRIPTION
  Runs the production build of both apps locally and puts a Cloudflare quick tunnel in
  front of each, which hands out a public https://*.trycloudflare.com URL per tunnel and
  needs no Cloudflare login.

  The browser only ever talks to the web origin: the web app proxies /api/v1 through to
  the API (next.config.ts). That is what keeps the session cookie first-party, so login
  works in browsers that block third-party cookies — every current one, by default.
  The API also gets its own public URL, for calling it directly with curl or Postman.

  Ports default to 4100/3100 rather than the usual 4000/3000 so this can run alongside
  `npm run dev` without either fighting the other for a port.

.EXAMPLE
  npm run build
  ./scripts/serve-public.ps1

.EXAMPLE
  ./scripts/serve-public.ps1 -Stop
#>
param(
  [int]$ApiPort = 4100,
  [int]$WebPort = 3100,
  [switch]$Stop
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$run  = Join-Path $repo '.run'
New-Item -ItemType Directory -Force -Path $run | Out-Null

function Stop-Tracked {
  foreach ($name in 'api', 'web', 'tunnel-api', 'tunnel-web') {
    $pidFile = Join-Path $run "$name.pid"
    if (Test-Path $pidFile) {
      $procId = (Get-Content $pidFile -Raw).Trim()
      if ($procId) {
        $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
        if ($proc) {
          Stop-Process -Id $procId -Force -Confirm:$false -ErrorAction SilentlyContinue
          Write-Host "  stopped $name (pid $procId)"
        }
      }
      Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    }
  }
}

if ($Stop) {
  Write-Host 'Stopping the public deployment...' -ForegroundColor Yellow
  Stop-Tracked
  Write-Host 'Done.' -ForegroundColor Green
  return
}

# ── Preconditions ───────────────────────────────────────────────────────────────
$serverJs = Join-Path $repo 'apps\api\dist\server.js'
$nextBin  = Join-Path $repo 'node_modules\next\dist\bin\next'
$nextDir  = Join-Path $repo 'apps\web\.next'

if (-not (Test-Path $serverJs)) { throw "API is not built. Run: npm run build" }
if (-not (Test-Path $nextDir))  { throw "Web app is not built. Run: npm run build" }

foreach ($port in $ApiPort, $WebPort) {
  if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) {
    throw "Port $port is already in use. Pass -ApiPort/-WebPort to pick others."
  }
}

# cloudflared is fetched once and kept in .run, which is gitignored.
$cloudflared = Join-Path $run 'cloudflared.exe'
if (-not (Test-Path $cloudflared)) {
  Write-Host 'Downloading cloudflared...' -ForegroundColor Cyan
  Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' `
    -OutFile $cloudflared -UseBasicParsing -TimeoutSec 300
}

Stop-Tracked

function Start-Tracked($name, $file, $argList, $workDir) {
  $proc = Start-Process -FilePath $file -ArgumentList $argList -WorkingDirectory $workDir `
    -RedirectStandardOutput (Join-Path $run "$name.log") `
    -RedirectStandardError  (Join-Path $run "$name.err.log") `
    -WindowStyle Hidden -PassThru
  "$($proc.Id)" | Out-File (Join-Path $run "$name.pid") -Encoding ascii
  return $proc
}

function Wait-TunnelUrl($logPath, $timeoutSec = 45) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    if (Test-Path $logPath) {
      $match = Select-String -Path $logPath -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -AllMatches -ErrorAction SilentlyContinue
      if ($match) { return $match.Matches[0].Value }
    }
    Start-Sleep -Milliseconds 500
  }
  throw "Timed out waiting for a tunnel URL in $logPath"
}

# ── Tunnels first: the API needs to know the public web URL, and a quick tunnel's
#    hostname is random, so it cannot be known before the tunnel exists. ──────────
Write-Host 'Opening tunnels...' -ForegroundColor Cyan
Remove-Item (Join-Path $run 'tunnel-web.log'), (Join-Path $run 'tunnel-api.log') -Force -ErrorAction SilentlyContinue
Start-Tracked 'tunnel-web' $cloudflared @('tunnel', '--no-autoupdate', '--url', "http://localhost:$WebPort") $repo | Out-Null
Start-Tracked 'tunnel-api' $cloudflared @('tunnel', '--no-autoupdate', '--url', "http://localhost:$ApiPort") $repo | Out-Null

$webUrl = Wait-TunnelUrl (Join-Path $run 'tunnel-web.log')
$apiUrl = Wait-TunnelUrl (Join-Path $run 'tunnel-api.log')
Write-Host "  web -> $webUrl"
Write-Host "  api -> $apiUrl"

# ── API ─────────────────────────────────────────────────────────────────────────
# These win over apps/api/.env: dotenv never overwrites a variable that is already set.
$env:NODE_ENV        = 'production'
$env:PORT            = "$ApiPort"
$env:COOKIE_SECURE   = 'true'
# The browser reaches the API through the web app's own origin, so the cookie is
# first-party and `lax` is both correct and the safer choice.
$env:COOKIE_SAMESITE = 'lax'
$env:FRONTEND_URL    = $webUrl
$env:CORS_ORIGINS    = "$webUrl,$apiUrl,http://localhost:$WebPort"
# Browser traffic arrives via the proxy, so a per-IP ceiling can collapse onto a single
# address and throttle unrelated visitors as though they were one caller.
$env:RATE_LIMIT_MAX  = '3000'

Write-Host 'Starting the API...' -ForegroundColor Cyan
Start-Tracked 'api' 'node' @($serverJs) (Join-Path $repo 'apps\api') | Out-Null

# ── Web ─────────────────────────────────────────────────────────────────────────
# NEXT_PUBLIC_API_URL is already baked into the bundle as the relative /api/v1, so only
# the server-side targets need setting here.
$env:INTERNAL_API_URL  = "http://localhost:$ApiPort/api/v1"
$env:API_PROXY_TARGET  = "http://localhost:$ApiPort"

Write-Host 'Starting the web client...' -ForegroundColor Cyan
Start-Tracked 'web' 'node' @($nextBin, 'start', '-p', "$WebPort") (Join-Path $repo 'apps\web') | Out-Null

# ── Wait for both to answer ─────────────────────────────────────────────────────
function Wait-Http($url, $timeoutSec = 60) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    try { Invoke-WebRequest -Uri $url -TimeoutSec 4 -UseBasicParsing | Out-Null; return $true }
    catch { Start-Sleep -Milliseconds 500 }
  }
  return $false
}

$apiOk = Wait-Http "http://localhost:$ApiPort/health"
$webOk = Wait-Http "http://localhost:$WebPort/login"

@"
web=$webUrl
api=$apiUrl
"@ | Out-File (Join-Path $run 'urls.txt') -Encoding utf8

Write-Host ''
if ($apiOk -and $webOk) {
  Write-Host 'Live.' -ForegroundColor Green
} else {
  Write-Host "Something did not come up (api=$apiOk web=$webOk). See .run\*.log" -ForegroundColor Red
}
Write-Host ''
Write-Host "  Web    $webUrl"
Write-Host "  API    $apiUrl/api/v1   (health: $apiUrl/health)"
Write-Host ''
Write-Host '  Sign in with  admin@example.com  /  Demo@12345'
Write-Host ''
Write-Host '  Logs     .run\api.log, .run\web.log, .run\tunnel-*.log'
Write-Host '  Stop     ./scripts/serve-public.ps1 -Stop'
Write-Host ''
Write-Host 'The URLs are new each run: a quick tunnel gets a random hostname.' -ForegroundColor DarkGray
