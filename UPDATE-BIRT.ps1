param(
    [string]$Inbox,
    [switch]$Watch,
    [switch]$Force,
    [ValidateRange(1, 86400)][int]$Interval = 60
)
$ErrorActionPreference = 'Stop'
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$UpdaterArgs = @((Join-Path $PSScriptRoot 'scripts/local_updater_v2.py'), '--interval', "$Interval")
if ($Inbox) { $UpdaterArgs += @('--inbox', $Inbox) }
if ($Watch) { $UpdaterArgs += '--watch' }
if ($Force) { $UpdaterArgs += '--force' }
& python @UpdaterArgs
exit $LASTEXITCODE
