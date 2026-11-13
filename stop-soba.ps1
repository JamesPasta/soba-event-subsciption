[CmdletBinding()]
param(
    [switch]$StopServices
)

$ErrorActionPreference = 'Stop'
$repoRoot = [regex]::Escape($PSScriptRoot)
$ports = @(3000, 3100, 4000)

foreach ($port in $ports) {
    Write-Host "Checking port $port..."
    $connections = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
    $processIds = @($connections | Select-Object -ExpandProperty OwningProcess -Unique)

    if ($processIds.Count -eq 0) {
        Write-Host "Port $port`: nothing to stop."
        continue
    }

    foreach ($processId in $processIds) {
        $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
        if (-not $process) {
            continue
        }

        Write-Host "Stopping $($process.ProcessName) (PID $processId) on port $port..."
        Stop-Process -Id $processId -Force
    }
}

$workspaceProcesses = @(
    Get-CimInstance Win32_Process |
        Where-Object {
            $_.Name -in @('node.exe', 'powershell.exe', 'pwsh.exe') -and
            $_.CommandLine -and
            (
                $_.CommandLine -match "$repoRoot\\backend" -or
                $_.CommandLine -match "$repoRoot\\frontend"
            )
        }
)

foreach ($workspaceProcess in $workspaceProcesses) {
    $process = Get-Process -Id $workspaceProcess.ProcessId -ErrorAction SilentlyContinue
    if (-not $process) {
        continue
    }

    Write-Host "Stopping SOBA process $($process.ProcessName) (PID $($workspaceProcess.ProcessId))..."
    Stop-Process -Id $workspaceProcess.ProcessId -Force
}

if ($StopServices) {
    if (-not (Get-Command 'docker' -ErrorAction SilentlyContinue)) {
        throw "Required command 'docker' was not found. Install Docker or omit -StopServices."
    }

    $composeFile = Join-Path $PSScriptRoot '.devcontainer\docker-compose.yml'
    Write-Host 'Stopping local Docker backing services...'
    & docker compose -f $composeFile stop --timeout 10
    if ($LASTEXITCODE -ne 0) {
        throw "Docker backing services could not be stopped (exit code $LASTEXITCODE)."
    }
}

Write-Host 'SOBA application processes stopped.'
exit 0
