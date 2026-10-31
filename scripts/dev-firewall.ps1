<#
.SYNOPSIS
Allows or removes this worktree's trusted private-LAN development ports.
.DESCRIPTION
Reads this checkout's .cache/dev/ports.json. Creates separate worktree-named
rules for Node and Docker-published Auth, restricted to the Private profile and
local subnet. Never exposes PostgreSQL. Requires an elevated shell; supports
-WhatIf and never runs automatically.
.PARAMETER ApiPort
Optional exact API port overriding the remembered value.
.PARAMETER ExpoPort
Optional exact Metro port overriding the remembered value.
.PARAMETER AuthPort
Optional exact Docker-published Auth port overriding the remembered value.
.PARAMETER Remote
Allow only Expo for a hosted-backend session.
.PARAMETER Remove
Remove only this worktree's development rules; no port file is required.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  [ValidateRange(1024, 65535)][int]$ApiPort,
  [ValidateRange(1024, 65535)][int]$ExpoPort,
  [ValidateRange(1024, 65535)][int]$AuthPort,
  [switch]$Remote,
  [switch]$Remove
)
$ErrorActionPreference = 'Stop'
$checkoutPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\', '/').ToLowerInvariant()
$sha = [Security.Cryptography.SHA256]::Create()
try { $identity = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($checkoutPath)))).Replace('-', '').Substring(0, 10).ToLowerInvariant() }
finally { $sha.Dispose() }
$rulePrefix = "LittleSay-LocalDevelopment-$identity"
$rules = @("$rulePrefix-Node", "$rulePrefix-Auth")
if ($Remove) {
  foreach ($rule in $rules) {
    if ($PSCmdlet.ShouldProcess($rule, 'Remove this worktree development firewall rule')) {
      Get-NetFirewallRule -Name $rule -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    }
  }
  return
}
$portsFile = Join-Path $checkoutPath '.cache/dev/ports.json'
$saved = if (Test-Path -LiteralPath $portsFile) { (Get-Content -LiteralPath $portsFile -Raw | ConvertFrom-Json).ports } else { $null }
$selectedExpoPort = if ($ExpoPort) { $ExpoPort } else { $saved.expo }
$selectedApiPort = if ($ApiPort) { $ApiPort } else { $saved.api }
$selectedAuthPort = if ($AuthPort) { $AuthPort } else { $saved.auth }
$selected = if ($Remote) { @($selectedExpoPort) } else { @($selectedExpoPort, $selectedApiPort, $selectedAuthPort) }
foreach ($port in $selected) {
  if ($port -lt 1024 -or $port -gt 65535) { throw 'Start the worktree launcher first, or supply each selected port explicitly.' }
}
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$nodePorts = if ($Remote) { @($selectedExpoPort) } else { @($selectedExpoPort, $selectedApiPort) }
if ($PSCmdlet.ShouldProcess("$rulePrefix ports $($selected -join ',') (Private profile, LocalSubnet only)", 'Allow this worktree')) {
  foreach ($rule in $rules) { Get-NetFirewallRule -Name $rule -ErrorAction SilentlyContinue | Remove-NetFirewallRule }
  New-NetFirewallRule -Name "$rulePrefix-Node" -DisplayName "Little Say $identity Node" -Direction Inbound -Action Allow -Protocol TCP -LocalPort $nodePorts -Program $nodePath -Profile Private -RemoteAddress LocalSubnet | Out-Null
  if (-not $Remote) {
    # Docker Desktop publishes the emulator port through its own backend, not node.exe.
    New-NetFirewallRule -Name "$rulePrefix-Auth" -DisplayName "Little Say $identity Auth" -Direction Inbound -Action Allow -Protocol TCP -LocalPort $selectedAuthPort -Profile Private -RemoteAddress LocalSubnet | Out-Null
  }
  Write-Output "Allowed $rulePrefix on private LAN ports $($selected -join ',')."
}
