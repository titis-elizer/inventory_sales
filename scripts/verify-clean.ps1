param(
    [string]$ProjectName = ('stockflow-verify-' + (Get-Date -Format 'yyyyMMddHHmmss')),
    [int]$DatabasePort = 55432
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$started = Get-Date
Push-Location $root
try {
    # Fail if this project already owns containers or volumes: never reuse existing data.
    if ((docker ps -aq --filter "label=com.docker.compose.project=$ProjectName") -or
        (docker volume ls -q --filter "label=com.docker.compose.project=$ProjectName")) {
        throw "Project $ProjectName already exists. Choose a new verification project name."
    }
    $env:POSTGRES_DB = 'stockflow_verify'
    $env:POSTGRES_USER = 'stockflow_verify'
    $env:POSTGRES_PASSWORD = 'verify_local_only'
    $env:POSTGRES_PORT = "$DatabasePort"
    $compose = @('compose', '-p', $ProjectName, '-f', "$root\docker-compose.yml")
    & docker @compose up -d
    if ($LASTEXITCODE) { throw 'Compose startup failed.' }
    & docker @compose wait setup
    if ($LASTEXITCODE) { throw 'Migration/seed failed.' }
    $stateSQL = "SELECT json_build_array((SELECT count(*) FROM products),(SELECT count(*) FROM sales_orders),(SELECT count(*) FROM sales_order_items),(SELECT count(*) FROM stock_movements),(SELECT sum(stock) FROM products))::text;"
    $before = & docker @compose exec -T postgres psql -U stockflow_verify -d stockflow_verify -Atc $stateSQL
    if ($LASTEXITCODE) { throw 'Seed state query failed.' }
    if ($before -notmatch '^\[12, 2,') { throw "Unexpected seed counts: $before" }
    & docker @compose run --rm setup
    if ($LASTEXITCODE) { throw 'Setup replay failed.' }
    $after = & docker @compose exec -T postgres psql -U stockflow_verify -d stockflow_verify -Atc $stateSQL
    if ($LASTEXITCODE -or "$before" -ne "$after") { throw "Seed is not idempotent: $before / $after" }
    Write-Output "CLEAN_SETUP_OK project=$ProjectName seed=$after elapsedSeconds=$([math]::Round(((Get-Date)-$started).TotalSeconds,2))"
    Write-Output "TEST_DATABASE_URL=postgres://stockflow_verify:verify_local_only@127.0.0.1:$DatabasePort/stockflow_verify?sslmode=disable"
    Write-Output 'Verification containers/volume are retained. No existing volume was deleted.'
} finally { Pop-Location }