param(
    [string]$Configuration = "Release",
    [string]$EcoReferencePath = "",
    [string]$EcoReferencePattern = "Eco*.dll",
    [switch]$DefineEcoModKit
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDir = Split-Path -Parent $scriptDir
$repoRoot = Split-Path -Parent (Split-Path -Parent $projectDir)
$projectPath = Join-Path $projectDir "EcoHousingExporter.csproj"
$distRoot = Join-Path $projectDir "dist"
$packageDir = Join-Path $distRoot "EcoHousingExporter"
$zipPath = Join-Path $distRoot "EcoHousingExporter.zip"
$appOutputDir = Join-Path $repoRoot "outputs"

if (Test-Path $packageDir) {
    Remove-Item -LiteralPath $packageDir -Recurse -Force
}
if (Test-Path $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
}

$buildArgs = @(
    "build",
    $projectPath,
    "-c",
    $Configuration
)

if ($EcoReferencePath) {
    $buildArgs += "-p:EcoReferencePath=$EcoReferencePath"
    $buildArgs += "-p:EcoReferencePattern=$EcoReferencePattern"
}

if ($DefineEcoModKit) {
    $buildArgs += "-p:DefineConstants=ECO_MODKIT"
}

dotnet @buildArgs
if ($LASTEXITCODE -ne 0) {
    throw "dotnet build failed with exit code $LASTEXITCODE"
}

$targetDir = Join-Path $projectDir "bin\$Configuration\net8.0"
if (!(Test-Path $targetDir)) {
    throw "Build output folder was not found: $targetDir"
}

New-Item -ItemType Directory -Path $packageDir | Out-Null
$webDir = Join-Path $packageDir "EcoHousingExporter.Web"
New-Item -ItemType Directory -Path $webDir | Out-Null

$filesToCopy = @(
    "EcoHousingExporter.dll",
    "EcoHousingExporter.pdb",
    "EcoHousingExporter.deps.json"
)

foreach ($file in $filesToCopy) {
    $source = Join-Path $targetDir $file
    if (Test-Path $source) {
        Copy-Item -LiteralPath $source -Destination $packageDir
    }
}

Copy-Item -LiteralPath (Join-Path $projectDir "README.md") -Destination (Join-Path $packageDir "README.md")

if (Test-Path (Join-Path $appOutputDir "index.html")) {
    Copy-Item -Path (Join-Path $appOutputDir "*") -Destination $webDir -Recurse -Force
}
else {
    Write-Warning "App output was not found at $appOutputDir. /eco-housing will return a not installed message until the app is built."
}

$manifest = [ordered]@{
    name = "EcoHousingExporter"
    version = "0.2.0-dev"
    apiPrefix = "/api/v1/eco-housing"
    endpoints = @(
        "/api/v1/eco-housing/status",
        "/api/v1/eco-housing/data",
        "/api/v1/eco-housing/economy"
    )
    appPath = "/eco-housing"
    staticFilesFolder = "EcoHousingExporter.Web"
    buildConfiguration = $Configuration
    builtAt = (Get-Date).ToUniversalTime().ToString("O")
    ecoReferencePath = if ($EcoReferencePath) { $EcoReferencePath } else { $null }
    ecoReferencePattern = if ($EcoReferencePath) { $EcoReferencePattern } else { $null }
    ecoModKitSymbols = [bool]$DefineEcoModKit
    containsExperimentalUserCodeBootstrap = $false
    defaultHttpPrefix = "http://localhost:3001/api/v1/eco-housing/"
    installNote = "Copy EcoHousingExporter.dll and EcoHousingExporter.Web to Eco Server/Mods. No UserCode bootstrap is included in the installable package. Restart EcoServer, then test http://localhost:3001/api/v1/eco-housing/status and http://localhost:3001/eco-housing. See README.md."
}

$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $packageDir "eco-housing-exporter.manifest.json") -Encoding UTF8

Compress-Archive -Path (Join-Path $packageDir "*") -DestinationPath $zipPath -Force

Write-Host "Packaged EcoHousingExporter:"
Write-Host "  Folder: $packageDir"
Write-Host "  Zip:    $zipPath"
