# Run only if Windows blocks access from a device on your trusted private LAN.
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
