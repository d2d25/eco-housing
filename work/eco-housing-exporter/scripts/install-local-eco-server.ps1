param(
    [string]$EcoServerPath = "C:\Program Files (x86)\Steam\steamapps\common\Eco\Eco_Data\Server",
    [string]$PackagePath = "",
    [switch]$NoPackageBuild,
    [switch]$InstallExperimentalUserCodeBootstrap
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDir = Split-Path -Parent $scriptDir

if (!$PackagePath) {
    $PackagePath = Join-Path $projectDir "dist\EcoHousingExporter"
}

if (!$NoPackageBuild) {
    & (Join-Path $scriptDir "package-exporter.ps1")
    if ($LASTEXITCODE -ne 0) {
        throw "package-exporter.ps1 failed with exit code $LASTEXITCODE"
    }
}

if (!(Test-Path $EcoServerPath)) {
    throw "Eco server path was not found: $EcoServerPath"
}
if (!(Test-Path $PackagePath)) {
    throw "Package path was not found: $PackagePath"
}

$modsDir = Join-Path $EcoServerPath "Mods"
$userCodeDir = Join-Path $modsDir "UserCode\EcoHousingExporter"
New-Item -ItemType Directory -Path $modsDir -Force | Out-Null

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"

function Copy-WithBackup {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination
    )

    if (!(Test-Path $Source)) {
        throw "Source file was not found: $Source"
    }

    if (Test-Path $Destination) {
        $backup = "$Destination.bak-$timestamp"
        Copy-Item -LiteralPath $Destination -Destination $backup -Force
        Write-Host "Backed up $Destination to $backup"
    }

    Copy-Item -LiteralPath $Source -Destination $Destination -Force
    Write-Host "Installed $Destination"
}

Copy-WithBackup `
    -Source (Join-Path $PackagePath "EcoHousingExporter.dll") `
    -Destination (Join-Path $modsDir "EcoHousingExporter.dll")

$packageWebDir = Join-Path $PackagePath "EcoHousingExporter.Web"
$installedWebDir = Join-Path $modsDir "EcoHousingExporter.Web"
if (Test-Path $packageWebDir) {
    if (Test-Path $installedWebDir) {
        $webBackup = "$installedWebDir.bak-$timestamp"
        Move-Item -LiteralPath $installedWebDir -Destination $webBackup -Force
        Write-Host "Backed up $installedWebDir to $webBackup"
    }

    Copy-Item -LiteralPath $packageWebDir -Destination $installedWebDir -Recurse -Force
    Write-Host "Installed $installedWebDir"
}

if ($InstallExperimentalUserCodeBootstrap) {
    New-Item -ItemType Directory -Path $userCodeDir -Force | Out-Null
    Copy-WithBackup `
        -Source (Join-Path $PackagePath "UserCode\EcoHousingExporter\EcoHousingExporterBootstrap.cs") `
        -Destination (Join-Path $userCodeDir "EcoHousingExporterBootstrap.cs")
    Write-Warning "Installed the experimental UserCode bootstrap. It is not enabled by default because Eco ModKit UserCode does not reference the exporter DLL or System.Net.HttpListener automatically."
}
else {
    $installedBootstrap = Join-Path $userCodeDir "EcoHousingExporterBootstrap.cs"
    if (Test-Path $installedBootstrap) {
        $disabled = "$installedBootstrap.disabled-$timestamp"
        Move-Item -LiteralPath $installedBootstrap -Destination $disabled -Force
        Write-Host "Disabled existing experimental bootstrap: $disabled"
    }
}

Write-Host ""
Write-Host "EcoHousingExporter installed."
Write-Host "Only the precompiled DLL was installed by default."
Write-Host "Restart EcoServer.exe, then test:"
Write-Host "  .\work\eco-housing-exporter\scripts\test-exporter-endpoints.ps1"
Write-Host "  http://localhost:3001/eco-housing"
