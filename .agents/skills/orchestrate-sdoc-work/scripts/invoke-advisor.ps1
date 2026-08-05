[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('grok', 'agy')]
    [string]$Provider,

    [Parameter(Mandatory = $true, ParameterSetName = 'InlinePrompt')]
    [ValidateNotNullOrEmpty()]
    [string]$Prompt,

    [Parameter(Mandatory = $true, ParameterSetName = 'PromptFile')]
    [ValidateNotNullOrEmpty()]
    [string]$PromptFile,

    [Parameter(Mandatory = $true, ParameterSetName = 'TaskSpec')]
    [ValidateNotNullOrEmpty()]
    [string]$TaskSpecFile,

    [ValidateSet('Legacy', 'Planning', 'FinalDiff')]
    [string]$CritiqueMode = 'Legacy',

    [string]$ChangeSetFile,
    [string]$BaseRef,
    [switch]$AllowContextExpansion,

    [string]$WorkingDirectory = (Get-Location).Path,
    [string]$Model,

    [ValidateRange(1, 1800)]
    [int]$TimeoutSeconds = 300,

    [ValidateSet('Auto', 'Json', 'Text')]
    [string]$OutputFormat = 'Auto',

    [ValidateSet('Summary', 'Full')]
    [string]$OutputDetail = 'Summary',

    [string]$ResultFile,
    [string]$ProviderExecutable,
    [string]$AdvisorContextScript,
    [switch]$DryRun,

    [Alias('AllowIncompleteResponse')]
    [switch]$DiagnosticMode
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:SchemaVersion = 2
$script:MaximumInputFileBytes = 65536
$script:MaximumLegacyPromptBytes = 1048576
$script:MaximumContextBytes = 393216
$script:MaximumProviderStdoutBytes = 1048576
$script:MaximumProviderStderrBytes = 131072
$script:MaximumResultBytes = 1048576
$script:MaximumSummaryBytes = 8192
$script:MaximumGeneratorOutputBytes = 65536
$script:Utf8 = [System.Text.UTF8Encoding]::new($false, $true)
$script:DisallowedTools = 'Bash,Edit,Read,Grep,MCPTool,WebFetch,WebSearch'
$script:DenyRules = @('*','Bash(*)','Edit(*)','Read(*)','Grep(*)','MCPTool(*)','WebFetch(*)','WebSearch(*)')

$script:FinalReviewSchema = '{"type":"object","additionalProperties":false,"required":["status","conclusion","confidence","evidence","findings","risks","assumptions"],"properties":{"status":{"type":"string","enum":["pass","changes_required","incomplete"]},"conclusion":{"type":"string","minLength":1},"confidence":{"type":"string","enum":["high","medium","low"]},"evidence":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["claim","support"],"properties":{"claim":{"type":"string","minLength":1},"support":{"type":"string","minLength":1},"file":{"type":"string"},"line":{"type":"integer","minimum":1}}}},"findings":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["severity","title","claim","evidence","recommendation"],"properties":{"severity":{"type":"string","enum":["critical","major","minor"]},"title":{"type":"string","minLength":1},"claim":{"type":"string","minLength":1},"evidence":{"type":"string","minLength":1},"recommendation":{"type":"string","minLength":1},"file":{"type":"string"},"line":{"type":"integer","minimum":1}}}},"risks":{"type":"array","items":{"type":"string"}},"assumptions":{"type":"array","items":{"type":"string"}}}}'
$script:PlanningReviewSchema = '{"type":"object","additionalProperties":false,"required":["status","contextStatus","requestedContext","conclusion","confidence","evidence","findings","risks","assumptions"],"properties":{"status":{"type":"string","enum":["pass","changes_required","incomplete"]},"contextStatus":{"type":"string","enum":["sufficient","needs_context"]},"requestedContext":{"type":"array","items":{"type":"string","minLength":1}},"conclusion":{"type":"string","minLength":1},"confidence":{"type":"string","enum":["high","medium","low"]},"evidence":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["claim","support"],"properties":{"claim":{"type":"string","minLength":1},"support":{"type":"string","minLength":1},"file":{"type":"string"},"line":{"type":"integer","minimum":1}}}},"findings":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["severity","title","claim","evidence","recommendation"],"properties":{"severity":{"type":"string","enum":["critical","major","minor"]},"title":{"type":"string","minLength":1},"claim":{"type":"string","minLength":1},"evidence":{"type":"string","minLength":1},"recommendation":{"type":"string","minLength":1},"file":{"type":"string"},"line":{"type":"integer","minimum":1}}}},"risks":{"type":"array","items":{"type":"string"}},"assumptions":{"type":"array","items":{"type":"string"}}}}'

function Add-ReviewInputDigestContract {
    param([Parameter(Mandatory = $true)][string]$Schema)
    $object=$Schema|ConvertFrom-Json
    $object.required=@('reviewInputSha256')+@($object.required)
    $object.properties|Add-Member -NotePropertyName reviewInputSha256 -NotePropertyValue ([pscustomobject]@{type='string';pattern='^[a-f0-9]{64}$'})
    return ($object|ConvertTo-Json -Depth 16 -Compress)
}
$script:FinalExplicitReviewSchema=Add-ReviewInputDigestContract $script:FinalReviewSchema
$script:PlanningReviewSchema=Add-ReviewInputDigestContract $script:PlanningReviewSchema

function Get-ObjectProperty {
    param([AllowNull()][object]$Object, [Parameter(Mandatory = $true)][string]$Name)
    if ($null -eq $Object) { return $null }
    if ($Object -is [System.Collections.IDictionary] -and $Object.Contains($Name)) { $value=$Object[$Name];if($value-is[System.Array]){return ,$value};return $value }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    if($property.Value-is[System.Array]){return ,$property.Value}
    return $property.Value
}

function Get-ExactObjectProperty {
    param([AllowNull()][object]$Object, [Parameter(Mandatory = $true)][string]$Name)
    if ($null -eq $Object) { return $null }
    foreach ($property in $Object.PSObject.Properties) {
        if ($property.Name -ceq $Name) { if($property.Value-is[System.Array]){return ,$property.Value};return $property.Value }
    }
    return $null
}

function Test-ExactPropertyContract {
    param([AllowNull()][object]$Object, [string[]]$Required, [string[]]$Optional = @())
    if ($null -eq $Object -or $Object -is [string] -or $Object -is [System.Array]) { return $false }
    $names = @($Object.PSObject.Properties | ForEach-Object { $_.Name })
    $allowed = @($Required) + @($Optional)
    foreach ($name in $names) {
        if (@($allowed | Where-Object { $_ -ceq $name }).Count -ne 1) { return $false }
    }
    foreach ($name in $Required) {
        if (@($names | Where-Object { $_ -ceq $name }).Count -ne 1) { return $false }
    }
    return $true
}

function ConvertTo-NativeArgument {
    param([AllowEmptyString()][string]$Value)
    if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') { return $Value }
    $builder = [System.Text.StringBuilder]::new()
    [void]$builder.Append('"')
    $slashes = 0
    foreach ($character in $Value.ToCharArray()) {
        if ($character -eq '\') { $slashes++; continue }
        if ($character -eq '"') {
            [void]$builder.Append(('\' * (($slashes * 2) + 1)))
            [void]$builder.Append('"'); $slashes = 0; continue
        }
        if ($slashes -gt 0) { [void]$builder.Append(('\' * $slashes)); $slashes = 0 }
        [void]$builder.Append($character)
    }
    if ($slashes -gt 0) { [void]$builder.Append(('\' * ($slashes * 2))) }
    [void]$builder.Append('"')
    return $builder.ToString()
}

function Get-Sha256 {
    param([Parameter(Mandatory = $true)][byte[]]$Bytes)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return (($sha.ComputeHash($Bytes) | ForEach-Object { $_.ToString('x2') }) -join '') }
    finally { $sha.Dispose() }
}

function Read-StrictUtf8File {
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][long]$MaximumBytes)
    $resolved = (Resolve-Path -LiteralPath $Path -ErrorAction Stop).Path
    if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) { throw "Input is not a file: $resolved" }
    $info = [System.IO.FileInfo]::new($resolved)
    if ($info.Length -gt $MaximumBytes) { throw "UTF-8 input exceeds the $MaximumBytes byte limit: $resolved" }
    $bytes = [System.IO.File]::ReadAllBytes($resolved)
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
        throw "UTF-8 input must not contain a BOM: $resolved"
    }
    try { $text = $script:Utf8.GetString($bytes) } catch { throw "Input is not valid UTF-8: $resolved" }
    return [pscustomobject]@{ Path = $resolved; Text = $text; Bytes = [long]$bytes.Length; Sha256 = Get-Sha256 -Bytes $bytes }
}

function Protect-SensitiveText {
    param([AllowNull()][string]$Text, [int]$MaximumLength = 2048)
    if ([string]::IsNullOrEmpty($Text)) { return '' }
    $safe = $Text
    $safe = [regex]::Replace($safe, '(?i)Bearer\s+[A-Za-z0-9._~+/=-]+', 'Bearer [REDACTED]')
    $safe = [regex]::Replace($safe, '(?i)\b(?:xai|sk)-[A-Za-z0-9_-]{8,}\b', '[REDACTED_TOKEN]')
    $safe = [regex]::Replace($safe, '(?i)\b(?:gh[pousr]_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,})\b', '[REDACTED_TOKEN]')
    $safe = [regex]::Replace($safe, '(?im)((?:api[_-]?key|authorization|password|token|secret)\s*[:=]\s*)\S+', '$1[REDACTED]')
    if ($safe.Length -gt $MaximumLength) { return $safe.Substring(0, $MaximumLength) + '...' }
    return $safe
}

function Add-BoundedText {
    param([System.Text.StringBuilder]$Builder, [string]$Chunk, [long]$LimitBytes, [ref]$CapturedBytes, [ref]$TotalBytes)
    if ([string]::IsNullOrEmpty($Chunk)) { return }
    $chunkBytes = $script:Utf8.GetByteCount($Chunk)
    $TotalBytes.Value = [long]$TotalBytes.Value + $chunkBytes
    $remaining = $LimitBytes - [long]$CapturedBytes.Value
    if ($remaining -le 0) { return }
    if ($chunkBytes -le $remaining) {
        [void]$Builder.Append($Chunk); $CapturedBytes.Value = [long]$CapturedBytes.Value + $chunkBytes; return
    }
    $low = 0; $high = $Chunk.Length
    while ($low -lt $high) {
        $mid = [int][Math]::Ceiling(($low + $high) / 2.0)
        if ($script:Utf8.GetByteCount($Chunk.Substring(0, $mid)) -le $remaining) { $low = $mid } else { $high = $mid - 1 }
    }
    if ($low -gt 0) {
        $part = $Chunk.Substring(0, $low); [void]$Builder.Append($part)
        $CapturedBytes.Value = [long]$CapturedBytes.Value + $script:Utf8.GetByteCount($part)
    }
}

function Invoke-NativeProcess {
    param(
        [string]$Executable, [string[]]$Arguments, [string]$Directory, [int]$TimeoutMilliseconds,
        [long]$StdoutLimitBytes = $script:MaximumProviderStdoutBytes,
        [long]$StderrLimitBytes = $script:MaximumProviderStderrBytes
    )
    $nativeArguments = (($Arguments | ForEach-Object { ConvertTo-NativeArgument -Value $_ }) -join ' ')
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $Executable; $startInfo.Arguments = $nativeArguments
    $startInfo.WorkingDirectory = $Directory; $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true; $startInfo.RedirectStandardOutput = $true; $startInfo.RedirectStandardError = $true
    if ($null -ne $startInfo.PSObject.Properties['StandardOutputEncoding']) {
        $startInfo.StandardOutputEncoding = $script:Utf8; $startInfo.StandardErrorEncoding = $script:Utf8
    }
    $process = [System.Diagnostics.Process]::new(); $process.StartInfo = $startInfo
    $clock = [System.Diagnostics.Stopwatch]::StartNew()
    $outBuilder = [System.Text.StringBuilder]::new(); $errBuilder = [System.Text.StringBuilder]::new()
    [long]$outCaptured = 0; [long]$errCaptured = 0; [long]$outTotal = 0; [long]$errTotal = 0
    try {
        if (-not $process.Start()) { throw "Failed to start $Executable." }
        $outBuffer = [char[]]::new(4096); $errBuffer = [char[]]::new(4096)
        $outTask = $process.StandardOutput.ReadAsync($outBuffer, 0, $outBuffer.Length)
        $errTask = $process.StandardError.ReadAsync($errBuffer, 0, $errBuffer.Length)
        $outDone = $false; $errDone = $false; $timedOut = $false
        while (-not ($outDone -and $errDone -and $process.HasExited)) {
            if (-not $outDone -and $outTask.IsCompleted) {
                $count = $outTask.GetAwaiter().GetResult()
                if ($count -eq 0) { $outDone = $true } else {
                    Add-BoundedText -Builder $outBuilder -Chunk ([string]::new($outBuffer, 0, $count)) -LimitBytes $StdoutLimitBytes -CapturedBytes ([ref]$outCaptured) -TotalBytes ([ref]$outTotal)
                    $outTask = $process.StandardOutput.ReadAsync($outBuffer, 0, $outBuffer.Length)
                }
            }
            if (-not $errDone -and $errTask.IsCompleted) {
                $count = $errTask.GetAwaiter().GetResult()
                if ($count -eq 0) { $errDone = $true } else {
                    Add-BoundedText -Builder $errBuilder -Chunk ([string]::new($errBuffer, 0, $count)) -LimitBytes $StderrLimitBytes -CapturedBytes ([ref]$errCaptured) -TotalBytes ([ref]$errTotal)
                    $errTask = $process.StandardError.ReadAsync($errBuffer, 0, $errBuffer.Length)
                }
            }
            if (-not $process.HasExited -and $clock.ElapsedMilliseconds -ge $TimeoutMilliseconds) {
                $timedOut = $true
                & taskkill.exe /PID $process.Id /T /F 2>$null | Out-Null
                if (-not $process.WaitForExit(5000)) { try { $process.Kill() } catch { } }
            }
            if ($timedOut -and $clock.ElapsedMilliseconds -ge ($TimeoutMilliseconds + 5000)) { break }
            if (-not ($outDone -and $errDone -and $process.HasExited)) { Start-Sleep -Milliseconds 5 }
        }
        if (-not $process.HasExited) { try { $process.Kill() } catch { } }
        return [pscustomobject]@{
            ExitCode = if ($timedOut) { -1 } else { $process.ExitCode }
            Stdout = $outBuilder.ToString(); Stderr = $errBuilder.ToString(); TimedOut = $timedOut
            StdoutBytes = $outTotal; StderrBytes = $errTotal
            StdoutTruncated = $outTotal -gt $StdoutLimitBytes; StderrTruncated = $errTotal -gt $StderrLimitBytes
            DurationMilliseconds = [int]$clock.ElapsedMilliseconds; NativeArguments = $nativeArguments
        }
    } finally { $clock.Stop(); $process.Dispose() }
}

function Resolve-ProviderCommand {
    param([string]$ProviderName, [AllowEmptyString()][string]$ExplicitPath)
    if (-not [string]::IsNullOrWhiteSpace($ExplicitPath)) {
        $path = (Resolve-Path -LiteralPath $ExplicitPath).Path
        if ([System.IO.Path]::GetExtension($path) -notin @('.exe', '.com')) { throw 'ProviderExecutable must be a native .exe or .com file.' }
        return $path
    }
    $command = Get-Command $ProviderName -CommandType Application -ErrorAction Stop | Select-Object -First 1
    if ([System.IO.Path]::GetExtension($command.Source) -notin @('.exe', '.com')) { throw "$ProviderName must resolve to a native executable." }
    return $command.Source
}

function Test-GrokModelName { param([AllowNull()][string]$Name); return (-not [string]::IsNullOrWhiteSpace($Name) -and $Name -cmatch '^grok-[A-Za-z0-9][A-Za-z0-9._-]*$') }
function Test-GrokModelAttestation {
    param([string]$SelectedModel, [string]$ActualModel)
    if (-not (Test-GrokModelName $SelectedModel) -or -not (Test-GrokModelName $ActualModel)) { return $false }
    return $ActualModel -ceq $SelectedModel -or $ActualModel -ceq ($SelectedModel + '-build')
}

function Test-AcknowledgementText {
    param([AllowNull()][string]$Text)
    if ([string]::IsNullOrWhiteSpace($Text) -or $Text.Trim().Length -lt 12) { return $true }
    $trimmed = $Text.Trim()
    if ($trimmed -match '(?i)^(?:I''ll|I\s+will|I\s+am\s+going\s+to|let\s+me|reviewing\b|will\s+review\b)') { return $true }
    foreach ($acknowledgement in @(
        ([string][char]0xAC80 + [char]0xD1A0 + [char]0xD558 + [char]0xACA0 + [char]0xC2B5 + [char]0xB2C8 + [char]0xB2E4),
        ([string][char]0xD655 + [char]0xC778 + [char]0xD558 + [char]0xACA0 + [char]0xC2B5 + [char]0xB2C8 + [char]0xB2E4),
        ([string][char]0xC0B4 + [char]0xD3B4 + [char]0xBCF4 + [char]0xACA0 + [char]0xC2B5 + [char]0xB2C8 + [char]0xB2E4)
    )) { if ($trimmed.StartsWith($acknowledgement, [System.StringComparison]::Ordinal)) { return $true } }
    return $false
}

function Get-StringArray {
    param([AllowNull()][object]$Value)
    if ($null -eq $Value -or $Value -isnot [System.Array]) { throw 'Expected a JSON string array.' }
    $items = @(); foreach ($item in @($Value)) { if ($item -isnot [string]) { throw 'Expected a JSON string array.' }; $items += [string]$item }
    return $items
}

function Test-ToolAttempt {
    param([string]$Stdout, [string]$Stderr, [AllowNull()][object]$Envelope)
    if ($Stderr -match '(?i)run_terminal_command|tool[_ -]?(?:use|call|request)|permission[^\r\n]*(?:denied|cancelled|canceled)|approval[^\r\n]*(?:denied|cancelled|canceled)') { return $true }
    if ($null -ne $Envelope) {
        foreach ($name in @($Envelope.PSObject.Properties | ForEach-Object { $_.Name })) {
            if ($name -match '(?i)^tool(?:Calls?|Uses?|Requests?)$') { return $true }
        }
    }
    if ($null -eq (Get-ExactObjectProperty $Envelope 'structuredOutput') -and $Stdout -match '(?i)run_terminal_command|"type"\s*:\s*"tool_use"|tool[_ -]?(?:use|call)') { return $true }
    return $false
}

function Get-ProcessFailureKind {
    param([AllowNull()][string]$Text)
    if ($Text -match '(?i)run_terminal_command|tool[_ -]?(?:use|call)|approval[^\r\n]*(?:denied|cancelled|canceled)') { return 'tool_attempt' }
    if ($Text -match '(?i)permission[^\r\n]*(?:denied|cancelled|canceled)|not permitted|forbidden tool') { return 'permission' }
    if ($Text -match '(?i)coverage[^\r\n]*(?:failed|missing|incomplete)|stale|hash[^\r\n]*(?:mismatch|failed)|fingerprint[^\r\n]*(?:mismatch|failed)') { return 'context_integrity' }
    if ($Text -match '(?i)\b(?:401|403)\b|unauthenticated|authentication|not logged in|login required') { return 'authentication' }
    if ($Text -match '(?i)unknown model|model[^\r\n]*(?:not found|unavailable|invalid)') { return 'model' }
    if ($Text -match '(?i)unexpected argument|unrecognized option|invalid JSON|json.schema|json-schema') { return 'arguments' }
    if ($Text -match '(?i)\b429\b|rate limit|capacity|overloaded|\b5\d\d\b|temporar|connection reset|service unavailable') { return 'transient' }
    return 'process'
}

function New-Metadata {
    param([AllowNull()][string]$CliVersion, [AllowNull()][string]$SelectedModel, [string]$Mode, [hashtable]$Context, [array]$Attempts, [int]$DurationMs, [hashtable]$ByteCounts, [AllowNull()][string]$PromptSha256, [AllowNull()][string]$ConfigFingerprint)
    return [ordered]@{
        cliVersion = $CliVersion; model = $SelectedModel; critiqueMode = $Mode
        contextSha256 = $Context.contextSha256; selectionSha256 = $Context.selectionSha256
        repositoryFingerprint = $Context.repositoryFingerprint; configFingerprint = $ConfigFingerprint
        discoveredConfiguration = $Context.configuration
        promptSha256 = $PromptSha256; byteCounts = $ByteCounts; attemptCount = @($Attempts).Count
        attempts = @($Attempts).Count; attemptOutcomes = @($Attempts); durationMs = $DurationMs
    }
}

function New-FailureResult {
    param([string]$Status, [string]$Kind, [string]$Message, [object]$Metadata, [string]$Mode)
    $result = [ordered]@{ schemaVersion = 2; provider = 'grok'; critiqueMode = $Mode; reviewStatus = $Status }
    if ($Mode -eq 'Planning') { $result.contextStatus = 'needs_context'; $result.requestedContext = @() }
    $result.conclusion = $Message; $result.confidence = 'low'; $result.evidence = @(); $result.findings = @(); $result.risks = @(); $result.assumptions = @()
    $result.error = [ordered]@{ kind = $Kind; message = $Message }; $result.metadata = $Metadata
    return $result
}

function ConvertFrom-GrokStructuredReview {
    param([string]$Stdout, [string]$Stderr, [string]$ExpectedModel, [object]$Metadata, [string]$Mode)
    if (Test-ToolAttempt -Stdout $Stdout -Stderr $Stderr -Envelope $null) {
        return [pscustomobject]@{ Complete = $false; Retryable = $false; Kind = 'tool_attempt'; Message = 'Grok attempted to use a tool during a payload-only critique.'; Result = $null; RequestedContext = @() }
    }
    try { $envelope = $Stdout | ConvertFrom-Json -ErrorAction Stop } catch {
        $trimmed=$Stdout.TrimEnd();$early=[string]::IsNullOrWhiteSpace($trimmed)-or-not$trimmed.EndsWith('}')
        return [pscustomobject]@{ Complete = $false; Retryable = $early; Kind = 'envelope'; Message = 'Grok returned an invalid or missing JSON envelope.'; Result = $null; RequestedContext = @() }
    }
    if (Test-ToolAttempt -Stdout $Stdout -Stderr $Stderr -Envelope $envelope) {
        return [pscustomobject]@{ Complete = $false; Retryable = $false; Kind = 'tool_attempt'; Message = 'Grok attempted to use a tool during a payload-only critique.'; Result = $null; RequestedContext = @() }
    }
    $structured = Get-ExactObjectProperty $envelope 'structuredOutput'
    if ($null -eq $structured -or $structured -is [string]) {
        return [pscustomobject]@{ Complete = $false; Retryable = ($Mode-eq'Legacy'); Kind = 'structured_output'; Message = 'Grok did not return the required structured output.'; Result = $null; RequestedContext = @() }
    }
    $required = @('status','conclusion','confidence','evidence','findings','risks','assumptions')
    if ($Mode -eq 'Planning') { $required = @('reviewInputSha256','status','contextStatus','requestedContext','conclusion','confidence','evidence','findings','risks','assumptions') }
    elseif($Mode -eq 'FinalDiff'){$required=@('reviewInputSha256')+$required}
    if (-not (Test-ExactPropertyContract -Object $structured -Required $required)) {
        return [pscustomobject]@{ Complete = $false; Retryable = $false; Kind = 'schema'; Message = 'Grok structured output violates the exact contract.'; Result = $null; RequestedContext = @() }
    }
    if($Mode-ne'Legacy'){
        $reviewInputSha256=Get-ExactObjectProperty $structured 'reviewInputSha256'
        $expectedDigest=[string](Get-ObjectProperty $Metadata 'contextSha256')
        if($reviewInputSha256-isnot[string]-or[string]$reviewInputSha256-cne$expectedDigest){
            return [pscustomobject]@{Complete=$false;Retryable=$false;Kind='context_digest';Message='Grok did not echo the exact generated context digest.';Result=$null;RequestedContext=@()}
        }
    }
    $models = @(); $modelUsage = Get-ExactObjectProperty $envelope 'modelUsage'
    if ($null -ne $modelUsage) { $models = @($modelUsage.PSObject.Properties | ForEach-Object { $_.Name }) }
    if ($models.Count -eq 0 -or @($models | Where-Object { -not (Test-GrokModelAttestation $ExpectedModel $_) }).Count -gt 0) {
        return [pscustomobject]@{ Complete = $false; Retryable = $false; Kind = 'model_attestation'; Message = 'Grok response did not attest the selected direct grok-* model.'; Result = $null; RequestedContext = @() }
    }
    $status = Get-ExactObjectProperty $structured 'status'; $conclusion = Get-ExactObjectProperty $structured 'conclusion'; $confidence = Get-ExactObjectProperty $structured 'confidence'
    if ($status -isnot [string] -or $conclusion -isnot [string] -or $confidence -isnot [string] -or @('pass','changes_required','incomplete') -cnotcontains [string]$status -or @('high','medium','low') -cnotcontains [string]$confidence) {
        return [pscustomobject]@{ Complete = $false; Retryable = $false; Kind = 'schema'; Message = 'Grok returned invalid scalar fields.'; Result = $null; RequestedContext = @() }
    }
    try { $risks = @(Get-StringArray (Get-ExactObjectProperty $structured 'risks')); $assumptions = @(Get-StringArray (Get-ExactObjectProperty $structured 'assumptions')) } catch {
        return [pscustomobject]@{ Complete = $false; Retryable = $false; Kind = 'schema'; Message = 'Grok returned invalid string arrays.'; Result = $null; RequestedContext = @() }
    }
    $contextStatus = $null; $requested = @()
    if ($Mode -eq 'Planning') {
        $contextStatus = Get-ExactObjectProperty $structured 'contextStatus'
        try { $requested = @(Get-StringArray (Get-ExactObjectProperty $structured 'requestedContext')) } catch { $contextStatus = 'invalid' }
        if (@('sufficient','needs_context') -cnotcontains [string]$contextStatus -or ($contextStatus -eq 'sufficient' -and $requested.Count -ne 0) -or ($contextStatus -eq 'needs_context' -and $requested.Count -eq 0)) {
            return [pscustomobject]@{ Complete = $false; Retryable = $false; Kind = 'schema'; Message = 'Planning contextStatus and requestedContext are contradictory.'; Result = $null; RequestedContext = @() }
        }
        if ($contextStatus -eq 'needs_context') {
            return [pscustomobject]@{ Complete = $false; Retryable = $false; Kind = 'context_requested'; Message = 'Grok requested additional allowlisted context.'; Result = $null; RequestedContext = $requested }
        }
    }
    if ($status -eq 'incomplete' -or (Test-AcknowledgementText $conclusion)) {
        return [pscustomobject]@{ Complete = $false; Retryable = ($Mode-eq'Legacy'); Kind = 'semantic'; Message = 'Grok review is incomplete or acknowledgement-only.'; Result = $null; RequestedContext = @() }
    }
    $evidenceValue = Get-ExactObjectProperty $structured 'evidence'; $findingsValue = Get-ExactObjectProperty $structured 'findings'
    if ($evidenceValue -isnot [System.Array] -or $findingsValue -isnot [System.Array]) {
        return [pscustomobject]@{ Complete = $false; Retryable = $false; Kind = 'schema'; Message = 'Evidence and findings must be arrays.'; Result = $null; RequestedContext = @() }
    }
    $evidence = @()
    foreach ($item in @($evidenceValue)) {
        if (-not (Test-ExactPropertyContract $item @('claim','support') @('file','line'))) { return [pscustomobject]@{ Complete=$false;Retryable=$false;Kind='schema';Message='Invalid evidence contract.';Result=$null;RequestedContext=@() } }
        $claim = Get-ExactObjectProperty $item 'claim'; $support = Get-ExactObjectProperty $item 'support'
        if ($claim -isnot [string] -or $support -isnot [string] -or [string]::IsNullOrWhiteSpace($claim) -or [string]::IsNullOrWhiteSpace($support)) { return [pscustomobject]@{ Complete=$false;Retryable=$false;Kind='schema';Message='Invalid evidence.';Result=$null;RequestedContext=@() } }
        $file = Get-ExactObjectProperty $item 'file'; $line = Get-ExactObjectProperty $item 'line'
        if (($null -ne $file -and ($file -isnot [string] -or [string]::IsNullOrWhiteSpace($file))) -or ($null -ne $line -and ($line -isnot [int] -and $line -isnot [long] -or [long]$line -lt 1))) { return [pscustomobject]@{ Complete=$false;Retryable=$false;Kind='schema';Message='Invalid optional evidence location.';Result=$null;RequestedContext=@() } }
        $normalized = [ordered]@{ claim=[string]$claim; support=[string]$support }
        foreach ($optional in @('file','line')) { $value=Get-ExactObjectProperty $item $optional; if ($null -ne $value) { $normalized[$optional]=$value } }
        $evidence += $normalized
    }
    $findings = @()
    foreach ($item in @($findingsValue)) {
        if (-not (Test-ExactPropertyContract $item @('severity','title','claim','evidence','recommendation') @('file','line'))) { return [pscustomobject]@{ Complete=$false;Retryable=$false;Kind='schema';Message='Invalid finding contract.';Result=$null;RequestedContext=@() } }
        $severity=Get-ExactObjectProperty $item 'severity'; $title=Get-ExactObjectProperty $item 'title'; $claim=Get-ExactObjectProperty $item 'claim'; $findingEvidence=Get-ExactObjectProperty $item 'evidence'; $recommendation=Get-ExactObjectProperty $item 'recommendation'
        if (@('critical','major','minor') -cnotcontains [string]$severity -or @($title,$claim,$findingEvidence,$recommendation | Where-Object { $_ -isnot [string] -or [string]::IsNullOrWhiteSpace([string]$_) }).Count -gt 0) { return [pscustomobject]@{ Complete=$false;Retryable=$false;Kind='schema';Message='Invalid finding.';Result=$null;RequestedContext=@() } }
        $file = Get-ExactObjectProperty $item 'file'; $line = Get-ExactObjectProperty $item 'line'
        if (($null -ne $file -and ($file -isnot [string] -or [string]::IsNullOrWhiteSpace($file))) -or ($null -ne $line -and ($line -isnot [int] -and $line -isnot [long] -or [long]$line -lt 1))) { return [pscustomobject]@{ Complete=$false;Retryable=$false;Kind='schema';Message='Invalid optional finding location.';Result=$null;RequestedContext=@() } }
        $normalized=[ordered]@{severity=[string]$severity;title=[string]$title;claim=[string]$claim;evidence=[string]$findingEvidence;recommendation=[string]$recommendation}
        foreach ($optional in @('file','line')) { $value=Get-ExactObjectProperty $item $optional; if ($null -ne $value) { $normalized[$optional]=$value } }
        $findings += $normalized
    }
    if ($evidence.Count -eq 0 -or ($status -eq 'pass' -and $findings.Count -ne 0) -or ($status -eq 'changes_required' -and $findings.Count -eq 0)) {
        return [pscustomobject]@{ Complete=$false;Retryable=$false;Kind='semantic';Message='Status, evidence, and findings are contradictory.';Result=$null;RequestedContext=@() }
    }
    $Metadata.model = $models[0]
    $result=[ordered]@{schemaVersion=2;provider='grok';critiqueMode=$Mode;reviewStatus=[string]$status}
    if($Mode-ne'Legacy'){$result.reviewInputSha256=[string]$reviewInputSha256}
    if($Mode -eq 'Planning'){$result.contextStatus=[string]$contextStatus;$result.requestedContext=@($requested)}
    $result.conclusion=[string]$conclusion;$result.confidence=[string]$confidence;$result.evidence=$evidence;$result.findings=$findings;$result.risks=$risks;$result.assumptions=$assumptions;$result.metadata=$Metadata
    return [pscustomobject]@{Complete=$true;Retryable=$false;Kind=$null;Message=$null;Result=$result;RequestedContext=@()}
}

function Test-SafeArtifactDirectory {
    param([string]$Path)
    try { $full=[System.IO.Path]::GetFullPath($Path); $temp=[System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\','/'); $parent=[System.IO.DirectoryInfo]::new($full).Parent.FullName.TrimEnd('\','/') } catch { return $false }
    return $parent.Equals($temp, [System.StringComparison]::OrdinalIgnoreCase) -and [System.IO.Path]::GetFileName($full) -match '^sdoc-advisor-context-[A-Za-z0-9-]+$'
}

function Test-PathInsideDirectory {
    param([string]$Path,[string]$Directory)
    try{$full=[System.IO.Path]::GetFullPath($Path);$root=[System.IO.Path]::GetFullPath($Directory).TrimEnd('\','/')+[System.IO.Path]::DirectorySeparatorChar}catch{return $false}
    return $full.StartsWith($root,[System.StringComparison]::OrdinalIgnoreCase)
}

function Test-GeneratedContextIntegrity {
    param([object]$Context,[string]$Root,[string]$SpecPath)
    try{
        $artifact=[string](Get-ObjectProperty $Context 'artifactDirectory');$manifestPath=[string](Get-ObjectProperty $Context 'integrityManifestPath')
        if(-not(Test-SafeArtifactDirectory $artifact)-or-not(Test-PathInsideDirectory $manifestPath $artifact)){throw 'Manifest path escaped the context artifact directory.'}
        $manifestInput=Read-StrictUtf8File $manifestPath $script:MaximumGeneratorOutputBytes;$manifest=$manifestInput.Text|ConvertFrom-Json -ErrorAction Stop
        $declaredBundlePaths=@((Get-ObjectProperty $Context 'bundlePaths')|ForEach-Object{[System.IO.Path]::GetFullPath([string]$_)}|Sort-Object)
        $manifestBundlePaths=@(@((Get-ObjectProperty $manifest 'bundles'))|ForEach-Object{
            $fileName=[string](Get-ObjectProperty $_ 'fileName')
            [System.IO.Path]::GetFullPath((Join-Path $artifact $fileName))
        }|Sort-Object)
        if($declaredBundlePaths.Count-ne$manifestBundlePaths.Count-or(Compare-Object $declaredBundlePaths $manifestBundlePaths)){throw 'Context bundle list does not match the integrity manifest.'}
        foreach($bundle in @((Get-ObjectProperty $manifest 'bundles'))){
            $bundlePath=Join-Path $artifact ([string](Get-ObjectProperty $bundle 'fileName'));if(-not(Test-PathInsideDirectory $bundlePath $artifact)){throw 'Bundle path escaped the context artifact directory.'}
            $actual=Read-StrictUtf8File $bundlePath $script:MaximumContextBytes;if($actual.Sha256-cne[string](Get-ObjectProperty $bundle 'sha256')){throw 'Generated bundle hash changed.'}
        }
        foreach($selected in @((Get-ObjectProperty $manifest 'selectedInputs'))){
            $kind=[string](Get-ObjectProperty $selected 'kind');$relative=[string](Get-ObjectProperty $selected 'path');$expected=[string](Get-ObjectProperty $selected 'sha256')
            if($kind-eq'task-spec'){$source=$SpecPath}
            elseif($kind-in@('repository-source','configuration')){$source=Join-Path $Root $relative;if(-not([System.IO.Path]::GetFullPath($source).StartsWith(([System.IO.Path]::GetFullPath($Root).TrimEnd('\','/')+[System.IO.Path]::DirectorySeparatorChar),[System.StringComparison]::OrdinalIgnoreCase))){throw 'Selected input escaped the repository.'}}
            else{continue}
            $actual=Read-StrictUtf8File $source $script:MaximumContextBytes;if($actual.Sha256-cne$expected){throw "Selected input changed after context generation: $relative"}
        }
        return [pscustomobject]@{Valid=$true;Kind=$null;Message=$null}
    }catch{return [pscustomobject]@{Valid=$false;Kind='stale_context';Message=(Protect-SensitiveText $_.Exception.Message)}}
}

function Invoke-ContextGenerator {
    param([string]$Mode,[string]$Root,[string]$SpecFile,[AllowNull()][string]$Changes,[AllowNull()][string]$Ref,[string[]]$Requested,[int]$TimeoutMs,[AllowNull()][string]$ExplicitScript)
    $scriptPath=if([string]::IsNullOrWhiteSpace($ExplicitScript)){Join-Path $PSScriptRoot 'advisor-context.ps1'}else{(Resolve-Path -LiteralPath $ExplicitScript -ErrorAction Stop).Path}
    if(-not(Test-Path -LiteralPath $scriptPath -PathType Leaf)){throw 'Explicit critique modes require scripts/advisor-context.ps1.'}
    $hostExe=if($PSVersionTable.PSEdition -eq 'Core'){Join-Path $PSHOME 'pwsh.exe'}else{Join-Path $PSHOME 'powershell.exe'}
    $args=@('-NoProfile','-NonInteractive','-File',$scriptPath,'-Mode',$Mode,'-WorkingDirectory',$Root,'-TaskSpecFile',$SpecFile)
    if(-not[string]::IsNullOrWhiteSpace($Changes)){$args+=@('-ChangeSetFile',$Changes)}
    if(-not[string]::IsNullOrWhiteSpace($Ref)){$args+=@('-BaseRef',$Ref)}
    $args+=@('-MaximumBundleBytes','262144','-MaximumShardCount','6')
    $requestFile=$null
    if(@($Requested).Count -gt 0){
        $requestFile=Join-Path ([System.IO.Path]::GetTempPath()) ('sdoc-context-expansion-'+[guid]::NewGuid().ToString('N')+'.json')
        $request=[ordered]@{schemaVersion=1;attempt=1;requestedPaths=@($Requested);reason='Grok requested additional allowlisted planning context.'}
        [System.IO.File]::WriteAllBytes($requestFile,$script:Utf8.GetBytes(($request|ConvertTo-Json -Depth 4 -Compress)))
        $args+=@('-ContextExpansionRequestFile',$requestFile)
    }
    try{$process=Invoke-NativeProcess -Executable $hostExe -Arguments $args -Directory $Root -TimeoutMilliseconds $TimeoutMs -StdoutLimitBytes $script:MaximumGeneratorOutputBytes -StderrLimitBytes $script:MaximumProviderStderrBytes}
    finally{if($requestFile-and(Test-Path -LiteralPath $requestFile -PathType Leaf)){Remove-Item -LiteralPath $requestFile -Force -ErrorAction SilentlyContinue}}
    if($process.TimedOut){throw 'Context generator timed out.'}
    if($process.StdoutTruncated){throw 'Context generator output exceeded its compact-output limit.'}
    if($process.ExitCode -ne 0){throw ('Context generator failed: '+(Protect-SensitiveText $process.Stderr))}
    try{$context=$process.Stdout|ConvertFrom-Json -ErrorAction Stop}catch{throw 'Context generator did not return compact JSON.'}
    $artifact=[string](Get-ObjectProperty $context 'artifactDirectory')
    if([string]::IsNullOrWhiteSpace($artifact)-or -not(Test-SafeArtifactDirectory $artifact)){throw 'Context generator returned an unsafe artifact directory.'}
    if((Get-ObjectProperty $context 'callerMustDelete') -ne $true){throw 'Context generator did not transfer artifact cleanup ownership.'}
    return $context
}

function Get-ContextPayload {
    param([object]$Context)
    $paths=@(); foreach($name in @('bundlePaths','integrityManifestPath','coveragePath')){$value=Get-ObjectProperty $Context $name;if($value -is [System.Array]){$paths+=@($value)}elseif(-not[string]::IsNullOrWhiteSpace([string]$value)){$paths+=[string]$value}}
    $paths=@($paths|Select-Object -Unique);$artifact=[string](Get-ObjectProperty $Context 'artifactDirectory');$builder=[System.Text.StringBuilder]::new();[long]$total=0
    foreach($path in $paths){if(-not(Test-PathInsideDirectory ([string]$path) $artifact)){throw 'Generated context path escaped the artifact directory.'};$remaining=$script:MaximumContextBytes-$total;if($remaining -le 0){throw 'Generated context exceeds the wrapper context limit.'};$input=Read-StrictUtf8File -Path ([string]$path) -MaximumBytes $remaining;$total+=$input.Bytes;[void]$builder.AppendLine(('=== CONTEXT {0} sha256={1} ==='-f([System.IO.Path]::GetFileName($input.Path)),$input.Sha256));[void]$builder.AppendLine($input.Text)}
    if($paths.Count -eq 0 -or $total -eq 0){throw 'Context generator returned no readable payload artifacts.'}
    return [pscustomobject]@{Text=$builder.ToString();Bytes=$total}
}

function Write-StrictUtf8Result {
    param([string]$Path,[string]$Json,[string[]]$ProtectedInputs)
    $full=[System.IO.Path]::GetFullPath($Path);foreach($input in $ProtectedInputs){if(-not[string]::IsNullOrWhiteSpace($input)-and $full.Equals([System.IO.Path]::GetFullPath($input),[System.StringComparison]::OrdinalIgnoreCase)){throw 'ResultFile must not overwrite an input file.'}}
    $parent=[System.IO.Path]::GetDirectoryName($full);if(-not(Test-Path -LiteralPath $parent -PathType Container)){throw 'ResultFile parent directory does not exist.'}
    $bytes=$script:Utf8.GetBytes($Json);if($bytes.Length -gt $script:MaximumResultBytes){throw 'Full result exceeds the result-file size limit.'}
    [System.IO.File]::WriteAllBytes($full,$bytes);return $full
}

function Write-AdvisorResult {
    param([object]$Result,[string]$Format,[string]$Detail,[AllowNull()][string]$File,[string[]]$ProtectedInputs)
    $fullJson=$Result|ConvertTo-Json -Depth 16 -Compress
    $metadata=Get-ObjectProperty $Result 'metadata';$counts=Get-ObjectProperty $metadata 'byteCounts'
    if($counts-is[System.Collections.IDictionary]){$counts['result']=$script:Utf8.GetByteCount($fullJson);$fullJson=$Result|ConvertTo-Json -Depth 16 -Compress;$counts['result']=$script:Utf8.GetByteCount($fullJson);$fullJson=$Result|ConvertTo-Json -Depth 16 -Compress}
    if($script:Utf8.GetByteCount($fullJson)-gt$script:MaximumResultBytes){throw 'Full result exceeds the strict output limit.'}
    $written=$null
    if(-not[string]::IsNullOrWhiteSpace($File)){$written=Write-StrictUtf8Result -Path $File -Json $fullJson -ProtectedInputs $ProtectedInputs}
    if($Detail -eq 'Full'){$output=$fullJson}else{
        $findingsValue=Get-ObjectProperty $Result 'findings';$findings=@();if($null-ne$findingsValue){$findings=@($findingsValue)};$titles=@($findings|Select-Object -First 3|ForEach-Object{[ordered]@{severity=Get-ObjectProperty $_ 'severity';title=Protect-SensitiveText ([string](Get-ObjectProperty $_ 'title')) 256}})
        $summary=[ordered]@{schemaVersion=2;provider=Get-ObjectProperty $Result 'provider';critiqueMode=Get-ObjectProperty $Result 'critiqueMode';reviewStatus=Get-ObjectProperty $Result 'reviewStatus';conclusion=Protect-SensitiveText ([string](Get-ObjectProperty $Result 'conclusion')) 1024;findingCount=$findings.Count;topFindings=$titles;resultFile=$written}
        if($null-ne$metadata){$summary.metadata=[ordered]@{model=Get-ObjectProperty $metadata 'model';attemptCount=Get-ObjectProperty $metadata 'attemptCount';durationMs=Get-ObjectProperty $metadata 'durationMs';contextSha256=Get-ObjectProperty $metadata 'contextSha256';selectionSha256=Get-ObjectProperty $metadata 'selectionSha256';repositoryFingerprint=Get-ObjectProperty $metadata 'repositoryFingerprint';configFingerprint=Get-ObjectProperty $metadata 'configFingerprint'}}
        $output=$summary|ConvertTo-Json -Depth 8 -Compress
        if($script:Utf8.GetByteCount($output)-gt$script:MaximumSummaryBytes){$summary.topFindings=@();$summary.conclusion=Protect-SensitiveText ([string]$summary.conclusion) 256;$output=$summary|ConvertTo-Json -Depth 6 -Compress}
    }
    if($Format -eq 'Json'){Write-Output $output;return}
    $status=[string](Get-ObjectProperty $Result 'reviewStatus');Write-Output 'Conclusion';Write-Output ([string](Get-ObjectProperty $Result 'conclusion'));Write-Output '';Write-Output 'Findings';$itemsValue=Get-ObjectProperty $Result 'findings';$items=@();if($null-ne$itemsValue){$items=@($itemsValue)};if($status-eq'pass'-and$items.Count-eq0){Write-Output 'NO_ACTIONABLE_FINDINGS'}elseif($items.Count-eq0){Write-Output ('REVIEW_'+$status.ToUpperInvariant())}else{foreach($item in $items){Write-Output ('- [{0}] {1}: {2}'-f(Get-ObjectProperty $item 'severity'),(Get-ObjectProperty $item 'title'),(Get-ObjectProperty $item 'claim'))}}
    if($written){Write-Output ('Full result: '+$written)}
}

$resolvedOutputFormat=if($OutputFormat-eq'Auto'){if($Provider-eq'grok'){'Json'}else{'Text'}}else{$OutputFormat}
$resolvedOutputDetail=if($CritiqueMode-eq'Legacy'-and-not$PSBoundParameters.ContainsKey('OutputDetail')){'Full'}else{$OutputDetail}
$artifactDirectories=@();$overallClock=$null;$attemptRecords=@();$selectedModel=$Model;$cliVersion=$null;$promptSha=$null;$configFingerprint=$null
$contextMetadata=@{contextSha256=$null;selectionSha256=$null;repositoryFingerprint=$null;configuration=$null}
$byteCounts=@{taskSpec=0;context=0;payload=0;providerStdout=0;providerStderr=0}
$protectedInputs=@($PromptFile,$TaskSpecFile,$ChangeSetFile)|Where-Object{-not[string]::IsNullOrWhiteSpace($_)}

try{
    $root=(Resolve-Path -LiteralPath $WorkingDirectory).Path
    if($CritiqueMode-eq'Legacy'-and$PSCmdlet.ParameterSetName-eq'TaskSpec'){throw 'TaskSpecFile requires CritiqueMode Planning or FinalDiff.'}
    if($CritiqueMode-ne'Legacy'-and$PSCmdlet.ParameterSetName-ne'TaskSpec'){throw 'Planning and FinalDiff require TaskSpecFile.'}
    if($CritiqueMode-ne'Legacy'-and$Provider-ne'grok'){throw 'Required Planning and FinalDiff critiques use the direct Grok provider.'}
    if($AllowContextExpansion-and$CritiqueMode-ne'Planning'){throw 'AllowContextExpansion is valid only for Planning.'}
    $commandPath=Resolve-ProviderCommand $Provider $ProviderExecutable
    if($PSCmdlet.ParameterSetName-eq'InlinePrompt'){$taskText=$Prompt;$taskBytes=$script:Utf8.GetByteCount($Prompt);if($taskBytes-gt$script:MaximumLegacyPromptBytes){throw 'Inline prompt exceeds the legacy input limit.'}}
    elseif($PSCmdlet.ParameterSetName-eq'PromptFile'){$input=Read-StrictUtf8File $PromptFile $script:MaximumLegacyPromptBytes;$taskText=$input.Text;$taskBytes=$input.Bytes}
    else{$input=Read-StrictUtf8File $TaskSpecFile $script:MaximumInputFileBytes;$taskText=$input.Text;$taskBytes=$input.Bytes}
    if([string]::IsNullOrWhiteSpace($taskText)){throw 'The task specification must not be empty.'};$byteCounts.taskSpec=$taskBytes

    $context=$null;$contextPayload=''
    if($CritiqueMode-ne'Legacy'){
        $context=Invoke-ContextGenerator $CritiqueMode $root $input.Path $ChangeSetFile $BaseRef @() ([Math]::Min(60000,$TimeoutSeconds*1000)) $AdvisorContextScript
        $artifact=[string](Get-ObjectProperty $context 'artifactDirectory');$artifactDirectories+=$artifact
        $bundle=Get-ContextPayload $context;$contextPayload=$bundle.Text;$byteCounts.context=$bundle.Bytes
        $contextMetadata.contextSha256=[string](Get-ObjectProperty $context 'contextSha256');if([string]::IsNullOrWhiteSpace($contextMetadata.contextSha256)){$contextMetadata.contextSha256=[string](Get-ObjectProperty $context 'fingerprint')}
        $contextMetadata.selectionSha256=[string](Get-ObjectProperty $context 'selectionSha256');$contextMetadata.repositoryFingerprint=[string](Get-ObjectProperty $context 'fingerprint')
        foreach($requiredHash in @('contextSha256','selectionSha256','repositoryFingerprint')){if([string]::IsNullOrWhiteSpace([string]$contextMetadata[$requiredHash])){throw "Context generator omitted $requiredHash."}}
        $initialIntegrity=Test-GeneratedContextIntegrity $context $root $input.Path;if(-not$initialIntegrity.Valid){throw ('STALE_CONTEXT: '+$initialIntegrity.Message)}
    }
    $schema=if($CritiqueMode-eq'Planning'){$script:PlanningReviewSchema}elseif($CritiqueMode-eq'FinalDiff'){$script:FinalExplicitReviewSchema}else{$script:FinalReviewSchema}
    $safetyConfig=[ordered]@{schemaVersion=2;critiqueMode=$CritiqueMode;permissionMode='dontAsk';tools='';disallowedTools=$script:DisallowedTools;deny=$script:DenyRules;maxTurns=1;memory=$false;subagents=$false;web=$false;autoUpdate=$false;schemaSha256=Get-Sha256 $script:Utf8.GetBytes($schema)}
    $configFingerprint=Get-Sha256 $script:Utf8.GetBytes(($safetyConfig|ConvertTo-Json -Compress))
    if($DiagnosticMode){$advisory="Connectivity diagnostic only. Do not use tools. Respond briefly.`n`nTask:`n$taskText"}
    elseif($CritiqueMode-eq'Planning'){$advisory="Perform a payload-only adversarial planning critique. You have no tools and must use only this payload. Challenge assumptions, counterexamples, simpler alternatives, missing constraints, and wrong-direction risk. Use contextStatus needs_context only with precise repository-relative requestedContext paths; otherwise sufficient. Set reviewInputSha256 exactly to $($contextMetadata.contextSha256). Return the completed structured result now.`n`n$contextPayload"}
    elseif($CritiqueMode-eq'FinalDiff'){$advisory="Perform a payload-only final-diff critique. You have no tools and must use only this payload. Check regressions, counterexamples, security or data-loss risk, host parity, coverage, and missing tests. Set reviewInputSha256 exactly to $($contextMetadata.contextSha256). Return pass only with substantive evidence and no findings; changes_required only with actionable findings.`n`n$contextPayload"}
    else{$advisory="Act as a read-only advisory reviewer. Do not use tools, modify files, or invoke agents. Return the completed review now with substantive evidence. Use pass only with no actionable findings and changes_required only with findings.`n`nTask:`n$taskText"}
    $advisoryBytes=$script:Utf8.GetBytes($advisory);if($advisoryBytes.Length-gt$script:MaximumContextBytes+$script:MaximumInputFileBytes){throw 'Advisory payload exceeds the strict input limit.'};$byteCounts.payload=$advisoryBytes.Length;$promptSha=Get-Sha256 $advisoryBytes
    $baseArgs=@('--cwd',$root,'--permission-mode','dontAsk','--tools','','--disallowed-tools',$script:DisallowedTools)
    foreach($denyRule in $script:DenyRules){$baseArgs+=@('--deny',$denyRule)}
    $baseArgs+=@('--no-plan','--no-subagents','--no-memory','--disable-web-search','--no-auto-update','--max-turns','1','--verbatim')
    $previewPlaceholder=if($CritiqueMode-eq'Legacy'){'<managed-temporary-utf8-prompt-file>'}else{'<managed-temporary-utf8-payload>'}
    $previewArgs=$baseArgs+$(if($DiagnosticMode){@('--output-format','plain')}else{@('--json-schema',$schema)})+$(if($Model){@('--model',$Model)}else{@()})+@('--prompt-file',$previewPlaceholder)
    if($DryRun){
        if($Provider-eq'agy'){$previewArgs=@('--mode','plan','--sandbox','--print-timeout',("{0}s"-f$TimeoutSeconds))+$(if($Model){@('--model',$Model)}else{@()})+@('--print','<redacted-advisory-prompt>')}
        [ordered]@{schemaVersion=2;provider=$Provider;critiqueMode=$CritiqueMode;workingDirectory=$root;promptSource=$PSCmdlet.ParameterSetName;promptSha256=$promptSha;configFingerprint=$configFingerprint;byteCounts=$byteCounts;outputDetail=$resolvedOutputDetail;resultFile=$ResultFile;arguments=$previewArgs;nativeArguments=(($previewArgs|ForEach-Object{ConvertTo-NativeArgument $_})-join' ')}|ConvertTo-Json -Depth 8;exit 0
    }
    if($Provider-eq'agy'){
        $agyArgs=@('--mode','plan','--sandbox','--print-timeout',("{0}s"-f$TimeoutSeconds))+$(if($Model){@('--model',$Model)}else{@()})+@('--print',$advisory)
        $agy=Invoke-NativeProcess $commandPath $agyArgs $root ($TimeoutSeconds*1000) -StdoutLimitBytes 65536
        if($agy.TimedOut){throw "agy exceeded the ${TimeoutSeconds}s timeout and was stopped."}
        if($agy.StdoutTruncated){throw 'agy output exceeded the bounded capture limit.'}
        if($agy.ExitCode-ne0){throw ("agy exited with code {0}."-f$agy.ExitCode)}
        Write-Output $agy.Stdout.TrimEnd();exit 0
    }
    $overallClock=[System.Diagnostics.Stopwatch]::StartNew();$overallMs=$TimeoutSeconds*1000
    $version=Invoke-NativeProcess $commandPath @('--no-auto-update','version','--json') $root ([Math]::Min(10000,$overallMs))
    if($version.TimedOut-or$version.ExitCode-ne0-or$version.StdoutTruncated){throw 'Grok version preflight failed.'}
    try{$versionJson=$version.Stdout|ConvertFrom-Json;$current=[string](Get-ExactObjectProperty $versionJson 'currentVersion');$channel=[string](Get-ExactObjectProperty $versionJson 'channel');$match=[regex]::Match($current,'^(\d+\.\d+\.\d+)');if(-not$match.Success-or[version]$match.Groups[1].Value-lt[version]'0.2.118'){throw 'old'};$cliVersion=if($channel){"$current [$channel]"}else{$current}}catch{throw 'Grok CLI 0.2.118 or newer is required.'}
    if($CritiqueMode-ne'Legacy'){
        $remaining=$overallMs-[int]$overallClock.ElapsedMilliseconds;$inspect=Invoke-NativeProcess $commandPath @('--no-auto-update','inspect','--json') $root ([Math]::Min(15000,[Math]::Max(1,$remaining))) -StdoutLimitBytes $script:MaximumGeneratorOutputBytes
        if($inspect.TimedOut-or$inspect.ExitCode-ne0-or$inspect.StdoutTruncated){throw 'Grok configuration inspection failed.'}
        try{$inspectJson=$inspect.Stdout|ConvertFrom-Json -ErrorAction Stop;$pluginValue=Get-ExactObjectProperty $inspectJson 'plugins';$pluginCount=if($null-eq$pluginValue){0}else{@($pluginValue).Count};$mcpValue=Get-ExactObjectProperty $inspectJson 'mcpServers';$mcpCount=if($null-eq$mcpValue){0}else{@($mcpValue).Count};$hookValue=Get-ExactObjectProperty $inspectJson 'hooks';$hookCount=if($null-eq$hookValue){0}else{@($hookValue).Count};$warningValue=Get-ExactObjectProperty $inspectJson 'configWarnings';$warningCount=if($null-eq$warningValue){0}else{@($warningValue).Count}}catch{throw 'Grok configuration inspection returned invalid JSON.'}
        $contextMetadata.configuration=[ordered]@{pluginCount=$pluginCount;mcpServerCount=$mcpCount;hookCount=$hookCount;warningCount=$warningCount}
        if($pluginCount-gt0-or$mcpCount-gt0){throw 'Explicit critiques require zero discovered Grok plugins and MCP servers.'}
        $configFingerprint=Get-Sha256 $script:Utf8.GetBytes((($safetyConfig|ConvertTo-Json -Depth 6 -Compress)+"`n"+$inspect.Stdout.Trim()))
    }
    $remaining=$overallMs-[int]$overallClock.ElapsedMilliseconds;$models=Invoke-NativeProcess $commandPath @('--no-auto-update','models') $root ([Math]::Min(20000,[Math]::Max(1,$remaining)))
    if($models.TimedOut-or$models.ExitCode-ne0-or$models.StdoutTruncated){throw 'Grok model preflight failed; verify login and model access.'}
    $defaults=[regex]::Matches($models.Stdout,'(?im)^Default model:\s*(\S+)\s*$');$available=@([regex]::Matches($models.Stdout,'(?m)^\s*[-*]\s+([^\s(]+)')|ForEach-Object{$_.Groups[1].Value});if(-not$selectedModel-and$defaults.Count-eq1-and(Test-GrokModelName $defaults[0].Groups[1].Value)){$selectedModel=$defaults[0].Groups[1].Value};if(-not$selectedModel){$directCandidates=@($available|Where-Object{Test-GrokModelName $_}|Select-Object -First 1);if($directCandidates.Count-gt0){$selectedModel=$directCandidates[0]}}
    if(-not(Test-GrokModelName $selectedModel)-or$available-notcontains$selectedModel){throw 'Selected/default model is unavailable or is not a direct grok-* model.'}
    $providerAttempt=0;$mayRetry=$true;$expanded=$false;$activeRequestedContext=@()
    while($providerAttempt-lt2){
        $providerAttempt++;$remaining=$overallMs-[int]$overallClock.ElapsedMilliseconds;if($remaining-le0){throw 'Grok review exhausted the overall timeout.'}
        $managed=Join-Path ([System.IO.Path]::GetTempPath()) ('sdoc-grok-payload-'+[guid]::NewGuid().ToString('N')+'.txt');$review=$null;$attemptBudget=if($providerAttempt-eq1){[Math]::Min($remaining,[Math]::Max(250,[int][Math]::Floor($remaining*0.8)))}else{$remaining}
        $reviewStdoutLimit=if($CritiqueMode-eq'Legacy'){65536}else{$script:MaximumProviderStdoutBytes}
        try{[System.IO.File]::WriteAllBytes($managed,$advisoryBytes);$args=$baseArgs+$(if($DiagnosticMode){@('--output-format','plain')}else{@('--json-schema',$schema)})+@('--model',$selectedModel,'--prompt-file',$managed);$review=Invoke-NativeProcess $commandPath $args $root $attemptBudget -StdoutLimitBytes $reviewStdoutLimit}
        finally{if(Test-Path -LiteralPath $managed -PathType Leaf){Remove-Item -LiteralPath $managed -Force -ErrorAction SilentlyContinue};if(Test-Path -LiteralPath $managed -PathType Leaf){throw 'Failed to remove a managed Grok payload file.'}}
        $byteCounts.providerStdout=[long]$byteCounts.providerStdout+$review.StdoutBytes;$byteCounts.providerStderr=[long]$byteCounts.providerStderr+$review.StderrBytes
        $outcome='failed';$reason='process'
        if($review.TimedOut){$reason='timeout'}elseif($review.StdoutTruncated-or$review.StderrTruncated){$reason='output_limit'}elseif($review.ExitCode-ne0){$reason=Get-ProcessFailureKind ($review.Stderr+"`n"+$review.Stdout)}else{$outcome='response';$reason='structured_parse'}
        $attemptRecords+=,[ordered]@{attempt=$providerAttempt;outcome=$outcome;reason=$reason;durationMs=$review.DurationMilliseconds;stdoutBytes=$review.StdoutBytes;stderrBytes=$review.StderrBytes}
        $metadata=New-Metadata $cliVersion $selectedModel $CritiqueMode $contextMetadata $attemptRecords ([int]$overallClock.ElapsedMilliseconds) $byteCounts $promptSha $configFingerprint
        if($review.TimedOut-or$review.StdoutTruncated-or$review.StderrTruncated-or$review.ExitCode-ne0){
            $retryable=$reason-in@('timeout','transient')-or($CritiqueMode-eq'Legacy'-and$reason-eq'output_limit');if($retryable-and$providerAttempt-lt2){$attemptRecords[-1].outcome='retry';continue}
            $status=if($reason-in@('timeout','transient','authentication','model','process')){'unavailable'}else{'incomplete'};$code=if($reason-eq'arguments'){4}elseif($status-eq'unavailable'){3}else{2};$failureMessage=if($reason-eq'process'){'Grok review process failed.'}else{'Grok review did not complete.'};$result=New-FailureResult $status $reason $failureMessage $metadata $CritiqueMode;Write-AdvisorResult $result $resolvedOutputFormat $resolvedOutputDetail $ResultFile $protectedInputs;exit $code
        }
        if($DiagnosticMode){$diagnostic=[ordered]@{schemaVersion=2;provider='grok';mode='diagnostic';critiqueMode=$CritiqueMode;reviewStatus='diagnostic';conclusion='Connectivity diagnostic completed; this is not a valid critique.';rawResponse=Protect-SensitiveText $review.Stdout 4096;metadata=$metadata};Write-AdvisorResult $diagnostic $resolvedOutputFormat $resolvedOutputDetail $ResultFile $protectedInputs;exit 0}
        $parsed=ConvertFrom-GrokStructuredReview $review.Stdout $review.Stderr $selectedModel $metadata $CritiqueMode
        if($parsed.Complete){
            if($CritiqueMode-ne'Legacy'){$integrity=Test-GeneratedContextIntegrity $context $root $input.Path;if(-not$integrity.Valid){$attemptRecords[-1].outcome='rejected';$attemptRecords[-1].reason=$integrity.Kind;$metadata=New-Metadata $cliVersion $selectedModel $CritiqueMode $contextMetadata $attemptRecords ([int]$overallClock.ElapsedMilliseconds) $byteCounts $promptSha $configFingerprint;$result=New-FailureResult 'incomplete' $integrity.Kind $integrity.Message $metadata $CritiqueMode;Write-AdvisorResult $result $resolvedOutputFormat $resolvedOutputDetail $ResultFile $protectedInputs;exit 2}}
            if($CritiqueMode-ne'Legacy'){$fresh=Invoke-ContextGenerator $CritiqueMode $root $input.Path $ChangeSetFile $BaseRef $activeRequestedContext ([Math]::Min(60000,[Math]::Max(1,$overallMs-[int]$overallClock.ElapsedMilliseconds))) $AdvisorContextScript;$freshArtifact=[string](Get-ObjectProperty $fresh 'artifactDirectory');$artifactDirectories+=$freshArtifact;$freshIntegrity=Test-GeneratedContextIntegrity $fresh $root $input.Path;if(-not$freshIntegrity.Valid){throw ('STALE_CONTEXT: '+$freshIntegrity.Message)};foreach($hashName in @('contextSha256','selectionSha256','fingerprint')){if([string](Get-ObjectProperty $fresh $hashName)-cne[string](Get-ObjectProperty $context $hashName)){$attemptRecords[-1].outcome='rejected';$attemptRecords[-1].reason='stale_context';$metadata=New-Metadata $cliVersion $selectedModel $CritiqueMode $contextMetadata $attemptRecords ([int]$overallClock.ElapsedMilliseconds) $byteCounts $promptSha $configFingerprint;$result=New-FailureResult 'incomplete' 'stale_context' 'Selected review inputs changed while Grok was reviewing them.' $metadata $CritiqueMode;Write-AdvisorResult $result $resolvedOutputFormat $resolvedOutputDetail $ResultFile $protectedInputs;exit 2}}}
            $attemptRecords[-1].outcome='complete';$attemptRecords[-1].reason='validated';Write-AdvisorResult $parsed.Result $resolvedOutputFormat $resolvedOutputDetail $ResultFile $protectedInputs;exit 0
        }
        $attemptRecords[-1].reason=$parsed.Kind
        if($parsed.Kind-eq'context_requested'-and$AllowContextExpansion-and-not$expanded-and$providerAttempt-lt2){
            $expanded=$true;$activeRequestedContext=@($parsed.RequestedContext);$attemptRecords[-1].outcome='context_expansion';$context=Invoke-ContextGenerator $CritiqueMode $root $input.Path $ChangeSetFile $BaseRef $activeRequestedContext ([Math]::Min(60000,[Math]::Max(1,$overallMs-[int]$overallClock.ElapsedMilliseconds))) $AdvisorContextScript;$artifact=[string](Get-ObjectProperty $context 'artifactDirectory');$artifactDirectories+=$artifact;$bundle=Get-ContextPayload $context;$contextPayload=$bundle.Text;$byteCounts.context=$bundle.Bytes;$contextMetadata.contextSha256=[string](Get-ObjectProperty $context 'contextSha256');$contextMetadata.selectionSha256=[string](Get-ObjectProperty $context 'selectionSha256');$contextMetadata.repositoryFingerprint=[string](Get-ObjectProperty $context 'fingerprint');foreach($requiredHash in @('contextSha256','selectionSha256','repositoryFingerprint')){if([string]::IsNullOrWhiteSpace([string]$contextMetadata[$requiredHash])){throw "Expanded context omitted $requiredHash."}};$expandedIntegrity=Test-GeneratedContextIntegrity $context $root $input.Path;if(-not$expandedIntegrity.Valid){throw ('STALE_CONTEXT: '+$expandedIntegrity.Message)};$advisory="Perform a payload-only adversarial planning critique using the expanded allowlisted context. You have no tools. Set reviewInputSha256 exactly to $($contextMetadata.contextSha256). Return a completed structured result; do not request the same context again.`n`n$contextPayload";$advisoryBytes=$script:Utf8.GetBytes($advisory);$promptSha=Get-Sha256 $advisoryBytes;$byteCounts.payload=$advisoryBytes.Length;continue
        }
        if($parsed.Retryable-and$providerAttempt-lt2){$attemptRecords[-1].outcome='retry';continue}
        $status=if($parsed.Kind-eq'model_attestation'){'unavailable'}else{'incomplete'};$code=if($status-eq'unavailable'){3}else{2};$metadata=New-Metadata $cliVersion $selectedModel $CritiqueMode $contextMetadata $attemptRecords ([int]$overallClock.ElapsedMilliseconds) $byteCounts $promptSha $configFingerprint;$result=New-FailureResult $status $parsed.Kind $parsed.Message $metadata $CritiqueMode;Write-AdvisorResult $result $resolvedOutputFormat $resolvedOutputDetail $ResultFile $protectedInputs;exit $code
    }
}catch{
    $message=Protect-SensitiveText $_.Exception.Message;$duration=if($overallClock){[int]$overallClock.ElapsedMilliseconds}else{0};$metadata=New-Metadata $cliVersion $selectedModel $CritiqueMode $contextMetadata $attemptRecords $duration $byteCounts $promptSha $configFingerprint
    $kind=if($message-match'(?i)coverage'){'coverage'}elseif($message-match'(?i)STALE_CONTEXT|\bstale\b'){'stale_context'}elseif($message-match'(?i)hash|digest|fingerprint'){'context_digest'}elseif($message-match'(?i)version|Grok CLI 0\.2\.118'){'version'}elseif($message-match'(?i)model preflight|login and model access'){'authentication_or_models'}elseif($message-match'(?i)selected/default model|direct grok-'){'model'}elseif($message-match'(?i)^Grok .*timeout|Grok review exhausted'){'timeout'}elseif($message-match'(?i)executable|failed to start'){'provider'}else{'wrapper'}
    $unavailable=$kind-in@('version','authentication_or_models','model','provider','timeout');$status=if($unavailable){'unavailable'}else{'incomplete'};$exitCode=if($unavailable){3}elseif($kind-eq'wrapper'){4}else{2}
    if($Provider-eq'grok'){$result=New-FailureResult $status $kind $message $metadata $CritiqueMode;try{Write-AdvisorResult $result $resolvedOutputFormat $resolvedOutputDetail $ResultFile $protectedInputs}catch{[Console]::Error.WriteLine((Protect-SensitiveText $_.Exception.Message))};[Console]::Error.WriteLine($message)}else{[Console]::Error.WriteLine($message)};exit $exitCode
}finally{
    foreach($directory in @($artifactDirectories|Select-Object -Unique)){if(Test-SafeArtifactDirectory $directory){Remove-Item -LiteralPath $directory -Recurse -Force -ErrorAction SilentlyContinue;if(Test-Path -LiteralPath $directory){[Console]::Error.WriteLine('Failed to remove a managed advisor context directory.');exit 4}}}
}
