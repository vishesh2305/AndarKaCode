# Laptop B (Windows): starts Ollama, Screenshot-to-Code and the Gateway, each in its own window.
# Run:  powershell -ExecutionPolicy Bypass -File scripts\start-laptop-b.ps1
# Anything already running is left alone, so running this twice is safe.
param(
  [string]$S2cBackend = "$env:USERPROFILE\OneDrive\Desktop\screenshot-code\screenshot-to-code\backend"
)

$repo = Split-Path -Parent $PSScriptRoot
$ollamaDir = "$env:LOCALAPPDATA\Programs\Ollama"

function Test-Port($port) { [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) }

function Wait-Port($port, $name, $seconds) {
  $w = [Diagnostics.Stopwatch]::StartNew()
  while (-not (Test-Port $port) -and $w.Elapsed.TotalSeconds -lt $seconds) { Start-Sleep -Milliseconds 500 }
  if (Test-Port $port) { Write-Host "  $name is up on port $port" -ForegroundColor Green }
  else { Write-Host "  $name did not start within $seconds s: check its window" -ForegroundColor Red }
}

function Start-InWindow($title, $dir, $command) {
  Start-Process powershell -WorkingDirectory $dir -ArgumentList "-NoExit", "-Command", "`$Host.UI.RawUI.WindowTitle = '$title'; $command"
}

# Screenshot-to-Code's port comes from S2C_WS_URL in gateway/.env, so the Gateway and S2C always agree.
# (NoMachine's nxnode takes 7001 on Laptop B, so our .env uses 7002.)
$s2cPort = 7001
$s2cUrl = Select-String -Path (Join-Path $repo "gateway\.env") -Pattern '^S2C_WS_URL=.*:(\d+)/' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($s2cUrl) { $s2cPort = [int]$s2cUrl.Matches[0].Groups[1].Value }

# Something listening on the port is not enough (NoMachine was): S2C's home page names itself.
function Test-S2c($port) {
  try { (Invoke-WebRequest "http://127.0.0.1:$port/" -UseBasicParsing -TimeoutSec 2).Content -match "screenshot-to-code" } catch { $false }
}

function Get-PortOwner($port) {
  $c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) { (Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue).ProcessName }
}

Write-Host "1/3 Ollama"
if (Test-Port 11434) { Write-Host "  already running" }
else {
  Start-Process (Join-Path $ollamaDir "ollama app.exe")
  Wait-Port 11434 "Ollama" 60
}

Write-Host "2/3 Screenshot-to-Code backend"
if (Test-S2c $s2cPort) { Write-Host "  already running on port $s2cPort" }
elseif (Test-Port $s2cPort) {
  Write-Host "  port $s2cPort is taken by $(Get-PortOwner $s2cPort), not Screenshot-to-Code: stop it, or set another port in S2C_WS_URL (gateway\.env)" -ForegroundColor Red
}
elseif (-not (Test-Path $S2cBackend)) { Write-Host "  not found at $S2cBackend (pass -S2cBackend <path>)" -ForegroundColor Red }
else {
  # --max-port-attempts 1: fail in its window instead of quietly moving to the next port the Gateway doesn't know.
  Start-InWindow "Screenshot-to-Code ($s2cPort)" $S2cBackend "poetry run python start.py --port $s2cPort --max-port-attempts 1"
  $w = [Diagnostics.Stopwatch]::StartNew()
  while (-not (Test-S2c $s2cPort) -and $w.Elapsed.TotalSeconds -lt 90) { Start-Sleep -Milliseconds 500 }
  if (Test-S2c $s2cPort) { Write-Host "  Screenshot-to-Code is up on port $s2cPort" -ForegroundColor Green }
  else { Write-Host "  Screenshot-to-Code did not start within 90 s: check its window" -ForegroundColor Red }
}

Write-Host "3/3 Gateway"
if (Test-Port 8787) { Write-Host "  already running (after changing gateway\.env, close its window and run this again)" }
elseif (-not (Get-Command tailscale -ErrorAction SilentlyContinue) -or -not (tailscale ip -4 2>$null)) {
  Write-Host "  Tailscale is not connected: open the Tailscale app first (the Gateway listens on its address)" -ForegroundColor Red
}
else {
  Start-InWindow "Gateway (8787)" (Join-Path $repo "gateway") "npm start"
  Wait-Port 8787 "Gateway" 30
}

Write-Host ""
Write-Host "Laptop B ready. From the Mac:  curl -s http://127.0.0.1:4000/api/health"
