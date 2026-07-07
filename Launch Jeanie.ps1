$projectPath = "E:\backup\Claude\Claude code\jeanie"

Set-Location $projectPath

# Load the API key from .env
foreach ($line in Get-Content ".env") {
    if ($line -match "^ANTHROPIC_API_KEY=(.+)$") {
        $env:ANTHROPIC_API_KEY = $matches[1].Trim()
    }
}

if (-not $env:ANTHROPIC_API_KEY -or $env:ANTHROPIC_API_KEY -like "sk-ant-YOUR_*") {
    Write-Host "ERROR: API key not found in .env file!" -ForegroundColor Red
    Write-Host "Open .env and paste your Anthropic API key." -ForegroundColor Yellow
    pause
    exit
}

Write-Host "API key loaded OK" -ForegroundColor Green

# Start proxy server in a new window
$apiKey = $env:ANTHROPIC_API_KEY
Start-Process powershell -ArgumentList "-NoExit", "-Command", `
    "Set-Location '$projectPath'; `$env:ANTHROPIC_API_KEY='$apiKey'; Write-Host 'Proxy starting...' -ForegroundColor Cyan; node server.js"

# Wait until proxy is actually listening
Write-Host "Waiting for proxy server on port 3001..." -ForegroundColor Yellow
$ready = $false
for ($i = 0; $i -lt 15; $i++) {
    Start-Sleep -Seconds 1
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $tcp.Connect("127.0.0.1", 3001)
        $tcp.Close()
        $ready = $true
        break
    } catch {}
}

if (-not $ready) {
    Write-Host "ERROR: Proxy server did not start. Check the other window for errors." -ForegroundColor Red
    pause
    exit
}

Write-Host "Proxy is running! Starting Jeanie app..." -ForegroundColor Green
npm start
