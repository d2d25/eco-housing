param(
    [string]$BaseUrl = "http://localhost:3001",
    [switch]$VerboseJson
)

$ErrorActionPreference = "Stop"

$endpoints = @(
    "/api/v1/eco-housing/status",
    "/api/v1/eco-housing/data",
    "/api/v1/eco-housing/economy"
)

function Get-EndpointJson {
    param([string]$Url)

    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    if ($curl) {
        $body = & curl.exe --fail --silent --show-error --max-time 10 $Url
        if ($LASTEXITCODE -ne 0) {
            throw "curl.exe failed with exit code $LASTEXITCODE."
        }

        return $body | ConvertFrom-Json
    }

    return Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec 10
}

foreach ($endpoint in $endpoints) {
    $url = "$BaseUrl$endpoint"
    Write-Host "GET $url"
    $response = Get-EndpointJson -Url $url
    if ($VerboseJson) {
        $response | ConvertTo-Json -Depth 12
    }
    else {
        switch ($endpoint) {
            "/api/v1/eco-housing/status" {
                Write-Host "  exporterVersion=$($response.exporterVersion) ecoVersion=$($response.ecoVersion) warnings=$($response.warnings.Count)"
            }
            "/api/v1/eco-housing/data" {
                Write-Host "  housing=$($response.housing.Count) items=$($response.items.Count) recipes=$($response.recipes.Count) warnings=$($response.warnings.Count)"
            }
            "/api/v1/eco-housing/economy" {
                Write-Host "  currencies=$($response.currencies.Count) listings=$($response.listings.Count) warnings=$($response.warnings.Count)"
            }
        }
    }
}
