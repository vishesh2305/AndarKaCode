$repo = $PSScriptRoot

Start-Process "$repo\gateway\start.bat"
Start-Process "$repo\builder-api\start.bat"

Write-Host "Started Gateway and Builder API in separate windows." -ForegroundColor Green
