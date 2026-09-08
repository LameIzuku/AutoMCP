param([switch]$NoClipboard)
$ErrorActionPreference = 'Stop'
$projectPath = $PSScriptRoot
$runtimePath = Join-Path $env:LOCALAPPDATA 'BhootMCP'
$nodePath = (Get-Command node -ErrorAction Stop).Source
if (-not (Test-Path -LiteralPath (Join-Path $projectPath 'dist\bridge.js'))) {
    throw 'Run npm.cmd ci --ignore-scripts and npm.cmd run build in the BhootMCP folder first.'
}
New-Item -ItemType Directory -Force -Path $runtimePath | Out-Null
$configFile = Join-Path $runtimePath 'bridge.json'
$running = $false
if (Test-Path -LiteralPath $configFile) {
    $bridgeConfig = Get-Content -Raw -LiteralPath $configFile | ConvertFrom-Json
    try {
        $health = Invoke-RestMethod -Uri ('http://127.0.0.1:' + $bridgeConfig.port + '/health') -Headers @{ Authorization = 'Bearer ' + $bridgeConfig.clientToken } -TimeoutSec 2
        $running = $health.ok
    } catch { }
}
if (-not $running) {
    $bridgeScript = Join-Path $projectPath 'dist\bridge.js'
    Start-Process -FilePath $nodePath -ArgumentList ('"' + $bridgeScript + '"') -WorkingDirectory $projectPath -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimePath 'bridge.stdout.log') -RedirectStandardError (Join-Path $runtimePath 'bridge.stderr.log') | Out-Null
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        Start-Sleep -Milliseconds 250
        if (Test-Path -LiteralPath $configFile) {
            $bridgeConfig = Get-Content -Raw -LiteralPath $configFile | ConvertFrom-Json
            try {
                $health = Invoke-RestMethod -Uri ('http://127.0.0.1:' + $bridgeConfig.port + '/health') -Headers @{ Authorization = 'Bearer ' + $bridgeConfig.clientToken } -TimeoutSec 1
                if ($health.ok) { $running = $true; break }
            } catch { }
        }
    }
    if (-not $running) { throw ('Bridge did not start. See ' + (Join-Path $runtimePath 'bridge.stderr.log')) }
}
if (-not $NoClipboard) { Set-Clipboard -Value $bridgeConfig.browserToken }
Write-Host 'BhootMCP bridge is running.'
if (-not $NoClipboard) { Write-Host 'The local pairing code is now on your clipboard.' }
Write-Host 'Load the extension folder in Chrome or Edge, open its popup, paste the code, then click Pair and Start Claude tab.'
Write-Host ('Extension folder: ' + (Join-Path $projectPath 'extension'))
Write-Host 'Sign into Claude in that tab and select Sonnet 5 Medium. Leave the tab open.'
