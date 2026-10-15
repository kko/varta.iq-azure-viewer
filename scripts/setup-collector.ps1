#requires -Version 7.2
[CmdletBinding()]
param(
  [string[]]$Hostnames = @('localhost','127.0.0.1'),
  [string]$ImportSettings = (Join-Path (Split-Path $PSScriptRoot -Parent) 'collector-config/settings.json'),
  [switch]$Start
)
$ErrorActionPreference = 'Stop'
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker mit Linux-Containern und Compose v2 installieren.' }
if ($Hostnames | Where-Object { $_ -notmatch '^[a-zA-Z0-9._-]+$' }) { throw 'Nur IPv4-Adressen und DNS-Hostnamen ohne Port angeben.' }
$root = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $root '.env'
$names = @('localhost','127.0.0.1') + $Hostnames | Select-Object -Unique
$lines = if (Test-Path -LiteralPath $envFile) { @(Get-Content -LiteralPath $envFile) } else { @() }
$lines = @($lines | Where-Object { $_ -notmatch '^COLLECTOR_(ALLOWED_HOSTS|TLS_HOSTS)=' })
$lines += 'COLLECTOR_ALLOWED_HOSTS=' + (($names | ForEach-Object { "${_}:8788" }) -join ',')
$lines += 'COLLECTOR_TLS_HOSTS=' + ($names -join ',')
[IO.File]::WriteAllLines($envFile, $lines)
Push-Location $root
try {
  & docker compose -f compose.collector.yaml build
  if ($LASTEXITCODE) { throw 'Containerbau fehlgeschlagen.' }
  & docker compose -f compose.collector.yaml run --rm --no-deps collector node collector/setup.mjs
  if ($LASTEXITCODE) { throw 'Collector-Einrichtung fehlgeschlagen.' }
  if (Test-Path -LiteralPath $ImportSettings) {
    # Transfer the ignored local config through stdin, never command-line arguments.
    $settings = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $ImportSettings)) | ConvertFrom-Json
    $importValues = @{}
    foreach ($name in @('gatewayIp','gatewayApiKey','collectorId','uploadUrl','uploadKey','enabled')) {
      if ($settings.PSObject.Properties[$name]) { $importValues[$name] = $settings.$name }
    }
    $payload = $importValues | ConvertTo-Json -Compress
    $payload | & docker compose -f compose.collector.yaml run --rm --no-deps -T collector node collector/import-settings.mjs
    if ($LASTEXITCODE) { throw 'Import der VARTA-/Azure-Einstellungen fehlgeschlagen.' }
    $payload = $null; $settings = $null
  }
  if ($Start) { & docker compose -f compose.collector.yaml up -d; if ($LASTEXITCODE) { throw 'Containerstart fehlgeschlagen.' } }
  $protocol = if ($lines -match '^COLLECTOR_HTTPS=true$') { 'https' } else { 'http' }
  Write-Host "Collector: ${protocol}://$($names[0]):8788 · Für Heimnetzzugriff einen angegebenen Hostnamen verwenden."
} finally { Pop-Location }
