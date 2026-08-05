[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../../..')).Path
$generatorPath = Join-Path $repositoryRoot '.agents/skills/orchestrate-sdoc-work/scripts/advisor-context.ps1'
$defaultRegistryPath = Join-Path $repositoryRoot '.agents/skills/orchestrate-sdoc-work/references/project-context.routes.json'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('sdoc-advisor-context-tests-' + [guid]::NewGuid().ToString('N'))
$utf8 = New-Object Text.UTF8Encoding($false)
$script:passed = 0

function Assert-True { param([bool]$Condition, [string]$Message) if (-not $Condition) { throw $Message } }
function Assert-Equal { param($Actual, $Expected, [string]$Message) if ($Actual -cne $Expected) { throw "$Message Expected '$Expected', got '$Actual'." } }
function Complete-Test { param([string]$Name) $script:passed++; Write-Host "[PASS] $Name" }
function Write-Utf8 { param([string]$Path, [string]$Text) $parent = Split-Path -Parent $Path; if ($parent) { [void][IO.Directory]::CreateDirectory($parent) }; [IO.File]::WriteAllText($Path, $Text, $utf8) }

function ConvertTo-NativeArgument {
    param([AllowEmptyString()][string]$Value)
    if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') { return $Value }
    return '"' + ($Value -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"'
}

function Invoke-Generator {
    param(
        [string]$Fixture, [string]$Mode = 'Planning', [string]$ChangedPath,
        [string]$RequestedPath, [string]$IncludeUntrackedPath,
        [int]$MaximumBundleBytes = 262144
    )
    $shell = [Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
    $arguments = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $generatorPath,
        '-Mode', $Mode, '-TaskSpecFile', (Join-Path $Fixture 'task.txt'), '-WorkingDirectory', $Fixture,
        '-RoutingRegistryPath', (Join-Path $Fixture 'routes.json'), '-MaximumBundleBytes', [string]$MaximumBundleBytes)
    if ($ChangedPath) { $arguments += @('-ChangedPath', $ChangedPath) }
    if ($RequestedPath) { $arguments += @('-RequestedPath', $RequestedPath) }
    if ($IncludeUntrackedPath) { $arguments += @('-IncludeUntrackedPath', $IncludeUntrackedPath) }
    $startInfo = New-Object Diagnostics.ProcessStartInfo
    $startInfo.FileName = $shell
    $startInfo.Arguments = (($arguments | ForEach-Object { ConvertTo-NativeArgument ([string]$_) }) -join ' ')
    $startInfo.WorkingDirectory = $Fixture
    $startInfo.UseShellExecute = $false; $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true; $startInfo.RedirectStandardError = $true
    if ($null -ne $startInfo.PSObject.Properties['StandardOutputEncoding']) {
        $startInfo.StandardOutputEncoding = $utf8; $startInfo.StandardErrorEncoding = $utf8
    }
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $startInfo
    try {
        Assert-True $process.Start() 'Failed to start generator process.'
        $stdout = $process.StandardOutput.ReadToEndAsync(); $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(30000)) { & taskkill.exe /PID $process.Id /T /F 2>$null | Out-Null; throw 'Generator test timed out.' }
        $process.WaitForExit()
        $text = ([string]$stdout.Result).Trim()
        return [pscustomobject]@{
            ExitCode = $process.ExitCode; Stdout = $text; Stderr = ([string]$stderr.Result).Trim()
            Json = $(if ($process.ExitCode -eq 0) { $text | ConvertFrom-Json } else { $null })
        }
    } finally { $process.Dispose() }
}

function Remove-Artifact {
    param([object]$Result)
    if ($null -eq $Result -or $null -eq $Result.Json) { return }
    $path = [IO.Path]::GetFullPath([string]$Result.Json.artifactDirectory)
    $tempPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    Assert-True ($path.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase)) 'Artifact escaped OS temp.'
    Assert-True ([IO.Path]::GetFileName($path).StartsWith('sdoc-advisor-context-', [StringComparison]::Ordinal)) 'Unexpected artifact prefix.'
    if ([IO.Directory]::Exists($path)) {
        foreach ($file in [IO.Directory]::GetFiles($path, '*', [IO.SearchOption]::AllDirectories)) { [IO.File]::SetAttributes($file, [IO.FileAttributes]::Normal) }
        [IO.Directory]::Delete($path, $true)
    }
}

function New-Fixture {
    $fixture = Join-Path $testRoot ([guid]::NewGuid().ToString('N'))
    [void][IO.Directory]::CreateDirectory($fixture)
    Write-Utf8 (Join-Path $fixture 'AGENTS.md') "# Agent rules`n"
    Write-Utf8 (Join-Path $fixture 'PRODUCT.md') "# Product`n"
    Write-Utf8 (Join-Path $fixture 'docs/architecture.md') "# Architecture`n"
    Write-Utf8 (Join-Path $fixture 'docs/adr/0001-test.md') "# Test decision`n"
    Write-Utf8 (Join-Path $fixture 'src/core.ts') "export const value = 1;`n"
    Write-Utf8 (Join-Path $fixture 'src/extra.ts') "export const expandedMarker = 'EXPANDED-CONTEXT-MARKER';`n"
    Write-Utf8 (Join-Path $fixture 'host/vscode.ts') "export const vscode = true;`n"
    Write-Utf8 (Join-Path $fixture 'host/tauri.ts') "export const tauri = true;`n"
    Write-Utf8 (Join-Path $fixture 'tests/core.test.ts') "export const tested = true;`n"
    Write-Utf8 (Join-Path $fixture 'task.txt') "Challenge this bounded implementation plan.`n"
    $registry = @'
{
  "schemaVersion": 1,
  "canonicalSources": ["AGENTS.md", "PRODUCT.md", "docs/architecture.md"],
  "allowedExtensions": [".json", ".md", ".sdoc", ".ts", ".txt"],
  "deniedPatterns": [".git/**", "**/.env*"],
  "safeUntrackedPatterns": ["src/**", "tests/**"],
  "routes": [
    {"id":"core","concern":"core","changedPatterns":["src/**"],"sources":["src/core.ts"]},
    {"id":"tests","concern":"verification","changedPatterns":["tests/**"],"sources":["tests/core.test.ts"]}
  ],
  "relationships": [
    {"id":"cross-host-test","triggerPatterns":["src/**"],"requiredSources":["host/vscode.ts","host/tauri.ts","tests/core.test.ts"]}
  ]
}
'@
    Write-Utf8 (Join-Path $fixture 'routes.json') $registry
    & git -C $fixture init --quiet
    & git -C $fixture config core.autocrlf false
    & git -C $fixture config user.email 'tests@example.invalid'
    & git -C $fixture config user.name 'Advisor Context Tests'
    & git -C $fixture add .
    & git -C $fixture commit --quiet -m fixture
    if ($LASTEXITCODE -ne 0) { throw 'Failed to commit fixture.' }
    return $fixture
}

try {
    [void][IO.Directory]::CreateDirectory($testRoot)

    $registry = ([IO.File]::ReadAllText($defaultRegistryPath, [Text.Encoding]::UTF8) | ConvertFrom-Json)
    $referenced = @($registry.canonicalSources) + @($registry.routes | ForEach-Object { $_.sources }) + @($registry.relationships | ForEach-Object { $_.requiredSources })
    foreach ($path in @($referenced | Sort-Object -Unique)) { Assert-True (Test-Path -LiteralPath (Join-Path $repositoryRoot $path) -PathType Leaf) "Registry source is missing: $path" }
    Complete-Test 'default registry sources and relationship targets exist'

    $fixture = New-Fixture
    $first = Invoke-Generator $fixture -ChangedPath 'src/core.ts'
    $second = Invoke-Generator $fixture -ChangedPath 'src/core.ts'
    try {
        Assert-Equal $first.ExitCode 0 $first.Stderr; Assert-Equal $second.ExitCode 0 $second.Stderr
        Assert-Equal $first.Json.fingerprint $second.Json.fingerprint 'Selected-input fingerprint must be deterministic.'
        Assert-Equal $first.Json.selectionSha256 $second.Json.selectionSha256 'Coverage hash must be deterministic.'
        Assert-Equal $first.Json.contextSha256 $second.Json.contextSha256 'Bundle hash must be deterministic.'
        Assert-True ($first.Stdout -notmatch '# Agent rules|# Architecture') 'stdout leaked bundle content.'
        $coverage = [IO.File]::ReadAllText($first.Json.coveragePath, [Text.Encoding]::UTF8) | ConvertFrom-Json
        Assert-Equal $coverage.relationships[0].status 'satisfied' 'Mandatory relationship was not satisfied.'
        Assert-Equal @($coverage.unclassifiedPaths).Count 0 'Coverage reports unclassified paths.'
        $manifest = [IO.File]::ReadAllText($first.Json.integrityManifestPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
        Assert-Equal $manifest.selectedInputFingerprint $first.Json.fingerprint 'Manifest fingerprint differs from summary.'
        Assert-True (@($manifest.selectedInputs | Where-Object { $_.kind -eq 'adr-index-source' }).Count -eq 1) 'ADR index input was not hashed.'
        $coreBytes = [IO.File]::ReadAllBytes($first.Json.bundlePaths[0])
        Assert-True ($coreBytes.Length -lt 3 -or -not ($coreBytes[0] -eq 239 -and $coreBytes[1] -eq 187 -and $coreBytes[2] -eq 191)) 'Bundle has a UTF-8 BOM.'
        Assert-True (-not ([Text.Encoding]::UTF8.GetString($coreBytes).Contains("`r"))) 'Bundle contains non-deterministic CR line endings.'
    } finally { Remove-Artifact $first; Remove-Artifact $second }
    Complete-Test 'deterministic bundle, integrity manifest, and separate coverage'

    $fixture = New-Fixture
    $coreOnly = Invoke-Generator $fixture
    try {
        Assert-Equal $coreOnly.ExitCode 0 $coreOnly.Stderr
        Assert-Equal @($coreOnly.Json.shards).Count 0 'Core-only Planning unexpectedly made a concern shard.'
        Assert-Equal @($coreOnly.Json.bundlePaths).Count 1 'Core-only Planning must have exactly one bundle.'
    } finally { Remove-Artifact $coreOnly }
    Complete-Test 'Planning permits deterministic core-only context before paths are known'

    $fixture = New-Fixture
    $expanded = Invoke-Generator $fixture -RequestedPath 'src/extra.ts'
    try {
        Assert-Equal $expanded.ExitCode 0 $expanded.Stderr
        Assert-True $expanded.Json.expansionApplied 'Expansion flag was false.'
        $coreText = [IO.File]::ReadAllText($expanded.Json.bundlePaths[0], [Text.Encoding]::UTF8)
        Assert-True ($coreText.Contains('EXPANDED-CONTEXT-MARKER')) 'Expanded content is absent from the bundle.'
        Assert-True (@($expanded.Json.shards).Count -eq 1) 'Expansion did not activate its concern shard.'
        $coverage = [IO.File]::ReadAllText($expanded.Json.coveragePath, [Text.Encoding]::UTF8) | ConvertFrom-Json
        Assert-Equal $coverage.relationships[0].status 'satisfied' 'Expansion did not reapply relationship coverage.'
        foreach ($requiredPath in @('host/vscode.ts', 'host/tauri.ts', 'tests/core.test.ts')) {
            Assert-True (@($coverage.selectedPaths) -contains $requiredPath) "Expansion omitted required context: $requiredPath"
        }
    } finally { Remove-Artifact $expanded }
    Complete-Test 'single generator-side expansion is routed and bundled'

    $fixture = New-Fixture
    Write-Utf8 (Join-Path $fixture 'src/core.ts') "export const value = 2;`n"
    $final = Invoke-Generator $fixture -Mode FinalDiff
    try {
        Assert-Equal $final.ExitCode 0 $final.Stderr
        $manifest = [IO.File]::ReadAllText($final.Json.integrityManifestPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
        Assert-True (@($manifest.selectedInputs | Where-Object { $_.kind -eq 'exact-diff' }).Count -eq 1) 'Exact diff hash is missing.'
        $coreText = [IO.File]::ReadAllText($final.Json.bundlePaths[0], [Text.Encoding]::UTF8)
        Assert-True ($coreText.Contains('+export const value = 2;')) 'Exact diff is absent from core.'
        $shardText = [IO.File]::ReadAllText($final.Json.bundlePaths[1], [Text.Encoding]::UTF8)
        Assert-True (-not $shardText.Contains('===== SOURCE src/core.ts')) 'FinalDiff duplicated a changed source outside the exact diff.'
    } finally { Remove-Artifact $final }
    Complete-Test 'FinalDiff discovers and hashes the exact bounded diff'

    $fixture = New-Fixture
    Write-Utf8 (Join-Path $fixture 'unknown.txt') 'classified nowhere'
    & git -C $fixture add unknown.txt; & git -C $fixture commit --quiet -m unknown
    $unclassified = Invoke-Generator $fixture -ChangedPath 'unknown.txt'
    Assert-True ($unclassified.ExitCode -ne 0 -and $unclassified.Stderr -match 'not classified') 'Unclassified change did not fail closed.'
    Complete-Test 'unclassified paths fail closed'

    $fixture = New-Fixture
    Write-Utf8 (Join-Path $fixture 'src/new.ts') "export const fresh = true;`n"
    $explicit = Invoke-Generator $fixture -ChangedPath 'src/new.ts'
    try { Assert-Equal $explicit.ExitCode 0 $explicit.Stderr } finally { Remove-Artifact $explicit }
    Write-Utf8 (Join-Path $fixture 'tests/user.sdoc') '{"user":"document"}'
    $userDocument = Invoke-Generator $fixture -ChangedPath 'tests/user.sdoc' -IncludeUntrackedPath 'tests/user.sdoc'
    Assert-True ($userDocument.ExitCode -ne 0 -and $userDocument.Stderr -match 'user documents') 'Untracked user .sdoc was accepted.'
    Complete-Test 'ChangedPath explicitly selects safe untracked source while user documents are rejected'

    $fixture = New-Fixture
    Write-Utf8 (Join-Path $fixture 'src/untracked.ts') "export const untracked = true;`n"
    $implicitUntracked = Invoke-Generator $fixture -Mode FinalDiff
    Assert-True ($implicitUntracked.ExitCode -ne 0 -and $implicitUntracked.Stderr -match 'requires ChangeSetFile') 'FinalDiff silently omitted an ambient untracked file.'
    Complete-Test 'FinalDiff requires explicit task scope when untracked files exist'

    $fixture = New-Fixture
    $traversal = Invoke-Generator $fixture -RequestedPath '../outside.ts'
    Assert-True ($traversal.ExitCode -ne 0 -and $traversal.Stderr -match 'Unsafe repository-relative path') 'Traversal request was accepted.'
    Write-Utf8 (Join-Path $fixture 'src/core.ts') ('x' * 6000)
    $oversize = Invoke-Generator $fixture -ChangedPath 'src/core.ts' -MaximumBundleBytes 4096
    Assert-True ($oversize.ExitCode -ne 0 -and $oversize.Stderr -match 'maximum') 'Oversize bundle did not fail closed.'
    Complete-Test 'traversal and oversize bundles fail closed'

    $fixture = New-Fixture
    $fakeCredential = 'sk-' + 'abcdefghijklmnopqrstuvwxyz123456'
    Write-Utf8 (Join-Path $fixture 'src/deleted-secret.ts') "export const credential = '$fakeCredential';`n"
    & git -C $fixture add src/deleted-secret.ts; & git -C $fixture commit --quiet -m secret-fixture
    [IO.File]::Delete((Join-Path $fixture 'src/deleted-secret.ts'))
    $secretDiff = Invoke-Generator $fixture -Mode FinalDiff
    Assert-True ($secretDiff.ExitCode -ne 0 -and $secretDiff.Stderr -match 'credential') 'Deleted secret in exact diff was not rejected.'
    Complete-Test 'exact diff secret scan covers deleted content'

    Write-Host "All $script:passed advisor-context tests passed."
} finally {
    if ([IO.Directory]::Exists($testRoot)) {
        foreach ($file in [IO.Directory]::GetFiles($testRoot, '*', [IO.SearchOption]::AllDirectories)) { [IO.File]::SetAttributes($file, [IO.FileAttributes]::Normal) }
        [IO.Directory]::Delete($testRoot, $true)
    }
}
