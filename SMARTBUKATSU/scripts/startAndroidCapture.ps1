#Requires -Version 7.0
[CmdletBinding()]
param([ValidateSet('start', 'status', 'open', 'stop')][string]$Action = 'start')
$ErrorActionPreference = 'Stop'
& node (Join-Path $PSScriptRoot 'androidCapture/run.cjs') $Action
exit $LASTEXITCODE
