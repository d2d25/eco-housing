param(
    [string]$EcoServerPath = "C:\Program Files (x86)\Steam\steamapps\common\Eco\Eco_Data\Server",
    [string]$BaseUrl = "http://localhost:3001",
    [string[]]$EcoServerArguments = @(),
    [int]$TimeoutSeconds = 120,
    [switch]$Install,
    [switch]$UseExistingServer,
    [switch]$KeepServerRunning
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

if ($Install) {
    & (Join-Path $scriptDir "install-local-eco-server.ps1") -EcoServerPath $EcoServerPath
    if ($LASTEXITCODE -ne 0) {
        throw "install-local-eco-server.ps1 failed with exit code $LASTEXITCODE"
    }
}

$serverExe = Join-Path $EcoServerPath "EcoServer.exe"
if (!(Test-Path $serverExe)) {
    throw "EcoServer.exe was not found: $serverExe"
}

$baseUri = [Uri]$BaseUrl

$existing = Get-Process | Where-Object { $_.ProcessName -eq "EcoServer" }
if ($existing -and !$UseExistingServer) {
    throw "EcoServer is already running. Stop it before running this live smoke test, or pass -UseExistingServer to test the exporter on the running server."
}

function Get-LatestEcoLog {
    Get-ChildItem (Join-Path $EcoServerPath "Logs") -Recurse -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
}

function Test-TcpPort {
    param([string]$HostName, [int]$Port)

    $client = [Net.Sockets.TcpClient]::new()
    try {
        $connect = $client.BeginConnect($HostName, $Port, $null, $null)
        if (!$connect.AsyncWaitHandle.WaitOne(1000)) {
            return $false
        }

        $client.EndConnect($connect)
        return $true
    }
    catch {
        return $false
    }
    finally {
        $client.Dispose()
    }
}

function Get-UrlJson {
    param([string]$Url)

    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    if ($curl) {
        $body = & curl.exe --fail --silent --show-error --max-time 5 $Url
        if ($LASTEXITCODE -ne 0) {
            throw "curl.exe failed with exit code $LASTEXITCODE."
        }

        return $body | ConvertFrom-Json
    }

    return Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec 5
}

$latestLogBefore = Get-LatestEcoLog
if ($UseExistingServer) {
    if (!$existing) {
        throw "UseExistingServer was passed, but EcoServer is not running."
    }

    Write-Host "Using existing EcoServer process id(s): $($existing.Id -join ', ')"
    $process = $existing | Select-Object -First 1
}
else {
    Write-Host "Starting EcoServer..."
    if ($EcoServerArguments.Count -gt 0) {
        Write-Host "EcoServer arguments: $($EcoServerArguments -join ' ')"
    }

    $process = Start-Process -FilePath $serverExe -ArgumentList $EcoServerArguments -WorkingDirectory $EcoServerPath -WindowStyle Hidden -PassThru
}
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$statusUrl = "$BaseUrl/api/v1/eco-housing/status"
$success = $false

try {
    while ((Get-Date) -lt $deadline) {
        if ($process.HasExited) {
            throw "EcoServer exited early with code $($process.ExitCode)."
        }

        try {
            if (!(Test-TcpPort -HostName $baseUri.Host -Port $baseUri.Port)) {
                throw "TCP port $($baseUri.Port) is not listening yet."
            }

            $status = Get-UrlJson -Url $statusUrl
            Write-Host "Exporter responded: exporterVersion=$($status.exporterVersion) ecoVersion=$($status.ecoVersion)"
            & (Join-Path $scriptDir "test-exporter-endpoints.ps1") -BaseUrl $BaseUrl
            $success = $true
            break
        }
        catch {
            Start-Sleep -Seconds 5
        }
    }

    if (!$success) {
        Write-Host "Exporter did not respond before timeout."
        $latestLogAfter = Get-LatestEcoLog
        if (!$latestLogAfter) {
            Write-Host "No Eco logs were found."
        }
        elseif ($latestLogBefore -and $latestLogAfter.FullName -eq $latestLogBefore.FullName -and $latestLogAfter.LastWriteTime -le $latestLogBefore.LastWriteTime) {
            Write-Host "No new Eco log was written during this run. EcoServer may be blocked before normal startup logging."
        }
        else {
            Write-Host "Latest Eco log during/after run: $($latestLogAfter.FullName) ($($latestLogAfter.LastWriteTime))"
        }

        Write-Host ""
        Write-Host "Recent Eco log hints:"
        $logs = Get-ChildItem (Join-Path $EcoServerPath "Logs") -Recurse -File -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 8
        foreach ($log in $logs) {
            Write-Host "== $($log.FullName)"
            Select-String -LiteralPath $log.FullName -Pattern "EcoHousingExporter|Eco Housing|error CS|Errors report|Firewall|ModKitPlugin|Exception" -CaseSensitive:$false |
                Select-Object -Last 20 |
                ForEach-Object { Write-Host $_.Line }
        }
        throw "EcoHousingExporter live endpoint did not respond at $statusUrl."
    }
}
finally {
    if (!$UseExistingServer -and !$KeepServerRunning -and !$process.HasExited) {
        Write-Host "Stopping EcoServer..."
        Stop-Process -Id $process.Id -Force
    }
}
