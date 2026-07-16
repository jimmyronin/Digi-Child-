$ErrorActionPreference = "Stop"

$port = 5178
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

Write-Host "Starting Digi-Child UI prototype on http://127.0.0.1:$port"
python -m http.server $port --bind 127.0.0.1
