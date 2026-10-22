#Requires -Version 7.0
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $IsWindows -or [Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne 'X64') {
    throw 'This setup supports Windows x64 only.'
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$captureRoot = Join-Path $projectRoot '.codex-temp/android-capture'
$manifestPath = Join-Path $captureRoot 'tools.json'
$scrcpyVersion = '5.0.1'
$scrcpyHash = 'b12a2c4ee8be317422451fc7dcf8ee20a71b5ea7ef9ad73ddd825a25316227a5'
$scrcpyUrl = "https://github.com/Genymobile/scrcpy/releases/download/v$scrcpyVersion/scrcpy-win64-v$scrcpyVersion.zip"
$platformUrl = 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip'

function Resolve-CapturePath([string]$RelativePath) {
    $candidate = [IO.Path]::GetFullPath((Join-Path $captureRoot $RelativePath))
    $prefix = [IO.Path]::GetFullPath($captureRoot) + [IO.Path]::DirectorySeparatorChar
    if (-not $candidate.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Tool path is outside the dedicated capture folder.'
    }
    return $candidate
}

function Expand-VerifiedArchive([string]$ArchivePath, [string]$Destination) {
    $prefix = [IO.Path]::GetFullPath($Destination) + [IO.Path]::DirectorySeparatorChar
    $archive = [IO.Compression.ZipFile]::OpenRead($ArchivePath)
    try {
        foreach ($entry in $archive.Entries) {
            $target = [IO.Path]::GetFullPath((Join-Path $Destination $entry.FullName))
            if (-not $target.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
                throw 'Archive contains a path outside its destination.'
            }
        }
    } finally { $archive.Dispose() }
    Expand-Archive -LiteralPath $ArchivePath -DestinationPath $Destination
}

# Reuse a completed installation. Never replace existing tools or screenshots.
if (Test-Path -LiteralPath $manifestPath) {
    $existing = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
    if ($existing.schemaVersion -ne 1) { throw 'Unsupported tools.json schema.' }
    $existingAdb = Resolve-CapturePath $existing.adb
    $existingScrcpy = Resolve-CapturePath $existing.scrcpy
    if (-not (Test-Path -LiteralPath $existingAdb) -or -not (Test-Path -LiteralPath $existingScrcpy)) {
        throw 'The existing installation is incomplete. Keep tools.json and inspect it before repairing.'
    }
    if ((Get-FileHash -LiteralPath $existingAdb -Algorithm SHA256).Hash.ToLowerInvariant() -ne $existing.adbExecutableSha256 -or
        (Get-FileHash -LiteralPath $existingScrcpy -Algorithm SHA256).Hash.ToLowerInvariant() -ne $existing.scrcpyExecutableSha256) {
        throw 'An installed executable differs from its recorded checksum.'
    }
    Write-Output 'Existing installation verified. No download needed.'
    & $existingAdb version
    if ($LASTEXITCODE -ne 0) { throw 'adb version failed.' }
    & $existingScrcpy --version
    if ($LASTEXITCODE -ne 0) { throw 'scrcpy --version failed.' }
    exit 0
}

$installId = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
$installRelative = "installations/$installId"
$installRoot = Resolve-CapturePath $installRelative
$downloadRoot = Resolve-CapturePath "downloads/$installId"
New-Item -ItemType Directory -Path $installRoot, $downloadRoot -Force | Out-Null
$platformZip = Join-Path $downloadRoot 'platform-tools.zip'
$scrcpyZip = Join-Path $downloadRoot "scrcpy-$scrcpyVersion.zip"

Write-Output 'Downloading Google Android Platform-Tools...'
Invoke-WebRequest -Uri $platformUrl -OutFile $platformZip -TimeoutSec 300
Write-Output "Downloading official scrcpy $scrcpyVersion..."
Invoke-WebRequest -Uri $scrcpyUrl -OutFile $scrcpyZip -TimeoutSec 300
if ((Get-FileHash -LiteralPath $scrcpyZip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $scrcpyHash) {
    throw 'scrcpy archive checksum mismatch. Nothing from this archive will be executed.'
}

Expand-VerifiedArchive $platformZip $installRoot
Expand-VerifiedArchive $scrcpyZip $installRoot
$adbRelative = "$installRelative/platform-tools/adb.exe"
$scrcpyRelative = "$installRelative/scrcpy-win64-v$scrcpyVersion/scrcpy.exe"
$adb = Resolve-CapturePath $adbRelative
$scrcpy = Resolve-CapturePath $scrcpyRelative
$properties = Get-Content -Raw -LiteralPath (Join-Path $installRoot 'platform-tools/source.properties')
$revisionMatch = [regex]::Match($properties, '(?m)^Pkg\.Revision\s*=\s*(.+)$')
if (-not $revisionMatch.Success) { throw 'Platform-Tools revision is missing.' }
if (-not (Test-Path -LiteralPath $adb) -or -not (Test-Path -LiteralPath $scrcpy)) {
    throw 'Downloaded archives do not have the expected executable layout.'
}

# Version queries do not start screen capture or connect to Firebase/EAS.
& $adb version
if ($LASTEXITCODE -ne 0) { throw 'adb version failed.' }
& $scrcpy --version
if ($LASTEXITCODE -ne 0) { throw 'scrcpy --version failed.' }
$manifest = [ordered]@{
    schemaVersion = 1
    installedAtUtc = [DateTime]::UtcNow.ToString('o')
    platformToolsRevision = $revisionMatch.Groups[1].Value.Trim()
    scrcpyVersion = $scrcpyVersion
    adb = $adbRelative
    scrcpy = $scrcpyRelative
    platformToolsSource = $platformUrl
    scrcpySource = $scrcpyUrl
    platformToolsArchiveSha256 = (Get-FileHash -LiteralPath $platformZip -Algorithm SHA256).Hash.ToLowerInvariant()
    scrcpyArchiveSha256 = $scrcpyHash
    adbExecutableSha256 = (Get-FileHash -LiteralPath $adb -Algorithm SHA256).Hash.ToLowerInvariant()
    scrcpyExecutableSha256 = (Get-FileHash -LiteralPath $scrcpy -Algorithm SHA256).Hash.ToLowerInvariant()
}
# Only write the manifest after both tools pass their version queries.
$json = $manifest | ConvertTo-Json -Depth 4
[IO.File]::WriteAllText($manifestPath, $json + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
Write-Output 'Setup complete. Run: node scripts/androidCapture.cjs check'
