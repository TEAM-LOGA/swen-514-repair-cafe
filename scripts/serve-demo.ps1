<#
.SYNOPSIS
  Builds the Repair Cafe frontend, downloads the deployed config.json, and serves
  the site on two browser origins plus the presentation deck.

.DESCRIPTION
  1. npm run build in frontend/ (produces frontend/dist).
  2. Downloads config.json from the deployed site into frontend/dist so the local
     copy uses the same Cognito user pool and API as the deployment.
  3. Starts scripts/demo-server.mjs:
       http://localhost:3000/index.html   (user 1)
       http://127.0.0.1:3000/index.html   (user 2)
       http://localhost:3001/             (presentation deck)

  Prerequisite: terraform/main.tf must allow these origins and be applied
  (run the workflow with terraform_apply), or the API will reject the browser.

.PARAMETER SiteUrl
  The deployed website URL (the "Website" link in the workflow run Summary).
  Falls back to $env:REPAIR_CAFE_SITE_URL, then prompts.

.PARAMETER SkipBuild
  Reuse the existing frontend/dist instead of rebuilding.

.EXAMPLE
  .\scripts\serve-demo.ps1 -SiteUrl https://my-bucket.s3.us-east-1.amazonaws.com/index.html
#>
param(
  [string]$SiteUrl = $env:REPAIR_CAFE_SITE_URL,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$frontend = Join-Path $repo "frontend"
$dist = Join-Path $frontend "dist"

if (-not $SiteUrl) {
  $SiteUrl = Read-Host "Deployed website URL (from the workflow run Summary)"
}
$uri = $null
if (-not [Uri]::TryCreate($SiteUrl.Trim(), [UriKind]::Absolute, [ref]$uri) -or $uri.Scheme -notin @("http", "https")) {
  throw "SiteUrl must be an http(s) URL, got: $SiteUrl"
}
# config.json lives at the bucket root, next to index.html.
$configUrl = "$($uri.Scheme)://$($uri.Authority)/config.json"

# 1. Build
if (-not $SkipBuild) {
  Push-Location $frontend
  try {
    if (-not (Test-Path "node_modules")) {
      Write-Host "Installing frontend dependencies..."
      npm ci
      if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }
    }
    Write-Host "Building frontend..."
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }
  } finally {
    Pop-Location
  }
} elseif (-not (Test-Path (Join-Path $dist "index.html"))) {
  throw "frontend/dist is missing; run without -SkipBuild."
}

# 2. Fetch the deployed config.json
Write-Host "Downloading $configUrl"
$target = Join-Path $dist "config.json"
Invoke-WebRequest -Uri $configUrl -OutFile $target -UseBasicParsing
$config = Get-Content $target -Raw | ConvertFrom-Json
foreach ($key in "apiUrl", "cognitoUserPoolId", "cognitoClientId") {
  if (-not $config.$key) { throw "config.json is missing '$key'. Is SiteUrl the deployed site?" }
}
Write-Host "config.json OK (API: $($config.apiUrl))"

# 3. Serve
Write-Host ""
node (Join-Path $PSScriptRoot "demo-server.mjs")
