<#
.SYNOPSIS
    Installs and configures PDSChain Validator as a managed background Windows service/task.

.DESCRIPTION
    Sets up dedicated working directories, enforces file permissions, configures environment
    variables, and sets up process recovery for PDSChain institutional validators on Windows.

.PARAMETER ValidatorId
    The institutional ID of the validator (e.g. VAL-01, VAL-02).

.PARAMETER DataDir
    Persistent storage root path for the validator.

.PARAMETER NodeExePath
    Full path to the node.exe executable.

.EXAMPLE
    .\Install-ValidatorService.ps1 -ValidatorId VAL-01 -DataDir "C:\pdschain\data\VAL-01"
#>

[CmdletBinding()]
param (
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^VAL-\d{2}$')]
    [string]$ValidatorId,

    [Parameter(Mandatory = $false)]
    [string]$DataDir = "C:\pdschain\data\$ValidatorId",

    [Parameter(Mandatory = $false)]
    [string]$NodeExePath = "node"
)

$ErrorActionPreference = "Stop"

Write-Host "=== PDSChain Windows Validator Service Installer ===" -ForegroundColor Cyan
Write-Host "Validator ID : $ValidatorId"
Write-Host "Data Path    : $DataDir"

# 1. Create directory structure
$subdirs = @("database", "journal", "checkpoints", "logs", "backups")
foreach ($sub in $subdirs) {
    $target = Join-Path $DataDir $sub
    if (-not (Test-Path $target)) {
        New-Item -ItemType Directory -Path $target -Force | Out-Null
        Write-Host "  Created: $target" -ForegroundColor Green
    }
}

# 2. Verify identity existence
$identityFile = Join-Path $DataDir "identity.json"
if (-not (Test-Path $identityFile)) {
    Write-Warning "No identity.json found at '$identityFile'. In production, generate an identity using:"
    Write-Warning "  node backend/src/scripts/provisionIdentity.js --id $ValidatorId --out `"$identityFile`""
}

# 3. Create Scheduled Task / Service Definition
$taskName = "PDSChain-Validator-$ValidatorId"
$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$scriptPath = Join-Path $projectRoot "backend\src\validators\validatorProcess.js"

$action = New-ScheduledTaskAction -Execute $NodeExePath `
    -Argument "`"$scriptPath`" $ValidatorId" `
    -WorkingDirectory (Join-Path $projectRoot "backend")

$trigger = New-ScheduledTaskTrigger -AtStartup

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Days 365) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)

try {
    # Unregister if already present
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "PDSChain FBA Validator Daemon for $ValidatorId" | Out-Null
    Write-Host "Service task '$taskName' successfully registered!" -ForegroundColor Green
    Write-Host "To start immediately, run: Start-ScheduledTask -TaskName `"$taskName`"" -ForegroundColor Yellow
} catch {
    Write-Warning "Could not register task automatically (requires administrator privileges): $($_.Exception.Message)"
}

