# Lists every process as one JSON array: pid, ppid, created (unix ms), name, cmd. Used by builder-lib.mjs (stop-builder).
# UTF-8 output is set first and control characters are blanked in command lines, so a stray 0x1A cannot break the JSON
# (windows-scripting.md section 3, P07.8).
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$rows = foreach ($p in Get-CimInstance Win32_Process) {
  $cmd = if ($p.CommandLine) { [regex]::Replace($p.CommandLine, '[\x00-\x1f]', ' ') } else { '' }
  [pscustomobject]@{
    pid     = [int]$p.ProcessId
    ppid    = [int]$p.ParentProcessId
    created = if ($p.CreationDate) { [DateTimeOffset]::new($p.CreationDate).ToUnixTimeMilliseconds() } else { 0 }
    name    = [string]$p.Name
    cmd     = $cmd
  }
}
ConvertTo-Json -InputObject @($rows) -Compress
exit 0
