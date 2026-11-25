$ErrorActionPreference = 'Stop'
$envFile = Join-Path $PSScriptRoot '..\.env'
if (Test-Path $envFile) {
    foreach ($line in Get-Content $envFile) {
        if ($line -match '^\s*(PORT|DATABASE_URL)=(.*)$') {
            [Environment]::SetEnvironmentVariable($matches[1], $matches[2].Trim(), 'Process')
        }
    }
}
Push-Location $PSScriptRoot
try {
    go run ./cmd/api
    if ($LASTEXITCODE -ne 0) { throw 'Backend exited with an error.' }
} finally {
    Pop-Location
}