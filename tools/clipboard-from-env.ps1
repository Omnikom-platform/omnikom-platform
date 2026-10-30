# Puts ONE value from the master .env on the clipboard by variable name, so the owner can paste it into a password field the
# model must not read (for example Supabase's custom SMTP password = the Resend key). Prints only the name and length.
# Clear it afterwards with:  pwsh -File tools/clipboard-from-env.ps1 -Clear
# Usage: pwsh -File tools/clipboard-from-env.ps1 -Name RESEND_API_KEY -File "<env file>"
param(
  [string]$Name,
  [string]$File = $env:OMNIKOM_ENV_FILE,
  [switch]$Clear
)
if ($Clear) { Set-Clipboard -Value ' '; Write-Output 'clipboard cleared'; exit 0 }
if (-not $Name -or -not $File) { Write-Output 'usage: -Name <VAR> -File <env file> | -Clear'; exit 2 }
$line = Get-Content $File | Where-Object { $_ -match "^$([regex]::Escape($Name))=" } | Select-Object -Last 1
if (-not $line) { Write-Output "NOT FOUND: $Name is not in the file"; exit 1 }
$value = $line.Substring($Name.Length + 1)
Set-Clipboard -Value $value
Write-Output "clipboard now holds $Name ($($value.Length) chars); paste it, then run -Clear"
