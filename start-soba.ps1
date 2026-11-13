[CmdletBinding()]
param(
    [switch]$SkipServices
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

$shell = (Get-Command 'pwsh' -ErrorAction SilentlyContinue).Source
if (-not $shell) {
    $shell = (Get-Command 'powershell' -ErrorAction Stop).Source
}

$candidatePorts = @(3000, 3100, 4000)
$existingPorts = @($candidatePorts | Where-Object {
    @(Get-NetTCPConnection -State Listen -LocalPort $_ -ErrorAction SilentlyContinue).Count -gt 0
})
if ($existingPorts.Count -gt 0) {
    $answer = Read-Host "SOBA is already listening on port(s) $($existingPorts -join ', '). Stop existing application processes? [Y/n]"
    if ([string]::IsNullOrWhiteSpace($answer) -or $answer -match '^[Yy]') {
        & $shell -NoProfile -File (Join-Path $repoRoot 'stop-soba.ps1')
        if ($LASTEXITCODE -ne 0) {
            throw "Existing SOBA processes could not be stopped (exit code $LASTEXITCODE)."
        }
    } else {
        throw 'Startup cancelled because existing SOBA processes were not stopped.'
    }
}

function Assert-CommandAvailable {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found. Install it and ensure it is on PATH."
    }
}

$pnpmCommand = Get-Command 'pnpm.cmd' -ErrorAction SilentlyContinue
$corepackCommand = Get-Command 'corepack.cmd' -ErrorAction SilentlyContinue
if (-not $pnpmCommand -and -not $corepackCommand) {
    throw "Neither 'pnpm.cmd' nor 'corepack.cmd' was found. Install Node.js with Corepack or install pnpm."
}

$nodeExecutable = (Get-Command 'node.exe' -ErrorAction SilentlyContinue).Source
if (-not $nodeExecutable) {
    $packageManagerDirectory = Split-Path -Parent $(if ($corepackCommand) { $corepackCommand.Source } else { $pnpmCommand.Source })
    $nodeExecutable = Join-Path $packageManagerDirectory 'node.exe'
    if (-not (Test-Path -LiteralPath $nodeExecutable)) {
        throw "Node.js was not found on PATH or beside the package manager at '$packageManagerDirectory'. Install Node.js and add it to PATH."
    }
}
$nodeDirectory = Split-Path -Parent $nodeExecutable
$env:PATH = "$nodeDirectory;$env:PATH"
$nodePathCommand = "`$env:PATH = '$($nodeDirectory.Replace("'", "''"));' + `$env:PATH"

$useCorepack = -not $pnpmCommand
$packageManagerCommand = if ($useCorepack) {
    "& '$($corepackCommand.Source.Replace("'", "''"))' pnpm"
} else {
    "& '$($pnpmCommand.Source.Replace("'", "''"))'"
}

$composeFile = Join-Path $repoRoot '.devcontainer\docker-compose.yml'
$hasCustomDatabase = -not (
    [string]::IsNullOrWhiteSpace($env:DATABASE_URL) -and
    [string]::IsNullOrWhiteSpace($env:DB_HOST)
)
$postgresPort = 5432

if (-not $SkipServices -or (-not $hasCustomDatabase -and (Get-Command 'docker' -ErrorAction SilentlyContinue))) {
    Assert-CommandAvailable -Name 'docker'
    $postgresContainerId = & docker compose -f $composeFile ps -a -q postgres
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not inspect the SOBA PostgreSQL service.'
    }

    if ($postgresContainerId) {
        $postgresContainer = @(& docker inspect $postgresContainerId | ConvertFrom-Json)[0]
        if ($LASTEXITCODE -ne 0) {
            throw 'Could not inspect the SOBA PostgreSQL container.'
        }
        $postgresPort = [int]$postgresContainer.HostConfig.PortBindings.'5432/tcp'[0].HostPort
        if ($SkipServices -and -not $postgresContainer.State.Running) {
            throw 'The SOBA PostgreSQL container is stopped. Start without -SkipServices or set DATABASE_URL.'
        }
    }

    if (-not $SkipServices) {
        $portOccupied = @(Get-NetTCPConnection -State Listen -LocalPort $postgresPort -ErrorAction SilentlyContinue).Count -gt 0
        if ($portOccupied -and -not ($postgresContainerId -and $postgresContainer.State.Running)) {
            $postgresPort = @(5440..5499 | Where-Object {
                @(Get-NetTCPConnection -State Listen -LocalPort $_ -ErrorAction SilentlyContinue).Count -eq 0
            } | Select-Object -First 1)[0]
            if (-not $postgresPort) {
                throw 'No free PostgreSQL port was found between 5440 and 5499.'
            }
        }
        $env:POSTGRES_HOST_PORT = [string]$postgresPort
    }
}

if (-not $hasCustomDatabase) {
    $env:DATABASE_URL = "postgres://postgres:postgres@localhost:$postgresPort/soba"
    Write-Host "Using the SOBA PostgreSQL database at localhost:$postgresPort/soba."
}

if ([string]::IsNullOrWhiteSpace($env:SOBA_EVENT_SUBSCRIPTION_ENCRYPTION_KEY)) {
    $localKeyFile = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'SOBA\event-subscription.key'
    if (Test-Path -LiteralPath $localKeyFile) {
        $protectedKey = (Get-Content -LiteralPath $localKeyFile -Raw).Trim()
        $secureKey = ConvertTo-SecureString -String $protectedKey
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
        try {
            $env:SOBA_EVENT_SUBSCRIPTION_ENCRYPTION_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
        } finally {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
        }
    } else {
        $bytes = New-Object byte[] 32
        $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
        try {
            $random.GetBytes($bytes)
        } finally {
            $random.Dispose()
        }
        $env:SOBA_EVENT_SUBSCRIPTION_ENCRYPTION_KEY = [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
        $secureKey = ConvertTo-SecureString -String $env:SOBA_EVENT_SUBSCRIPTION_ENCRYPTION_KEY -AsPlainText -Force
        $protectedKey = ConvertFrom-SecureString -SecureString $secureKey
        New-Item -ItemType Directory -Path (Split-Path -Parent $localKeyFile) -Force | Out-Null
        Set-Content -LiteralPath $localKeyFile -Value $protectedKey -Encoding Ascii -NoNewline
    }
}
if ($env:SOBA_EVENT_SUBSCRIPTION_ENCRYPTION_KEY -notmatch '^[0-9a-f]{64}$') {
    throw 'SOBA_EVENT_SUBSCRIPTION_ENCRYPTION_KEY must be a 32-byte hex-encoded key.'
}

Write-Host 'Building the shared library...'
if ($useCorepack) {
    & $corepackCommand.Source pnpm --dir $repoRoot build:lib
} else {
    & $pnpmCommand.Source --dir $repoRoot build:lib
}
if ($LASTEXITCODE -ne 0) {
    throw "The shared library could not be built (exit code $LASTEXITCODE)."
}

if (-not $SkipServices) {
    Write-Host 'Starting local backing services and initializing the database...'
    if ($useCorepack) {
        & $corepackCommand.Source pnpm --dir $repoRoot dev:db:up
    } else {
        & $pnpmCommand.Source --dir $repoRoot dev:db:up
    }
    if ($LASTEXITCODE -ne 0) {
        throw "The local backing services could not be started (exit code $LASTEXITCODE)."
    }
}

$backendCommand = @"
Set-Location -LiteralPath '$repoRoot'
$nodePathCommand
Write-Host 'SOBA Backend starting...'
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw 'Node.js is missing from the backend window PATH.' }
`$env:NODE_ENV = 'development'
`$env:API_BASE_PATH = ''
`$env:CORS_DEV_ORIGIN = 'http://localhost:3000,http://127.0.0.1:3000,http://localhost:3100,http://127.0.0.1:3100'
`$env:IDP_PLUGIN_DEFAULT_SSO_JWT_ISSUER = 'https://example.test/realms/test'
`$env:IDP_PLUGIN_DEFAULT_SSO_JWKS_URI = 'https://example.test/realms/test/protocol/openid-connect/certs'
`$env:PLUGIN_FORMIO_V5_API_BASE_URL = 'http://localhost:3001'
`$env:PLUGIN_FORMIO_V5_ADMIN_API_URL = 'http://localhost:3001'
`$env:PLUGIN_FORMIO_V5_RENDER_API_URL = 'http://localhost:3001'
`$env:PLUGIN_FORMIO_V5_ADMIN_USERNAME = 'formio@localhost.com'
`$env:PLUGIN_FORMIO_V5_ADMIN_PASSWORD = 'formio'
$packageManagerCommand --dir '$repoRoot\backend' dev
"@

$frontendCommand = @"
Set-Location -LiteralPath '$repoRoot\frontend'
$nodePathCommand
Write-Host 'SOBA Frontend starting...'
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw 'Node.js is missing from the frontend window PATH.' }
if (-not (Test-Path -LiteralPath '$repoRoot\frontend\node_modules\.bin\next.cmd')) { throw 'Next.js is not installed. Run pnpm install from the repository root.' }
`$env:BASE_PATH = ''
`$env:NEXT_PUBLIC_SOBA_API_BASE_URL = 'http://localhost:4000/api/v1'
`$env:SOBA_API_INTERNAL_URL = 'http://localhost:4000/api/v1'
`$env:NEXT_PUBLIC_SOBA_FEATURES_ALLOWED = 'workspaces,design-mode,submit-mode,files,meta,marketing'
& '$repoRoot\frontend\node_modules\.bin\next.cmd' dev --hostname 0.0.0.0 -p 3000
"@

Write-Host 'Starting the backend and frontend in separate PowerShell windows...'
Start-Process -FilePath $shell -WorkingDirectory $repoRoot -ArgumentList @(
    '-NoProfile',
    '-NoExit',
    '-Command',
    $backendCommand
)

$backendReady = $false
$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
Write-Host 'Waiting for the backend features endpoint...'
while ($stopwatch.Elapsed.TotalSeconds -lt 120) {
    try {
        $response = Invoke-WebRequest -Uri 'http://localhost:4000/api/v1/meta/features' -UseBasicParsing -TimeoutSec 2
        if ([int]$response.StatusCode -eq 200) {
            $backendReady = $true
            break
        }
    } catch {
        Start-Sleep -Seconds 2
    }
}
$stopwatch.Stop()

if (-not $backendReady) {
    throw "The backend did not become ready within 120 seconds. Check the backend PowerShell window for startup errors."
}

Write-Host 'Backend is ready. Starting the frontend...'
Start-Process -FilePath $shell -WorkingDirectory $repoRoot -ArgumentList @(
    '-NoProfile',
    '-NoExit',
    '-Command',
    $frontendCommand
)

Write-Host ''
Write-Host 'SOBA is starting:'
Write-Host '  Frontend: http://localhost:3000'
Write-Host '  Backend:  http://localhost:4000'
Write-Host ''
Write-Host 'Close the backend and frontend PowerShell windows to stop the application.'
