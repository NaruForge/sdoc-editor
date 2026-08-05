# Generates deterministic, payload-only advisor context. The successful caller owns
# artifactDirectory and must remove that exact directory after the advisor finishes.
# Partial artifacts are removed here on every failure. Bundle contents are never sent
# to stdout; stdout is one compact JSON metadata object for invoke-advisor.ps1.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Planning', 'FinalDiff')]
    [string]$Mode,

    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$TaskSpecFile,

    [string]$WorkingDirectory = (Get-Location).Path,
    [string[]]$ChangedPath = @(),
    [string]$ChangeSetFile,
    [string]$BaseRef = 'HEAD',
    [string[]]$IncludeUntrackedPath = @(),
    [string]$ContextExpansionRequestFile,
    [string[]]$RequestedPath = @(),
    [ValidateRange(4096, 1048576)]
    [int]$MaximumBundleBytes = 262144,
    [ValidateRange(1, 6)]
    [int]$MaximumShardCount = 6,
    [string]$RoutingRegistryPath,
    [switch]$KeepArtifacts
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$script:Utf8Strict = New-Object System.Text.UTF8Encoding($false, $true)
$script:ArtifactPrefix = 'sdoc-advisor-context-'
$script:PerInputMaximumBytes = 131072
$artifactDirectory = $null

function Get-PropertyValue {
    param([object]$Object, [string]$Name)
    if ($null -eq $Object) { return $null }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function ConvertTo-Lf {
    param([AllowEmptyString()][string]$Text)
    return ($Text -replace "`r`n", "`n" -replace "`r", "`n")
}

function Get-Sha256Bytes {
    param([byte[]]$Bytes)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return ([System.BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
}

function Get-Sha256Text {
    param([AllowEmptyString()][string]$Text)
    return Get-Sha256Bytes -Bytes $script:Utf8NoBom.GetBytes($Text)
}

function Read-SafeTextFile {
    param([string]$Path, [int]$MaximumBytes = $script:PerInputMaximumBytes, [string]$Label = 'input')
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "$Label does not exist: $Path" }
    $bytes = [System.IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $Path).Path)
    if ($bytes.Length -gt $MaximumBytes) { throw "$Label exceeds $MaximumBytes bytes: $Path" }
    if ([Array]::IndexOf($bytes, [byte]0) -ge 0) { throw "$Label contains binary NUL bytes: $Path" }
    try { $text = $script:Utf8Strict.GetString($bytes) }
    catch { throw "$Label is not valid UTF-8: $Path" }
    Assert-NoSensitiveText $text "$Label ($Path)"
    return [pscustomobject]@{ Bytes = $bytes; Text = (ConvertTo-Lf $text); Sha256 = (Get-Sha256Bytes $bytes) }
}

function Assert-NoSensitiveText {
    param([AllowEmptyString()][string]$Text, [string]$Label)
    if ($Text -match '-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----' -or
        $Text -match '(?i)\bgithub_pat_[A-Za-z0-9_]{20,}\b' -or
        $Text -match '(?i)\bgh[pousr]_[A-Za-z0-9]{24,}\b' -or
        $Text -match '(?i)\b(?:xai|sk)-[A-Za-z0-9_-]{24,}\b') {
        throw "$Label appears to contain a credential or private key."
    }
}

function Convert-GlobToRegex {
    param([string]$Pattern)
    $builder = New-Object System.Text.StringBuilder
    [void]$builder.Append('^')
    for ($index = 0; $index -lt $Pattern.Length; $index++) {
        $character = $Pattern[$index]
        if ($character -eq '*') {
            if ($index + 1 -lt $Pattern.Length -and $Pattern[$index + 1] -eq '*') {
                [void]$builder.Append('.*'); $index++
            } else { [void]$builder.Append('[^/]*') }
        } elseif ($character -eq '?') { [void]$builder.Append('[^/]') }
        else { [void]$builder.Append([regex]::Escape([string]$character)) }
    }
    [void]$builder.Append('$')
    return $builder.ToString()
}

function Test-GlobSet {
    param([string]$Path, [object[]]$Patterns)
    foreach ($pattern in @($Patterns)) {
        if ($Path -cmatch (Convert-GlobToRegex ([string]$pattern))) { return $true }
    }
    return $false
}

function ConvertTo-RepositoryPath {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { throw 'Repository path cannot be empty.' }
    $candidate = $Path.Replace('\', '/')
    if ([System.IO.Path]::IsPathRooted($candidate) -or $candidate.StartsWith('/') -or
        $candidate -match '(^|/)\.\.(/|$)' -or $candidate -match '(^|/)\.(/|$)' -or
        $candidate.Contains([char]0)) { throw "Unsafe repository-relative path: $Path" }
    while ($candidate.StartsWith('./')) { $candidate = $candidate.Substring(2) }
    if ([string]::IsNullOrWhiteSpace($candidate)) { throw "Unsafe repository-relative path: $Path" }
    return $candidate
}

function Assert-NoRepositoryReparsePoint {
    param([string]$RepositoryRoot, [string]$RelativePath)
    $current = $RepositoryRoot
    foreach ($segment in $RelativePath.Replace('\', '/').Split('/')) {
        $current = Join-Path $current $segment
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force
            if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "Context path crosses a reparse point: $RelativePath"
            }
        }
    }
}

function Invoke-GitText {
    param([string]$RepositoryRoot, [string[]]$Arguments, [switch]$AllowFailure)
    $priorLocks = $env:GIT_OPTIONAL_LOCKS
    $priorErrorAction = $ErrorActionPreference
    $stderrPath = Join-Path ([System.IO.Path]::GetTempPath()) ('sdoc-advisor-git-' + [guid]::NewGuid().ToString('N') + '.stderr')
    $env:GIT_OPTIONAL_LOCKS = '0'
    $ErrorActionPreference = 'Continue'
    try {
        $lines = @(& git -C $RepositoryRoot @Arguments 2> $stderrPath | ForEach-Object { [string]$_ })
        $exitCode = $LASTEXITCODE
        $stderrText = if (Test-Path -LiteralPath $stderrPath) { [System.IO.File]::ReadAllText($stderrPath, $script:Utf8Strict) } else { '' }
    } finally {
        if ($null -eq $priorLocks) { Remove-Item Env:GIT_OPTIONAL_LOCKS -ErrorAction SilentlyContinue }
        else { $env:GIT_OPTIONAL_LOCKS = $priorLocks }
        $ErrorActionPreference = $priorErrorAction
        Remove-Item -LiteralPath $stderrPath -Force -ErrorAction SilentlyContinue
    }
    if ($exitCode -ne 0 -and -not $AllowFailure) { throw "git $($Arguments -join ' ') failed: $stderrText" }
    return [pscustomobject]@{ ExitCode = $exitCode; Text = (($lines -join "`n").TrimEnd("`n")) }
}

function Test-GitTracked {
    param([string]$RepositoryRoot, [string]$Path)
    $result = Invoke-GitText $RepositoryRoot @('ls-files', '--error-unmatch', '--', $Path) -AllowFailure
    return $result.ExitCode -eq 0
}

function Assert-RepositoryFileSafe {
    param(
        [string]$RepositoryRoot, [string]$RelativePath, [object]$Registry,
        [hashtable]$ExplicitUntracked, [switch]$AllowMissing
    )
    $relative = ConvertTo-RepositoryPath $RelativePath
    if (Test-GlobSet $relative @(Get-PropertyValue $Registry 'deniedPatterns')) { throw "Denied context path: $relative" }
    $extension = [System.IO.Path]::GetExtension($relative).ToLowerInvariant()
    $allowedExtensions = @((Get-PropertyValue $Registry 'allowedExtensions') | ForEach-Object { ([string]$_).ToLowerInvariant() })
    if ($allowedExtensions -notcontains $extension) { throw "Context file extension is not allowlisted: $relative" }
    $combined = [System.IO.Path]::GetFullPath((Join-Path $RepositoryRoot $relative))
    $rootPrefix = $RepositoryRoot.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
    if (-not $combined.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) { throw "Context path escapes repository: $relative" }
    Assert-NoRepositoryReparsePoint $RepositoryRoot $relative
    if (-not (Test-Path -LiteralPath $combined -PathType Leaf)) {
        if ($AllowMissing) { return $null }
        throw "Context file does not exist: $relative"
    }
    $resolved = (Resolve-Path -LiteralPath $combined).Path
    if (-not $resolved.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) { throw "Context symlink escapes repository: $relative" }
    if (-not (Test-GitTracked $RepositoryRoot $relative)) {
        if ($extension -ceq '.sdoc') { throw "Untracked .sdoc user documents cannot be advisor context: $relative" }
        if (-not $ExplicitUntracked.ContainsKey($relative) -or
            -not (Test-GlobSet $relative @(Get-PropertyValue $Registry 'safeUntrackedPatterns'))) {
            throw "Untracked context must be explicitly selected and match safeUntrackedPatterns: $relative"
        }
    }
    if ($extension -ceq '.sdoc' -and -not (Test-GlobSet $relative @('examples/**', 'tests/fixtures/**'))) {
        throw "Only routed tracked .sdoc examples or fixtures may be advisor context: $relative"
    }
    return $resolved
}

function Add-UniqueReason {
    param([hashtable]$Map, [string]$Path, [string]$Reason)
    if (-not $Map.ContainsKey($Path)) { $Map[$Path] = New-Object System.Collections.ArrayList }
    if (-not $Map[$Path].Contains($Reason)) { [void]$Map[$Path].Add($Reason) }
}

try {
    $repositoryRoot = (Resolve-Path -LiteralPath $WorkingDirectory).Path
    $inside = Invoke-GitText $repositoryRoot @('rev-parse', '--show-toplevel')
    $gitRoot = (Resolve-Path -LiteralPath $inside.Text).Path
    if ($gitRoot -cne $repositoryRoot) { $repositoryRoot = $gitRoot }

    if ([string]::IsNullOrWhiteSpace($RoutingRegistryPath)) {
        $RoutingRegistryPath = Join-Path $PSScriptRoot '../references/project-context.routes.json'
    }
    $registryResolvedPath = (Resolve-Path -LiteralPath $RoutingRegistryPath).Path
    $repositoryPrefix = $repositoryRoot.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    if (-not $registryResolvedPath.StartsWith($repositoryPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Routing registry must be a repository-relative file.'
    }
    $registryRelativePath = $registryResolvedPath.Substring($repositoryPrefix.Length).Replace('\', '/')
    $registryInput = Read-SafeTextFile $RoutingRegistryPath 131072 'routing registry'
    $registry = $registryInput.Text | ConvertFrom-Json
    if ((Get-PropertyValue $registry 'schemaVersion') -ne 1) { throw 'Unsupported routing registry schemaVersion.' }
    $routes = @(Get-PropertyValue $registry 'routes')
    $relationships = @(Get-PropertyValue $registry 'relationships')
    if ($routes.Count -eq 0) { throw 'Routing registry has no routes.' }

    $taskInput = Read-SafeTextFile $TaskSpecFile 65536 'task specification'
    if ([string]::IsNullOrWhiteSpace($taskInput.Text)) { throw 'Task specification cannot be empty.' }
    if ($BaseRef.StartsWith('-')) { throw 'BaseRef cannot begin with a dash.' }

    $explicitUntracked = @{}
    foreach ($path in @($IncludeUntrackedPath)) { $explicitUntracked[(ConvertTo-RepositoryPath $path)] = $true }
    $changed = New-Object System.Collections.ArrayList
    foreach ($path in @($ChangedPath)) {
        $normalizedChangedPath = ConvertTo-RepositoryPath $path
        [void]$changed.Add($normalizedChangedPath)
        $explicitUntracked[$normalizedChangedPath] = $true
    }
    if (-not [string]::IsNullOrWhiteSpace($ChangeSetFile)) {
        $changeInput = Read-SafeTextFile $ChangeSetFile 65536 'change set'
        $trimmed = $changeInput.Text.Trim()
        if ($trimmed.StartsWith('[')) {
            foreach ($path in @($trimmed | ConvertFrom-Json)) { $normalized = ConvertTo-RepositoryPath ([string]$path); [void]$changed.Add($normalized); $explicitUntracked[$normalized] = $true }
        } else {
            foreach ($line in @($changeInput.Text -split "`n")) { if (-not [string]::IsNullOrWhiteSpace($line)) { $normalized = ConvertTo-RepositoryPath $line.Trim(); [void]$changed.Add($normalized); $explicitUntracked[$normalized] = $true } }
        }
    }
    if ($changed.Count -eq 0 -and $Mode -eq 'FinalDiff') {
        $untracked = Invoke-GitText $repositoryRoot @('ls-files', '--others', '--exclude-standard')
        if (-not [string]::IsNullOrWhiteSpace($untracked.Text)) {
            throw 'FinalDiff requires ChangeSetFile when untracked files exist so task scope cannot be omitted.'
        }
        [void](Invoke-GitText $repositoryRoot @('rev-parse', '--verify', $BaseRef))
        $names = Invoke-GitText $repositoryRoot @('-c', 'core.quotepath=false', 'diff', '--name-only', '--relative', $BaseRef, '--')
        foreach ($line in @($names.Text -split "`n")) { if (-not [string]::IsNullOrWhiteSpace($line)) { [void]$changed.Add((ConvertTo-RepositoryPath $line.Trim())) } }
        foreach ($path in $explicitUntracked.Keys) { [void]$changed.Add($path) }
    }
    $changedPaths = @($changed | Sort-Object -Unique)
    if ($changedPaths.Count -eq 0 -and $Mode -ne 'Planning') { throw 'No changed paths were supplied or discovered.' }
    if (-not (Test-GitTracked $repositoryRoot $registryRelativePath)) {
        if (-not $explicitUntracked.ContainsKey($registryRelativePath) -or
            -not (Test-GlobSet $registryRelativePath @(Get-PropertyValue $registry 'safeUntrackedPatterns'))) {
            throw "Untracked routing registry must be explicitly present in ChangedPath, ChangeSetFile, or IncludeUntrackedPath: $registryRelativePath"
        }
    }

    $coverageRows = New-Object System.Collections.ArrayList
    $activeRoutes = @{}
    $activeConcerns = @{}
    foreach ($path in $changedPaths) {
        $matching = @($routes | Where-Object { Test-GlobSet $path @(Get-PropertyValue $_ 'changedPatterns') })
        if ($matching.Count -eq 0) { throw "Changed path is not classified by the routing registry: $path" }
        $routeIds = @($matching | ForEach-Object { [string](Get-PropertyValue $_ 'id') } | Sort-Object -Unique)
        $concerns = @($matching | ForEach-Object { [string](Get-PropertyValue $_ 'concern') } | Sort-Object -Unique)
        foreach ($route in $matching) { $activeRoutes[[string](Get-PropertyValue $route 'id')] = $route }
        foreach ($concern in $concerns) { $activeConcerns[$concern] = $true }
        [void]$coverageRows.Add([ordered]@{ path = $path; routes = $routeIds; concerns = $concerns })
    }
    $selectionReasons = @{}
    foreach ($path in @(Get-PropertyValue $registry 'canonicalSources')) { Add-UniqueReason $selectionReasons (ConvertTo-RepositoryPath ([string]$path)) 'canonical' }
    foreach ($routeId in @($activeRoutes.Keys | Sort-Object)) {
        $route = $activeRoutes[$routeId]
        foreach ($path in @(Get-PropertyValue $route 'sources')) { Add-UniqueReason $selectionReasons (ConvertTo-RepositoryPath ([string]$path)) ("route:$routeId") }
    }
    foreach ($path in $changedPaths) {
        $candidate = Assert-RepositoryFileSafe $repositoryRoot $path $registry $explicitUntracked -AllowMissing
        if ($null -ne $candidate) { Add-UniqueReason $selectionReasons $path 'changed-input' }
    }

    $relationshipRows = New-Object System.Collections.ArrayList
    foreach ($relationship in $relationships) {
        $triggered = @($changedPaths | Where-Object { Test-GlobSet $_ @(Get-PropertyValue $relationship 'triggerPatterns') }).Count -gt 0
        $required = @()
        if ($triggered) {
            $required = @((Get-PropertyValue $relationship 'requiredSources') | ForEach-Object { ConvertTo-RepositoryPath ([string]$_) } | Sort-Object -Unique)
            foreach ($path in $required) { Add-UniqueReason $selectionReasons $path ("relationship:$([string](Get-PropertyValue $relationship 'id'))") }
        }
        [void]$relationshipRows.Add([ordered]@{
            id = [string](Get-PropertyValue $relationship 'id')
            triggered = $triggered
            status = $(if ($triggered) { 'satisfied' } else { 'not_applicable' })
            requiredPaths = $required
        })
    }

    $expansionApplied = $false
    $expansionInput = $null
    if (-not [string]::IsNullOrWhiteSpace($ContextExpansionRequestFile) -and @($RequestedPath).Count -gt 0) {
        throw 'Use either ContextExpansionRequestFile or RequestedPath, not both.'
    }
    $requestedPaths = @()
    if (-not [string]::IsNullOrWhiteSpace($ContextExpansionRequestFile)) {
        $expansionInput = Read-SafeTextFile $ContextExpansionRequestFile 16384 'context expansion request'
        $request = $expansionInput.Text | ConvertFrom-Json
        if ((Get-PropertyValue $request 'schemaVersion') -ne 1 -or (Get-PropertyValue $request 'attempt') -ne 1) {
            throw 'Context expansion request must have schemaVersion 1 and attempt 1.'
        }
        $requestedPaths = @(Get-PropertyValue $request 'requestedPaths')
        if ($requestedPaths.Count -eq 0) { throw 'Context expansion request has no requestedPaths.' }
    } elseif (@($RequestedPath).Count -gt 0) {
        $requestedPaths = @($RequestedPath)
        $requestText = (ConvertTo-Json ([ordered]@{ schemaVersion = 1; attempt = 1; requestedPaths = $requestedPaths }) -Compress)
        $requestBytes = $script:Utf8NoBom.GetBytes($requestText)
        $expansionInput = [pscustomobject]@{ Bytes = $requestBytes; Text = $requestText; Sha256 = (Get-Sha256Bytes $requestBytes) }
    }
    if ($requestedPaths.Count -gt 0) {
        foreach ($pathValue in $requestedPaths) {
            $path = ConvertTo-RepositoryPath ([string]$pathValue)
            $matching = @($routes | Where-Object { Test-GlobSet $path @(Get-PropertyValue $_ 'changedPatterns') })
            if ($matching.Count -eq 0) { throw "Expansion path is not allowlisted by any route: $path" }
            foreach ($route in $matching) {
                $routeId = [string](Get-PropertyValue $route 'id')
                $activeRoutes[$routeId] = $route
                $activeConcerns[[string](Get-PropertyValue $route 'concern')] = $true
                foreach ($sourcePath in @(Get-PropertyValue $route 'sources')) {
                    Add-UniqueReason $selectionReasons (ConvertTo-RepositoryPath ([string]$sourcePath)) ("route:$routeId")
                }
            }
            [void](Assert-RepositoryFileSafe $repositoryRoot $path $registry $explicitUntracked)
            Add-UniqueReason $selectionReasons $path 'expansion:1'
        }
        $expansionApplied = $true
    }
    if ($requestedPaths.Count -gt 0) {
        [void]$relationshipRows.Clear()
        $impactPaths = @($changedPaths) + @($requestedPaths | ForEach-Object { ConvertTo-RepositoryPath ([string]$_) })
        foreach ($relationship in $relationships) {
            $relationshipId = [string](Get-PropertyValue $relationship 'id')
            $triggered = @($impactPaths | Where-Object { Test-GlobSet $_ @(Get-PropertyValue $relationship 'triggerPatterns') }).Count -gt 0
            $required = @()
            if ($triggered) {
                $required = @((Get-PropertyValue $relationship 'requiredSources') | ForEach-Object { ConvertTo-RepositoryPath ([string]$_) } | Sort-Object -Unique)
                foreach ($path in $required) { Add-UniqueReason $selectionReasons $path ("relationship:$relationshipId") }
            }
            [void]$relationshipRows.Add([ordered]@{ id = $relationshipId; triggered = $triggered; status = $(if ($triggered) { 'satisfied' } else { 'not_applicable' }); requiredPaths = $required })
        }
    }
    if ($activeConcerns.Count -gt $MaximumShardCount) { throw "Selected context requires $($activeConcerns.Count) concern shards; maximum is $MaximumShardCount." }

    $sourceRecords = New-Object System.Collections.ArrayList
    foreach ($path in @($selectionReasons.Keys | Sort-Object)) {
        $absolute = Assert-RepositoryFileSafe $repositoryRoot $path $registry $explicitUntracked
        $input = Read-SafeTextFile $absolute $script:PerInputMaximumBytes ("context source $path")
        [void]$sourceRecords.Add([pscustomobject]@{
            Path = $path; Text = $input.Text; Bytes = $input.Bytes.Length; Sha256 = $input.Sha256
            Reasons = @($selectionReasons[$path] | Sort-Object)
        })
    }

    $diffText = ''
    if ($Mode -eq 'FinalDiff') {
        [void](Invoke-GitText $repositoryRoot @('rev-parse', '--verify', $BaseRef))
        $trackedChanged = @($changedPaths | Where-Object { Test-GitTracked $repositoryRoot $_ })
        if ($trackedChanged.Count -gt 0) {
            $diffArguments = @('-c', 'core.quotepath=false', 'diff', '--no-ext-diff', '--no-color', '--full-index', '--unified=40', $BaseRef, '--') + $trackedChanged
            $diffText = (Invoke-GitText $repositoryRoot $diffArguments).Text
        }
        foreach ($path in @($changedPaths | Where-Object { -not (Test-GitTracked $repositoryRoot $_) })) {
            if (-not $explicitUntracked.ContainsKey($path)) { throw "FinalDiff includes untracked path that was not explicitly selected: $path" }
            $record = @($sourceRecords | Where-Object { $_.Path -ceq $path })[0]
            $embeddedHash = Get-Sha256Text $record.Text
            $diffText += "`ndiff --sdoc-untracked a/$path b/$path`nnew file sha256 $embeddedHash`n--- /dev/null`n+++ b/$path`n@@ full file @@`n$($record.Text)"
        }
        $diffText = (ConvertTo-Lf $diffText).Trim("`n")
        if ([string]::IsNullOrWhiteSpace($diffText)) { throw 'FinalDiff produced an empty exact diff.' }
        Assert-NoSensitiveText $diffText 'exact final diff'
    }

    $adrRows = New-Object System.Collections.ArrayList
    $adrList = Invoke-GitText $repositoryRoot @('ls-files', '--', 'docs/adr/*.md')
    foreach ($adrPath in @($adrList.Text -split "`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Sort-Object)) {
        $adrInput = Read-SafeTextFile (Join-Path $repositoryRoot $adrPath) $script:PerInputMaximumBytes ("ADR $adrPath")
        $titleLine = @($adrInput.Text -split "`n" | Where-Object { $_ -match '^#\s+' } | Select-Object -First 1)
        $title = $(if ($titleLine.Count -gt 0) { $titleLine[0] -replace '^#\s+', '' } else { '(untitled)' })
        [void]$adrRows.Add([pscustomobject]@{ Path = $adrPath; Title = $title; Bytes = $adrInput.Bytes.Length; Sha256 = $adrInput.Sha256 })
    }

    $inputManifestRows = New-Object System.Collections.ArrayList
    [void]$inputManifestRows.Add([ordered]@{ kind = 'configuration'; path = $registryRelativePath; bytes = $registryInput.Bytes.Length; sha256 = $registryInput.Sha256 })
    [void]$inputManifestRows.Add([ordered]@{ kind = 'task-spec'; path = 'task-spec'; bytes = $taskInput.Bytes.Length; sha256 = $taskInput.Sha256 })
    if ($null -ne $expansionInput) { [void]$inputManifestRows.Add([ordered]@{ kind = 'expansion-request'; path = 'context-expansion-request'; bytes = $expansionInput.Bytes.Length; sha256 = $expansionInput.Sha256 }) }
    if ($Mode -eq 'FinalDiff') {
        $diffBytes = $script:Utf8NoBom.GetBytes($diffText)
        [void]$inputManifestRows.Add([ordered]@{ kind = 'exact-diff'; path = "git-diff:$BaseRef"; bytes = $diffBytes.Length; sha256 = (Get-Sha256Bytes $diffBytes) })
    }
    foreach ($record in $sourceRecords) { [void]$inputManifestRows.Add([ordered]@{ kind = 'repository-source'; path = $record.Path; bytes = $record.Bytes; sha256 = $record.Sha256 }) }
    foreach ($adr in $adrRows) { [void]$inputManifestRows.Add([ordered]@{ kind = 'adr-index-source'; path = $adr.Path; bytes = $adr.Bytes; sha256 = $adr.Sha256 }) }
    $fingerprintLines = @($inputManifestRows | Sort-Object kind, path | ForEach-Object { "$($_.kind)`t$($_.path)`t$($_.bytes)`t$($_.sha256)" })
    $fingerprint = Get-Sha256Text (($fingerprintLines -join "`n") + "`n")

    $coverage = [ordered]@{
        schemaVersion = 1; mode = $Mode; registrySha256 = $registryInput.Sha256
        changedPaths = @($coverageRows); unclassifiedPaths = @()
        relationships = @($relationshipRows)
        selectedPaths = @($sourceRecords | ForEach-Object { $_.Path })
        selectionReasons = @($sourceRecords | ForEach-Object { [ordered]@{ path = $_.Path; reasons = $_.Reasons } })
        concernCount = $activeConcerns.Count; concerns = @($activeConcerns.Keys | Sort-Object)
        expansionApplied = $expansionApplied
    }
    $coverageJson = (ConvertTo-Json $coverage -Depth 10 -Compress)
    $selectionSha256 = Get-Sha256Text ($coverageJson + "`n")

    $artifactDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ($script:ArtifactPrefix + [System.Guid]::NewGuid().ToString('N'))
    [void][System.IO.Directory]::CreateDirectory($artifactDirectory)
    $coveragePath = Join-Path $artifactDirectory 'selection-coverage.json'
    [System.IO.File]::WriteAllText($coveragePath, $coverageJson + "`n", $script:Utf8NoBom)

    $coreBuilder = New-Object System.Text.StringBuilder
    [void]$coreBuilder.Append("SDOC ADVISOR CONTEXT v1`nMODE: $Mode`nSELECTED-INPUT-FINGERPRINT: $fingerprint`nSELECTION-COVERAGE-SHA256: $selectionSha256`n")
    [void]$coreBuilder.Append("CHANGED PATHS:`n$($changedPaths -join "`n")`n`nTASK SPECIFICATION:`n$($taskInput.Text.Trim("`n"))`n")
    if ($Mode -eq 'FinalDiff') { [void]$coreBuilder.Append("`nEXACT FINAL DIFF FROM ${BaseRef}:`n$diffText`n") }
    [void]$coreBuilder.Append("`nCROSS-SHARD RELATIONSHIPS:`n$(@($relationshipRows | ConvertTo-Json -Depth 6 -Compress) -join '')`n")
    [void]$coreBuilder.Append("`nADR INDEX (path | title | exact sha256):`n")
    foreach ($adr in $adrRows) { [void]$coreBuilder.Append("$($adr.Path) | $($adr.Title) | $($adr.Sha256)`n") }
    foreach ($record in @($sourceRecords | Where-Object { $_.Reasons -contains 'canonical' })) {
        [void]$coreBuilder.Append("`n===== SOURCE $($record.Path) sha256=$($record.Sha256) =====`n$($record.Text.Trim("`n"))`n")
    }
    foreach ($record in @($sourceRecords | Where-Object { $_.Reasons -contains 'expansion:1' })) {
        [void]$coreBuilder.Append("`n===== EXPANDED SOURCE $($record.Path) sha256=$($record.Sha256) =====`n$($record.Text.Trim("`n"))`n")
    }

    $bundleRecords = New-Object System.Collections.ArrayList
    $corePath = Join-Path $artifactDirectory '00-core.context.txt'
    [System.IO.File]::WriteAllText($corePath, $coreBuilder.ToString(), $script:Utf8NoBom)
    $coreBytes = [System.IO.File]::ReadAllBytes($corePath)
    [void]$bundleRecords.Add([ordered]@{ concern = 'canonical-core'; path = $corePath; bytes = $coreBytes.Length; sha256 = (Get-Sha256Bytes $coreBytes); selectedPaths = @($sourceRecords | Where-Object { $_.Reasons -contains 'canonical' } | ForEach-Object { $_.Path }) })

    $shardIndex = 1
    foreach ($concern in @($activeConcerns.Keys | Sort-Object)) {
        $builder = New-Object System.Text.StringBuilder
        [void]$builder.Append("SDOC ADVISOR CONCERN v1`nCONCERN: $concern`nSELECTED-INPUT-FINGERPRINT: $fingerprint`nSELECTION-COVERAGE-SHA256: $selectionSha256`n")
        $concernRoutes = @($routes | Where-Object { ([string](Get-PropertyValue $_ 'concern')) -ceq $concern -and $activeRoutes.ContainsKey([string](Get-PropertyValue $_ 'id')) })
        $concernRouteIds = @($concernRoutes | ForEach-Object { [string](Get-PropertyValue $_ 'id') })
        $concernChanged = @($coverageRows | Where-Object { @($_.concerns) -contains $concern } | ForEach-Object { $_.path })
        $concernSources = @($sourceRecords | Where-Object {
            $record = $_
            if ($Mode -eq 'FinalDiff' -and $changedPaths -contains $record.Path -and $record.Reasons -notcontains 'canonical') {
                return $false
            }
            $concernChanged -contains $record.Path -or @($record.Reasons | Where-Object {
                $reason = $_; @($concernRouteIds | Where-Object { $reason -ceq "route:$_" }).Count -gt 0 -or $reason.StartsWith('relationship:') -or $reason -ceq 'expansion:1'
            }).Count -gt 0
        })
        [void]$builder.Append("CHANGED PATHS FOR CONCERN:`n$($concernChanged -join "`n")`n")
        foreach ($record in $concernSources) { [void]$builder.Append("`n===== SOURCE $($record.Path) sha256=$($record.Sha256) =====`n$($record.Text.Trim("`n"))`n") }
        $safeConcern = ($concern -replace '[^A-Za-z0-9._-]', '-')
        $path = Join-Path $artifactDirectory ('{0:D2}-{1}.context.txt' -f $shardIndex, $safeConcern)
        [System.IO.File]::WriteAllText($path, $builder.ToString(), $script:Utf8NoBom)
        $bytes = [System.IO.File]::ReadAllBytes($path)
        [void]$bundleRecords.Add([ordered]@{ concern = $concern; path = $path; bytes = $bytes.Length; sha256 = (Get-Sha256Bytes $bytes); selectedPaths = @($concernSources | ForEach-Object { $_.Path }) })
        $shardIndex++
    }

    [int64]$totalBundleBytes = 0
    foreach ($bundle in $bundleRecords) { $totalBundleBytes += [int64]$bundle['bytes'] }
    if ($totalBundleBytes -gt $MaximumBundleBytes) { throw "Generated bundles use $totalBundleBytes bytes; maximum is $MaximumBundleBytes." }
    $contextLines = @($bundleRecords | ForEach-Object { "$($_.concern)`t$($_.bytes)`t$($_.sha256)" })
    $contextSha256 = Get-Sha256Text (($contextLines -join "`n") + "`n")

    $manifest = [ordered]@{
        schemaVersion = 1; mode = $Mode; selectedInputFingerprint = $fingerprint
        configurationSha256 = $registryInput.Sha256; selectionCoverageSha256 = $selectionSha256
        selectedInputs = @($inputManifestRows | Sort-Object kind, path)
        bundles = @($bundleRecords | ForEach-Object { [ordered]@{ concern = $_.concern; fileName = [System.IO.Path]::GetFileName($_.path); bytes = $_.bytes; sha256 = $_.sha256 } })
        contextSha256 = $contextSha256; totalBundleBytes = $totalBundleBytes
    }
    $manifestPath = Join-Path $artifactDirectory 'integrity-manifest.json'
    [System.IO.File]::WriteAllText($manifestPath, (ConvertTo-Json $manifest -Depth 10 -Compress) + "`n", $script:Utf8NoBom)

    $result = [ordered]@{
        schemaVersion = 1; mode = $Mode; contextStatus = 'complete'
        artifactDirectory = $artifactDirectory
        bundlePaths = @($bundleRecords | ForEach-Object { $_.path })
        integrityManifestPath = $manifestPath; coveragePath = $coveragePath
        contextSha256 = $contextSha256; fingerprint = $fingerprint; selectionSha256 = $selectionSha256
        selectedPaths = @($sourceRecords | ForEach-Object { $_.Path })
        shards = @($bundleRecords | Where-Object { $_.concern -cne 'canonical-core' })
        expansionApplied = $expansionApplied; callerMustDelete = (-not $KeepArtifacts.IsPresent)
    }
    [Console]::Out.WriteLine((ConvertTo-Json $result -Depth 10 -Compress))
} catch {
    if ($null -ne $artifactDirectory -and (Test-Path -LiteralPath $artifactDirectory -PathType Container)) {
        $resolvedTemp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
        $resolvedArtifact = [System.IO.Path]::GetFullPath($artifactDirectory)
        if ($resolvedArtifact.StartsWith($resolvedTemp, [System.StringComparison]::OrdinalIgnoreCase) -and
            [System.IO.Path]::GetFileName($resolvedArtifact).StartsWith($script:ArtifactPrefix, [System.StringComparison]::Ordinal)) {
            Remove-Item -LiteralPath $resolvedArtifact -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
    [Console]::Error.WriteLine("advisor-context: $($_.Exception.Message) [$($_.InvocationInfo.ScriptLineNumber)]")
    exit 4
}
