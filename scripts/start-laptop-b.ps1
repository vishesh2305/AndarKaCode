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

Write-Host "1/3 Ollama"
if (Test-Port 11434) { Write-Host "  already running" }
else {
  Start-Process (Join-Path $ollamaDir "ollama app.exe")
  Wait-Port 11434 "Ollama" 60
}

Write-Host "2/3 Screenshot-to-Code backend"
if (Test-Port 7001) { Write-Host "  already running" }
elseif (-not (Test-Path $S2cBackend)) { Write-Host "  not found at $S2cBackend (pass -S2cBackend <path>)" -ForegroundColor Red }
else {
  Start-InWindow "Screenshot-to-Code (7001)" $S2cBackend "poetry run python start.py"
  Wait-Port 7001 "Screenshot-to-Code" 90
}

Write-Host "3/3 Gateway"
if (Test-Port 8787) { Write-Host "  already running" }
elseif (-not (Get-Command tailscale -ErrorAction SilentlyContinue) -or -not (tailscale ip -4 2>$null)) {
  Write-Host "  Tailscale is not connected: open the Tailscale app first (the Gateway listens on its address)" -ForegroundColor Red
}
else {
  Start-InWindow "Gateway (8787)" (Join-Path $repo "gateway") "npm start"
  Wait-Port 8787 "Gateway" 30
}

Write-Host ""
Write-Host "Laptop B ready. From the Mac:  curl -s http://127.0.0.1:4000/api/health"
