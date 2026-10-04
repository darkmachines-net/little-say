<#
.SYNOPSIS
Allows or removes trusted private-LAN access to the local API and Expo servers.
.DESCRIPTION
Use when Windows blocks device access during development. The rule is restricted
to Node, the selected TCP ports, the Private profile, and the local subnet.
Requires an elevated shell; supports -WhatIf before changing the firewall.
.PARAMETER ApiPort
TCP port used by the local API server.
.PARAMETER ExpoPort
TCP port used by the Expo development server.
.PARAMETER Remove
Remove the named development rule instead of creating or replacing it.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  [ValidateRange(1024, 65535)][int]$ApiPort = 8788,
  [ValidateRange(1024, 65535)][int]$ExpoPort = 8081,
  [switch]$Remove
)
$ErrorActionPreference = 'Stop'
$ruleName = 'LittleSay-LocalDevelopment'
if ($Remove) {
  if ($PSCmdlet.ShouldProcess($ruleName, 'Remove local development firewall rule')) {
    Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  }
  return
}
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
if ($PSCmdlet.ShouldProcess("$nodePath ports $ApiPort,$ExpoPort (Private profile, LocalSubnet only)", 'Allow local development')) {
  Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule -Name $ruleName -DisplayName 'Little Say local development' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $ApiPort,$ExpoPort -Program $nodePath -Profile Private -RemoteAddress LocalSubnet | Out-Null
  Write-Output "Allowed Node on private LAN ports $ApiPort and $ExpoPort."
}
