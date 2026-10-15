$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$global:vartaRetentionTestrequests = @()
$global:vartaRetentionTestcleanup = $null
$global:vartaRetentionTestfailDelete = $false
$global:vartaRetentionTestold = [DateTime]::UtcNow.Date.AddDays(-365).ToString('yyyyMMdd')
$global:vartaRetentionTestkeep = [DateTime]::UtcNow.Date.AddDays(-364).ToString('yyyyMMdd')
$savedEndpoint = $env:IDENTITY_ENDPOINT; $savedHeader = $env:IDENTITY_HEADER
$env:IDENTITY_ENDPOINT = 'http://identity.test/token'; $env:IDENTITY_HEADER = 'test-only'
function Invoke-RestMethod { param($Uri,$Headers) return @{ access_token='fake-test-token' } }
function Invoke-WebRequest {
  param([string]$Uri,[string]$Method='Get',$Headers,$ContentType,$Body,[switch]$UseBasicParsing)
  $global:vartaRetentionTestrequests += @{uri=$Uri;method=$Method}
  if ($Uri.EndsWith('/Tables')) { return @{ Headers=@{}; Content=(@{value=@(@{TableName="Varta$global:vartaRetentionTestold"},@{TableName="Varta$global:vartaRetentionTestkeep"},@{TableName='VartaMeta'},@{TableName='Unrelated'})} | ConvertTo-Json -Depth 5) } }
  if ($Method -eq 'Delete') {
    if ($global:vartaRetentionTestfailDelete) { throw 'Simulated storage failure' }
    if (($Uri.Contains('/VartaMeta(') -or $Uri.Contains('/VartaAuth(')) -and $Headers['If-Match'] -ne 'test-etag') { throw 'Missing optimistic concurrency guard' }
    return @{ Headers=@{}; Content='' }
  }
  if ($Uri.Contains('/VartaMeta()?')) { return @{Headers=@{};Content=(@{value=@(@{PartitionKey='varta-home';RowKey='point';'odata.etag'='test-etag'})} | ConvertTo-Json -Depth 5)} }
  if ($Uri.Contains('/VartaAuth()?')) {
    if ([Uri]::UnescapeDataString($Uri) -notmatch "expiresAt lt" ) { throw 'Auth cleanup must filter expired sessions and limits' }
    return @{Headers=@{};Content=(@{value=@(@{PartitionKey='auth';RowKey='s:expired';'odata.etag'='test-etag'})} | ConvertTo-Json -Depth 5)}
  }
  if ($Method -eq 'Put' -and $Uri.Contains("RowKey='cleanup'")) { $global:vartaRetentionTestcleanup = ([Text.Encoding]::UTF8.GetString($Body) | ConvertFrom-Json).payload | ConvertFrom-Json; return @{Headers=@{};Content=''} }
  Write-Output "Unexpected mock request: $Method $Uri"
  throw "Unexpected mock request: $Method $Uri"
}
try {
  & (Join-Path $root 'cloud/infra/retention.ps1') -StorageAccount 'vartatest'
  $deletes = @($global:vartaRetentionTestrequests | Where-Object method -eq Delete)
  if ($deletes.Count -ne 3 -or -not ($deletes.uri -match "Varta$global:vartaRetentionTestold") -or ($deletes.uri -match "Varta$global:vartaRetentionTestkeep")) { throw 'Retention boundary or unrelated-table protection failed' }
  if ($global:vartaRetentionTestcleanup.deletedTables -ne 1 -or $global:vartaRetentionTestcleanup.error) { throw 'Success status not recorded' }
  $global:vartaRetentionTestfailDelete = $true
  $caught = $false
  try { & (Join-Path $root 'cloud/infra/retention.ps1') -StorageAccount 'vartatest' } catch { $caught = $true }
  if (-not $caught -or -not $global:vartaRetentionTestcleanup.error) { throw 'Storage failures must persist an error and fail the automation job' }
  Write-Output 'Retention tests passed: UTC boundary, unrelated tables, metadata ETag and independent failure reporting.'
} finally { $env:IDENTITY_ENDPOINT=$savedEndpoint; $env:IDENTITY_HEADER=$savedHeader }
