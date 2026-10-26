# Saves the value now on the clipboard as NAME=value in a credentials file, without ever printing the value, then clears the
# clipboard. Used to bank API keys copied from a provider's page (owner 2026-10-26). Prints only the name, length and a shape check.
# Usage: pwsh -File tools/save-secret-from-clipboard.ps1 -Name PSI_API_KEY [-File .secrets/api-keys.env] [-Prefix AIza]
param(
  [Parameter(Mandatory = $true)][string]$Name,
  [string]$File = (Join-Path $PSScriptRoot '..\.secrets\api-keys.env'),
  [string]$Prefix = ''
)
$value = (Get-Clipboard -Raw)
if ($null -eq $value) { Write-Output "NOT SAVED: clipboard is empty"; exit 1 }
$value = $value.Trim()
if ($value.Length -lt 20 -or $value -match '\s') { Write-Output "NOT SAVED: clipboard does not look like a key (length $($value.Length))"; exit 1 }
if ($Prefix -and -not $value.StartsWith($Prefix)) { Write-Output "NOT SAVED: value does not start with the expected prefix"; exit 1 }
$dir = Split-Path -Parent $File
New-Item -ItemType Directory -Force $dir | Out-Null
$lines = @()
if (Test-Path $File) { $lines = @(Get-Content $File | Where-Object { $_ -notmatch "^$([regex]::Escape($Name))=" }) }
$lines += "$Name=$value"
Set-Content -Path $File -Value $lines -Encoding utf8NoBOM
Set-Clipboard -Value ' '
Write-Output "saved $Name ($($value.Length) chars) to $File; clipboard cleared"
