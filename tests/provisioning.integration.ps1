# Exercise the complete provisioning orchestration with mocked command boundaries.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$global:vartaProvisionTest = @{ Calls=@(); Keys=@(); SetupKeys=@(); Mode='existing'; Prefix='https://varta-test.azurestaticapps.net' }
function az {
  $arguments = @($args); $global:LASTEXITCODE = 0
  $global:vartaProvisionTest.Calls += ,$arguments
  $response = @{}
  if ($arguments[0] -eq 'account' -and $arguments[1] -eq 'show') { $response = @{id='00000000-0000-0000-0000-000000000000';name='Test'} }
  elseif ($arguments[0] -eq 'resource') { $response = @(@{name='varta-test'}) }
  elseif ($arguments[0] -eq 'deployment') {
    $path = $arguments[[Array]::IndexOf($arguments,'--parameters')+1].Substring(1)
    $parameters = [IO.File]::ReadAllText($path) | ConvertFrom-Json
    $global:vartaProvisionTest.Keys += $parameters.parameters.uploadKey.value
    $global:vartaProvisionTest.SetupKeys += $parameters.parameters.setupKey.value
    $response = @{properties=@{outputs=@{website=@{value=$global:vartaProvisionTest.Prefix};runbookResourceId=@{value='/subscriptions/test/resourceGroups/test/providers/Microsoft.Automation/automationAccounts/test/runbooks/VartaRetention'}}}}
  }
  elseif ($arguments[0] -eq 'rest') {
    $uri = $arguments[[Array]::IndexOf($arguments,'--uri')+1]
    if ($uri -match 'listAppSettings') { $response = @{properties=@{VARTA_UPLOAD_KEY='existing-test-key';VARTA_SETUP_KEY='existing-setup-key';VARTA_STORAGE_CONNECTION='mock-connection'}} }
    elseif ($uri -match 'listSecrets') { $response = @{properties=@{apiKey='mock-deploy-token'}} }
    elseif ($uri -match '/schedules\?') { $response = @{value=@(@{name='VartaDaily'})} }
  }
  return ($response | ConvertTo-Json -Depth 12 -Compress)
}
function node { $global:LASTEXITCODE=0 }
function npm { $global:LASTEXITCODE=0 }
function npx { if ($env:SWA_CLI_DEPLOYMENT_TOKEN -ne 'mock-deploy-token') { throw 'Deployment token not passed through environment' }; $global:LASTEXITCODE=0 }
function Invoke-RestMethod { param($Uri) return @{Items=@();NextPageLink=$null} }
$savedConnection=$env:AZURE_STORAGE_CONNECTION_STRING; $savedDeploy=$env:SWA_CLI_DEPLOYMENT_TOKEN
try {
  & (Join-Path $root 'scripts/setup-azure.ps1') -SubscriptionId '00000000-0000-0000-0000-000000000000' -ResourceGroup 'varta-test' -SiteName 'varta-test'
  if ($global:vartaProvisionTest.Keys[0] -ne 'existing-test-key') { throw 'Rerun unexpectedly rotates the upload secret' }
  & (Join-Path $root 'scripts/setup-azure.ps1') -SubscriptionId '00000000-0000-0000-0000-000000000000' -ResourceGroup 'varta-test' -SiteName 'varta-test' -RotateUploadKey
  if ($global:vartaProvisionTest.Keys[1] -notmatch '^[a-f0-9]{64}$') { throw 'Explicit rotation did not generate a fresh secure key' }
  if (@($global:vartaProvisionTest.SetupKeys | Where-Object { $_ -ne 'existing-setup-key' }).Count) { throw 'Rerun unexpectedly rotates the setup link' }
  if ($env:AZURE_STORAGE_CONNECTION_STRING -ne $savedConnection -or $env:SWA_CLI_DEPLOYMENT_TOKEN -ne $savedDeploy) { throw 'Secrets leaked into the caller environment' }
  if (-not @($global:vartaProvisionTest.Calls | Where-Object { ($_ -join ' ') -match '/jobSchedules/' }).Count) { throw 'No independent retention schedule was configured' }
  Write-Output 'Provisioning tests passed: rerun preserves key, rotation is explicit, environment restored, runbook scheduled.'
} finally { Remove-Variable -Name vartaProvisionTest -Scope Global }
