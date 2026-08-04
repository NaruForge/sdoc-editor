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

    [string]$WorkingDirectory = (Get-Location).Path,

    [string]$Model,

    [ValidateRange(1, 1800)]
    [int]$TimeoutSeconds = 300,

    [ValidateSet('Auto', 'Json', 'Text')]
    [string]$OutputFormat = 'Auto',

    [string]$ProviderExecutable,

    [switch]$DryRun,

    [Alias('AllowIncompleteResponse')]
    [switch]$DiagnosticMode
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:SchemaVersion = 1
$script:MaximumCapturedOutputLength = 65536
$script:GrokReviewSchema = '{"type":"object","additionalProperties":false,"required":["status","conclusion","confidence","evidence","findings","risks","assumptions"],"properties":{"status":{"type":"string","enum":["pass","changes_required","incomplete"]},"conclusion":{"type":"string","minLength":1},"confidence":{"type":"string","enum":["high","medium","low"]},"evidence":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["claim","support"],"properties":{"claim":{"type":"string","minLength":1},"support":{"type":"string","minLength":1},"file":{"type":"string"},"line":{"type":"integer","minimum":1}}}},"findings":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["severity","title","claim","evidence","recommendation"],"properties":{"severity":{"type":"string","enum":["critical","major","minor"]},"title":{"type":"string","minLength":1},"claim":{"type":"string","minLength":1},"evidence":{"type":"string","minLength":1},"recommendation":{"type":"string","minLength":1},"file":{"type":"string"},"line":{"type":"integer","minimum":1}}}},"risks":{"type":"array","items":{"type":"string"}},"assumptions":{"type":"array","items":{"type":"string"}}}}'

function ConvertTo-NativeArgument {
    param(
        [AllowEmptyString()]
        [string]$Value
    )

    if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') {
        return $Value
    }

    $builder = [System.Text.StringBuilder]::new()
    [void]$builder.Append('"')
    $backslashes = 0

    foreach ($character in $Value.ToCharArray()) {
        if ($character -eq '\') {
            $backslashes++
            continue
        }

        if ($character -eq '"') {
            [void]$builder.Append(('\' * (($backslashes * 2) + 1)))
            [void]$builder.Append('"')
            $backslashes = 0
            continue
        }

        if ($backslashes -gt 0) {
            [void]$builder.Append(('\' * $backslashes))
            $backslashes = 0
        }
        [void]$builder.Append($character)
    }

    if ($backslashes -gt 0) {
        [void]$builder.Append(('\' * ($backslashes * 2)))
    }
    [void]$builder.Append('"')
    return $builder.ToString()
}

function Get-ObjectProperty {
    param(
        [AllowNull()]
        [object]$Object,

        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    if ($null -eq $Object) {
        return $null
    }

    if ($Object -is [System.Collections.IDictionary] -and $Object.Contains($Name)) {
        $value = $Object[$Name]
        if ($value -is [System.Array]) { return ,$value }
        return $value
    }

    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) {
        return $null
    }
    if ($property.Value -is [System.Array]) { return ,$property.Value }
    return $property.Value
}

function Get-ExactObjectProperty {
    param(
        [AllowNull()][object]$Object,
        [Parameter(Mandatory = $true)][string]$Name
    )

    if ($null -eq $Object) {
        return $null
    }
    foreach ($property in $Object.PSObject.Properties) {
        if ($property.Name -ceq $Name) {
            if ($property.Value -is [System.Array]) { return ,$property.Value }
            return $property.Value
        }
    }
    return $null
}

function Test-ExactPropertyContract {
    param(
        [AllowNull()][object]$Object,
        [Parameter(Mandatory = $true)][string[]]$Required,
        [string[]]$Optional = @()
    )

    if ($null -eq $Object -or $Object -is [string] -or $Object -is [System.Array]) {
        return $false
    }
    $actualNames = @($Object.PSObject.Properties | ForEach-Object { $_.Name })
    $allowedNames = @($Required) + @($Optional)
    foreach ($name in $actualNames) {
        if (@($allowedNames | Where-Object { $_ -ceq $name }).Count -ne 1) {
            return $false
        }
    }
    foreach ($name in $Required) {
        if (@($actualNames | Where-Object { $_ -ceq $name }).Count -ne 1) {
            return $false
        }
    }
    return $true
}

function Protect-SensitiveText {
    param(
        [AllowNull()]
        [string]$Text,

        [int]$MaximumLength = 2048
    )

    if ([string]::IsNullOrEmpty($Text)) {
        return ''
    }

    $safeText = $Text
    $safeText = [regex]::Replace($safeText, '(?i)Bearer\s+[A-Za-z0-9._~+/=-]+', 'Bearer [REDACTED]')
    $safeText = [regex]::Replace($safeText, '(?i)\b(?:xai|sk)-[A-Za-z0-9_-]{8,}\b', '[REDACTED_TOKEN]')
    $safeText = [regex]::Replace($safeText, '(?i)\b(?:gh[pousr]_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,})\b', '[REDACTED_TOKEN]')
    $safeText = [regex]::Replace($safeText, '(?im)(api[_-]?key\s*[:=]\s*)\S+', '$1[REDACTED]')
    $safeText = [regex]::Replace($safeText, '(?im)(authorization\s*:\s*)\S+', '$1[REDACTED]')
    $safeText = [regex]::Replace($safeText, '(?im)((?:password|token|secret)\s*[:=]\s*)\S+', '$1[REDACTED]')
    if ($safeText.Length -gt $MaximumLength) {
        return $safeText.Substring(0, $MaximumLength) + '...'
    }
    return $safeText
}

function Test-GrokModelName {
    param([AllowNull()][string]$Name)

    if ([string]::IsNullOrWhiteSpace($Name)) {
        return $false
    }
    return $Name -cmatch '^grok-[A-Za-z0-9][A-Za-z0-9._-]*$'
}

function Test-GrokModelAttestation {
    param(
        [Parameter(Mandatory = $true)][string]$SelectedModel,
        [Parameter(Mandatory = $true)][string]$ActualModel
    )

    if (-not (Test-GrokModelName -Name $ActualModel) -or
        -not (Test-GrokModelName -Name $SelectedModel)) {
        return $false
    }
    return $ActualModel -ceq $SelectedModel -or $ActualModel -ceq ($SelectedModel + '-build')
}

function Test-AcknowledgementText {
    param([AllowNull()][string]$Text)

    if ([string]::IsNullOrWhiteSpace($Text)) {
        return $true
    }

    $trimmed = $Text.Trim()
    if ($trimmed.Length -lt 12) {
        return $true
    }

    if ($trimmed -match '(?i)^\s*(?:I''ll|I\s+will|I\s+am\s+going\s+to|let\s+me|reviewing\b|will\s+review\b)') {
        return $true
    }

    $localizedAcknowledgements = @(
        ([string][char]0xAC80 + [char]0xD1A0 + [char]0xD558 + [char]0xACA0 + [char]0xC2B5 + [char]0xB2C8 + [char]0xB2E4),
        ([string][char]0xD655 + [char]0xC778 + [char]0xD558 + [char]0xACA0 + [char]0xC2B5 + [char]0xB2C8 + [char]0xB2E4),
        ([string][char]0xC0B4 + [char]0xD3B4 + [char]0xBCF4 + [char]0xACA0 + [char]0xC2B5 + [char]0xB2C8 + [char]0xB2E4)
    )
    foreach ($acknowledgement in $localizedAcknowledgements) {
        if ($trimmed.StartsWith($acknowledgement, [System.StringComparison]::Ordinal)) {
            return $true
        }
    }
    return $false
}

function Get-StringArray {
    param([AllowNull()][object]$Value)

    if ($null -eq $Value -or $Value -isnot [System.Array]) {
        throw 'Expected a JSON string array.'
    }

    $result = @()
    foreach ($item in @($Value)) {
        if ($item -isnot [string]) {
            throw 'Expected a string array.'
        }
        $result += [string]$item
    }
    return $result
}

function Get-PromptSha256 {
    param([Parameter(Mandatory = $true)][byte[]]$Bytes)

    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        return (($sha256.ComputeHash($Bytes) | ForEach-Object { $_.ToString('x2') }) -join '')
    } finally {
        $sha256.Dispose()
    }
}

function Resolve-ProviderCommand {
    param(
        [Parameter(Mandatory = $true)][string]$ProviderName,
        [AllowEmptyString()][string]$ExplicitPath
    )

    if (-not [string]::IsNullOrWhiteSpace($ExplicitPath)) {
        $resolvedPath = (Resolve-Path -LiteralPath $ExplicitPath).Path
        if (-not (Test-Path -LiteralPath $resolvedPath -PathType Leaf)) {
            throw "Provider executable is not a file: $resolvedPath"
        }
        if ([System.IO.Path]::GetExtension($resolvedPath) -notin @('.exe', '.com')) {
            throw 'ProviderExecutable must point to a native .exe or .com file.'
        }
        return $resolvedPath
    }

    $resolvedCommand = Get-Command $ProviderName -CommandType Application -ErrorAction Stop |
        Select-Object -First 1
    $resolvedSource = $resolvedCommand.Source
    if (-not (Test-Path -LiteralPath $resolvedSource -PathType Leaf) -or
        [System.IO.Path]::GetExtension($resolvedSource) -notin @('.exe', '.com')) {
        throw "$ProviderName must resolve to a native .exe or .com executable."
    }
    return $resolvedSource
}

function Invoke-NativeProcess {
    param(
        [Parameter(Mandatory = $true)][string]$Executable,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$Directory,
        [Parameter(Mandatory = $true)][int]$TimeoutMilliseconds
    )

    $nativeArguments = ($Arguments | ForEach-Object {
        ConvertTo-NativeArgument -Value $_
    }) -join ' '

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $Executable
    $startInfo.Arguments = $nativeArguments
    $startInfo.WorkingDirectory = $Directory
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    if ($null -ne $startInfo.PSObject.Properties['StandardOutputEncoding']) {
        $startInfo.StandardOutputEncoding = [System.Text.UTF8Encoding]::new($false)
        $startInfo.StandardErrorEncoding = [System.Text.UTF8Encoding]::new($false)
    }

    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        if (-not $process.Start()) {
            throw "Failed to start $Executable."
        }

        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        $timedOut = -not $process.WaitForExit($TimeoutMilliseconds)
        if ($timedOut) {
            & taskkill.exe /PID $process.Id /T /F 2>$null | Out-Null
            $taskkillExitCode = $LASTEXITCODE
            if ($taskkillExitCode -ne 0 -and -not $process.HasExited) {
                try { $process.Kill() } catch { }
            }
            if (-not $process.WaitForExit(5000)) {
                try { $process.Kill() } catch { }
                if (-not $process.WaitForExit(5000)) {
                    throw "Failed to stop timed-out provider process $($process.Id)."
                }
            }
        }

        if (-not $stdoutTask.Wait(5000) -or -not $stderrTask.Wait(5000)) {
            throw 'Provider output streams did not close after the process exited.'
        }

        $stdout = [string]$stdoutTask.Result
        $stderr = [string]$stderrTask.Result
        $stdoutTruncated = $stdout.Length -gt $script:MaximumCapturedOutputLength
        $stderrTruncated = $stderr.Length -gt $script:MaximumCapturedOutputLength
        if ($stdoutTruncated) {
            $stdout = $stdout.Substring(0, $script:MaximumCapturedOutputLength)
        }
        if ($stderrTruncated) {
            $stderr = $stderr.Substring(0, $script:MaximumCapturedOutputLength)
        }

        return [pscustomobject]@{
            ExitCode = if ($timedOut) { -1 } else { $process.ExitCode }
            Stdout = $stdout
            Stderr = $stderr
            StdoutTruncated = $stdoutTruncated
            StderrTruncated = $stderrTruncated
            TimedOut = $timedOut
            DurationMilliseconds = [int]$stopwatch.ElapsedMilliseconds
            NativeArguments = $nativeArguments
        }
    } finally {
        $stopwatch.Stop()
        $process.Dispose()
    }
}

function New-ReviewMetadata {
    param(
        [AllowNull()][string]$CliVersion,
        [AllowNull()][string]$SelectedModel,
        [int]$Attempts,
        [int]$DurationMilliseconds,
        [AllowNull()][string]$PromptSha256
    )

    return [ordered]@{
        cliVersion = $CliVersion
        model = $SelectedModel
        attempts = $Attempts
        durationMs = $DurationMilliseconds
        promptSha256 = $PromptSha256
    }
}

function New-FailureResult {
    param(
        [Parameter(Mandatory = $true)][string]$Status,
        [Parameter(Mandatory = $true)][string]$Kind,
        [Parameter(Mandatory = $true)][string]$Message,
        [Parameter(Mandatory = $true)][object]$Metadata
    )

    return [ordered]@{
        schemaVersion = $script:SchemaVersion
        provider = 'grok'
        mode = 'review'
        reviewStatus = $Status
        conclusion = $Message
        confidence = 'low'
        evidence = @()
        findings = @()
        risks = @()
        assumptions = @()
        error = [ordered]@{
            kind = $Kind
            message = $Message
        }
        metadata = $Metadata
    }
}

function Write-AdvisorResult {
    param(
        [Parameter(Mandatory = $true)][object]$Result,
        [Parameter(Mandatory = $true)][string]$Format
    )

    $status = [string](Get-ObjectProperty -Object $Result -Name 'reviewStatus')
    if ($status -in @('incomplete', 'unavailable') -and
        $Result -is [System.Collections.IDictionary]) {
        $Result['conclusion'] = Protect-SensitiveText -Text ([string]$Result['conclusion'])
        $failure = $Result['error']
        if ($failure -is [System.Collections.IDictionary]) {
            $failure['message'] = Protect-SensitiveText -Text ([string]$failure['message'])
        }
    }

    if ($Format -eq 'Json') {
        Write-Output ($Result | ConvertTo-Json -Depth 12 -Compress)
        return
    }

    $conclusion = [string](Get-ObjectProperty -Object $Result -Name 'conclusion')
    Write-Output 'Conclusion'
    Write-Output $conclusion
    Write-Output ''
    Write-Output 'Findings'
    $findingsValue = Get-ObjectProperty -Object $Result -Name 'findings'
    $findings = if ($null -eq $findingsValue) { @() } else { @($findingsValue) }
    if ($status -eq 'pass' -and $findings.Count -eq 0) {
        Write-Output 'NO_ACTIONABLE_FINDINGS'
        return
    }
    if ($findings.Count -eq 0) {
        Write-Output ("REVIEW_{0}" -f $status.ToUpperInvariant())
        return
    }
    foreach ($finding in $findings) {
        $severity = [string](Get-ObjectProperty -Object $finding -Name 'severity')
        $title = [string](Get-ObjectProperty -Object $finding -Name 'title')
        $claim = [string](Get-ObjectProperty -Object $finding -Name 'claim')
        $evidence = [string](Get-ObjectProperty -Object $finding -Name 'evidence')
        $recommendation = [string](Get-ObjectProperty -Object $finding -Name 'recommendation')
        Write-Output ("- [{0}] {1}: {2} Evidence: {3} Recommendation: {4}" -f $severity, $title, $claim, $evidence, $recommendation)
    }
}

function Stop-WithReviewResult {
    param(
        [Parameter(Mandatory = $true)][object]$Result,
        [Parameter(Mandatory = $true)][string]$Format,
        [Parameter(Mandatory = $true)][int]$ExitCode
    )

    Write-AdvisorResult -Result $Result -Format $Format
    $errorObject = Get-ObjectProperty -Object $Result -Name 'error'
    if ($null -ne $errorObject) {
        $message = Protect-SensitiveText -Text ([string](Get-ObjectProperty -Object $errorObject -Name 'message'))
        if (-not [string]::IsNullOrWhiteSpace($message)) {
            [Console]::Error.WriteLine($message)
        }
    }
    exit $ExitCode
}

function Get-RetryAfterSeconds {
    param([AllowNull()][string]$Text)

    if ([string]::IsNullOrWhiteSpace($Text)) {
        return $null
    }
    $match = [regex]::Match($Text, '(?i)retry[- ]after\s*[:=]?\s*(\d+)')
    if (-not $match.Success) {
        return $null
    }
    return [Math]::Min(30, [int]$match.Groups[1].Value)
}

function Get-ProcessFailureKind {
    param([AllowNull()][string]$Text)

    if ($Text -match '(?i)\b(?:401|403)\b|unauthenticated|authentication|not logged in|login required|run [`'']?grok login') {
        return 'authentication'
    }
    if ($Text -match '(?i)unknown model|model[^\r\n]*(?:not found|unavailable|invalid)') {
        return 'model'
    }
    if ($Text -match '(?i)unexpected argument|unrecognized option|invalid JSON|json.schema|json-schema') {
        return 'arguments'
    }
    if ($Text -match '(?i)\b429\b|rate limit|capacity|overloaded|\b5\d\d\b|temporar|connection reset|service unavailable') {
        return 'transient'
    }
    return 'process'
}

function ConvertFrom-GrokStructuredReview {
    param(
        [Parameter(Mandatory = $true)][string]$Stdout,
        [Parameter(Mandatory = $true)][string]$ExpectedModel,
        [Parameter(Mandatory = $true)][object]$Metadata
    )

    try {
        $envelope = $Stdout | ConvertFrom-Json -ErrorAction Stop
    } catch {
        $trimmed = $Stdout.TrimEnd()
        $looksTruncated = [string]::IsNullOrWhiteSpace($trimmed) -or -not $trimmed.EndsWith('}')
        return [pscustomobject]@{
            Complete = $false
            Retryable = $looksTruncated
            Kind = if ($looksTruncated) { 'truncated' } else { 'envelope' }
            Message = 'Grok returned an invalid JSON envelope.'
            Result = $null
        }
    }

    $structured = Get-ExactObjectProperty -Object $envelope -Name 'structuredOutput'
    if ($null -eq $structured -or $structured -is [string]) {
        return [pscustomobject]@{
            Complete = $false
            Retryable = $true
            Kind = 'structured_output'
            Message = 'Grok did not return the required structured review object.'
            Result = $null
        }
    }

    $reviewRequiredProperties = @(
        'status', 'conclusion', 'confidence', 'evidence', 'findings', 'risks', 'assumptions'
    )
    if (-not (Test-ExactPropertyContract -Object $structured -Required $reviewRequiredProperties)) {
        return [pscustomobject]@{
            Complete = $false
            Retryable = $false
            Kind = 'schema'
            Message = 'Grok structured review violates the exact top-level property contract.'
            Result = $null
        }
    }

    $actualModels = @()
    $modelUsage = Get-ExactObjectProperty -Object $envelope -Name 'modelUsage'
    if ($null -ne $modelUsage) {
        $actualModels = @($modelUsage.PSObject.Properties | ForEach-Object { $_.Name })
    }
    if ($actualModels.Count -eq 0 -or @($actualModels | Where-Object {
        -not (Test-GrokModelAttestation -SelectedModel $ExpectedModel -ActualModel $_)
    }).Count -gt 0) {
        return [pscustomobject]@{
            Complete = $false
            Retryable = $false
            Kind = 'model_attestation'
            Message = 'Grok response did not attest a Grok-family model.'
            Result = $null
        }
    }

    $statusValue = Get-ExactObjectProperty -Object $structured -Name 'status'
    $conclusionValue = Get-ExactObjectProperty -Object $structured -Name 'conclusion'
    $confidenceValue = Get-ExactObjectProperty -Object $structured -Name 'confidence'
    if ($statusValue -isnot [string] -or $conclusionValue -isnot [string] -or
        $confidenceValue -isnot [string]) {
        return [pscustomobject]@{
            Complete = $false
            Retryable = $false
            Kind = 'schema'
            Message = 'Grok structured review contains non-string scalar fields.'
            Result = $null
        }
    }
    $status = [string]$statusValue
    $conclusion = [string]$conclusionValue
    $confidence = [string]$confidenceValue
    try {
        $risks = @(Get-StringArray -Value (Get-ExactObjectProperty -Object $structured -Name 'risks'))
        $assumptions = @(Get-StringArray -Value (Get-ExactObjectProperty -Object $structured -Name 'assumptions'))
    } catch {
        return [pscustomobject]@{
            Complete = $false
            Retryable = $false
            Kind = 'schema'
            Message = 'Grok structured review contains invalid string arrays.'
            Result = $null
        }
    }

    if ($status -eq 'incomplete') {
        return [pscustomobject]@{
            Complete = $false
            Retryable = $true
            Kind = 'incomplete'
            Message = 'Grok explicitly reported an incomplete review.'
            Result = $null
        }
    }

    if (@('pass', 'changes_required') -cnotcontains $status -or
        @('high', 'medium', 'low') -cnotcontains $confidence -or
        (Test-AcknowledgementText -Text $conclusion)) {
        return [pscustomobject]@{
            Complete = $false
            Retryable = (Test-AcknowledgementText -Text $conclusion)
            Kind = 'semantic'
            Message = 'Grok structured review is incomplete or acknowledgement-only.'
            Result = $null
        }
    }

    $evidence = @()
    $evidenceValue = Get-ExactObjectProperty -Object $structured -Name 'evidence'
    if ($evidenceValue -isnot [System.Array]) {
        return [pscustomobject]@{
            Complete = $false
            Retryable = $false
            Kind = 'schema'
            Message = 'Grok structured review evidence must be a JSON array.'
            Result = $null
        }
    }
    foreach ($item in @($evidenceValue)) {
        if (-not (Test-ExactPropertyContract -Object $item -Required @('claim', 'support') -Optional @('file', 'line'))) {
            return [pscustomobject]@{
                Complete = $false
                Retryable = $false
                Kind = 'schema'
                Message = 'Grok structured review evidence violates the property contract.'
                Result = $null
            }
        }
        $claimValue = Get-ExactObjectProperty -Object $item -Name 'claim'
        $supportValue = Get-ExactObjectProperty -Object $item -Name 'support'
        if ($claimValue -isnot [string] -or $supportValue -isnot [string] -or
            [string]::IsNullOrWhiteSpace([string]$claimValue) -or
            [string]::IsNullOrWhiteSpace([string]$supportValue)) {
            return [pscustomobject]@{
                Complete = $false
                Retryable = $false
                Kind = 'schema'
                Message = 'Grok structured review contains invalid evidence.'
                Result = $null
            }
        }
        $claim = [string]$claimValue
        $support = [string]$supportValue
        $normalizedEvidence = [ordered]@{ claim = $claim; support = $support }
        $file = Get-ExactObjectProperty -Object $item -Name 'file'
        $line = Get-ExactObjectProperty -Object $item -Name 'line'
        $hasFile = @($item.PSObject.Properties | Where-Object { $_.Name -ceq 'file' }).Count -eq 1
        $hasLine = @($item.PSObject.Properties | Where-Object { $_.Name -ceq 'line' }).Count -eq 1
        if ($hasFile) {
            if ($file -isnot [string] -or [string]::IsNullOrWhiteSpace([string]$file)) {
                return [pscustomobject]@{
                    Complete = $false
                    Retryable = $false
                    Kind = 'schema'
                    Message = 'Grok structured review contains an invalid evidence file.'
                    Result = $null
                }
            }
            $normalizedEvidence.file = [string]$file
        }
        if ($hasLine) {
            if (($line -isnot [int] -and $line -isnot [long]) -or [long]$line -lt 1) {
                return [pscustomobject]@{
                    Complete = $false
                    Retryable = $false
                    Kind = 'schema'
                    Message = 'Grok structured review contains an invalid evidence line.'
                    Result = $null
                }
            }
            $normalizedEvidence.line = [long]$line
        }
        $evidence += $normalizedEvidence
    }

    $findings = @()
    $findingsValue = Get-ExactObjectProperty -Object $structured -Name 'findings'
    if ($findingsValue -isnot [System.Array]) {
        return [pscustomobject]@{
            Complete = $false
            Retryable = $false
            Kind = 'schema'
            Message = 'Grok structured review findings must be a JSON array.'
            Result = $null
        }
    }
    foreach ($item in @($findingsValue)) {
        if (-not (Test-ExactPropertyContract -Object $item -Required @(
            'severity', 'title', 'claim', 'evidence', 'recommendation'
        ) -Optional @('file', 'line'))) {
            return [pscustomobject]@{
                Complete = $false
                Retryable = $false
                Kind = 'schema'
                Message = 'Grok structured review finding violates the property contract.'
                Result = $null
            }
        }
        $severityValue = Get-ExactObjectProperty -Object $item -Name 'severity'
        $titleValue = Get-ExactObjectProperty -Object $item -Name 'title'
        $claimValue = Get-ExactObjectProperty -Object $item -Name 'claim'
        $findingEvidenceValue = Get-ExactObjectProperty -Object $item -Name 'evidence'
        $recommendationValue = Get-ExactObjectProperty -Object $item -Name 'recommendation'
        if ($severityValue -isnot [string] -or $titleValue -isnot [string] -or
            $claimValue -isnot [string] -or $findingEvidenceValue -isnot [string] -or
            $recommendationValue -isnot [string] -or
            @('critical', 'major', 'minor') -cnotcontains [string]$severityValue -or
            [string]::IsNullOrWhiteSpace([string]$titleValue) -or
            [string]::IsNullOrWhiteSpace([string]$claimValue) -or
            [string]::IsNullOrWhiteSpace([string]$findingEvidenceValue) -or
            [string]::IsNullOrWhiteSpace([string]$recommendationValue)) {
            return [pscustomobject]@{
                Complete = $false
                Retryable = $false
                Kind = 'schema'
                Message = 'Grok structured review contains an invalid finding.'
                Result = $null
            }
        }
        $severity = [string]$severityValue
        $title = [string]$titleValue
        $claim = [string]$claimValue
        $findingEvidence = [string]$findingEvidenceValue
        $recommendation = [string]$recommendationValue
        $normalizedFinding = [ordered]@{
            severity = $severity
            title = $title
            claim = $claim
            evidence = $findingEvidence
            recommendation = $recommendation
        }
        $file = Get-ExactObjectProperty -Object $item -Name 'file'
        $line = Get-ExactObjectProperty -Object $item -Name 'line'
        $hasFile = @($item.PSObject.Properties | Where-Object { $_.Name -ceq 'file' }).Count -eq 1
        $hasLine = @($item.PSObject.Properties | Where-Object { $_.Name -ceq 'line' }).Count -eq 1
        if ($hasFile) {
            if ($file -isnot [string] -or [string]::IsNullOrWhiteSpace([string]$file)) {
                return [pscustomobject]@{
                    Complete = $false
                    Retryable = $false
                    Kind = 'schema'
                    Message = 'Grok structured review contains an invalid finding file.'
                    Result = $null
                }
            }
            $normalizedFinding.file = [string]$file
        }
        if ($hasLine) {
            if (($line -isnot [int] -and $line -isnot [long]) -or [long]$line -lt 1) {
                return [pscustomobject]@{
                    Complete = $false
                    Retryable = $false
                    Kind = 'schema'
                    Message = 'Grok structured review contains an invalid finding line.'
                    Result = $null
                }
            }
            $normalizedFinding.line = [long]$line
        }
        $findings += $normalizedFinding
    }

    if ($evidence.Count -eq 0 -or
        ($status -eq 'pass' -and $findings.Count -ne 0) -or
        ($status -eq 'changes_required' -and $findings.Count -eq 0)) {
        return [pscustomobject]@{
            Complete = $false
            Retryable = $false
            Kind = 'semantic'
            Message = 'Grok structured review has contradictory status, findings, or evidence.'
            Result = $null
        }
    }

    $metadata.model = $actualModels[0]
    $result = [ordered]@{
        schemaVersion = $script:SchemaVersion
        provider = 'grok'
        mode = 'review'
        reviewStatus = $status
        conclusion = $conclusion
        confidence = $confidence
        evidence = $evidence
        findings = $findings
        risks = $risks
        assumptions = $assumptions
        metadata = $metadata
    }
    return [pscustomobject]@{
        Complete = $true
        Retryable = $false
        Kind = $null
        Message = $null
        Result = $result
    }
}

$resolvedOutputFormat = if ($OutputFormat -eq 'Auto') {
    if ($Provider -eq 'grok') { 'Json' } else { 'Text' }
} else {
    $OutputFormat
}
$promptSha256 = $null
$cliVersion = $null
$selectedModel = $Model
$attempts = 0
$overallStopwatch = $null
$providerResolutionFailed = $false

try {
    $resolvedDirectory = (Resolve-Path -LiteralPath $WorkingDirectory).Path
    try {
        $commandPath = Resolve-ProviderCommand -ProviderName $Provider -ExplicitPath $ProviderExecutable
    } catch {
        $providerResolutionFailed = $true
        throw
    }

    $taskPrompt = if ($PSCmdlet.ParameterSetName -eq 'PromptFile') {
        $resolvedPromptFile = (Resolve-Path -LiteralPath $PromptFile).Path
        [System.IO.File]::ReadAllText($resolvedPromptFile, [System.Text.Encoding]::UTF8)
    } else {
        $Prompt
    }
    if ([string]::IsNullOrWhiteSpace($taskPrompt)) {
        throw 'The review prompt must not be empty.'
    }

    if ($Provider -eq 'agy') {
        $advisoryPrompt = @"
Act as a read-only advisory reviewer. Do not modify files, create commits,
change configuration, or invoke other agents. Inspect only the repository
content needed for the task. Return a concise conclusion, confidence, evidence
with file and line references, risks, assumptions, and recommended next action.

Task:
$taskPrompt
"@
        $agyArguments = @(
            '--mode', 'plan',
            '--sandbox',
            '--print-timeout', "${TimeoutSeconds}s"
        ) + $(if ($Model) { @('--model', $Model) } else { @() }) +
            @('--print', $advisoryPrompt)
        if ($DryRun) {
            $agyPromptBytes = [System.Text.UTF8Encoding]::new($false).GetBytes($advisoryPrompt)
            $agyPromptSha256 = Get-PromptSha256 -Bytes $agyPromptBytes
            $agyDryRunArguments = @($agyArguments)
            $agyDryRunArguments[$agyDryRunArguments.Count - 1] = '<redacted-advisory-prompt>'
            [ordered]@{
                provider = $Provider
                executable = $commandPath
                workingDirectory = $resolvedDirectory
                promptSource = $PSCmdlet.ParameterSetName
                promptLength = $advisoryPrompt.Length
                promptSha256 = $agyPromptSha256
                reviewReportRequired = $false
                arguments = $agyDryRunArguments
                nativeArguments = (($agyDryRunArguments | ForEach-Object { ConvertTo-NativeArgument -Value $_ }) -join ' ')
            } | ConvertTo-Json -Depth 4
            exit 0
        }
        $agyProcess = Invoke-NativeProcess -Executable $commandPath -Arguments $agyArguments -Directory $resolvedDirectory -TimeoutMilliseconds ($TimeoutSeconds * 1000)
        if ($agyProcess.TimedOut) { throw "agy exceeded the ${TimeoutSeconds}s timeout and was stopped." }
        if ($agyProcess.StdoutTruncated) { throw 'agy output exceeded the bounded capture limit.' }
        if ($agyProcess.ExitCode -ne 0) { throw "agy exited with code $($agyProcess.ExitCode)." }
        if ($agyProcess.Stdout) { Write-Output $agyProcess.Stdout.TrimEnd() }
        if ($agyProcess.Stderr) { [Console]::Error.Write((Protect-SensitiveText -Text $agyProcess.Stderr)) }
        exit 0
    }

    $advisoryPrompt = if ($DiagnosticMode) {
        @"
Act as a read-only connectivity diagnostic. Do not modify files, create commits,
change configuration, or invoke other agents. Respond directly and briefly.

Task:
$taskPrompt
"@
    } else {
        @"
Act as a read-only advisory reviewer. Do not modify files, create commits,
change configuration, or invoke other agents. Inspect only the repository
content needed for the task. Return the completed review now; do not announce
intent or describe work you may do later. Provide substantive evidence for the
reviewed requirements or files. Use status pass only with no actionable
findings, changes_required only with at least one actionable finding, and
incomplete when you cannot finish the review.

Task:
$taskPrompt
"@
    }
    $advisoryBytes = [System.Text.UTF8Encoding]::new($false).GetBytes($advisoryPrompt)
    $promptSha256 = Get-PromptSha256 -Bytes $advisoryBytes

    $dryRunArguments = @(
        '--cwd', $resolvedDirectory,
        '--permission-mode', 'plan',
        '--no-plan',
        '--no-subagents',
        '--no-memory',
        '--disable-web-search',
        '--no-auto-update',
        '--max-turns', '8'
    ) + $(if ($DiagnosticMode) { @('--output-format', 'plain') } else { @('--json-schema', $script:GrokReviewSchema) }) +
        $(if ($Model) { @('--model', $Model) } else { @() }) +
        @('--prompt-file', '<managed-temporary-utf8-prompt-file>')
    if ($DryRun) {
        [ordered]@{
            schemaVersion = $script:SchemaVersion
            provider = $Provider
            executable = $commandPath
            workingDirectory = $resolvedDirectory
            promptSource = $PSCmdlet.ParameterSetName
            promptLength = $advisoryPrompt.Length
            promptSha256 = $promptSha256
            outputFormat = $resolvedOutputFormat
            diagnosticMode = [bool]$DiagnosticMode
            reviewReportRequired = -not [bool]$DiagnosticMode
            arguments = $dryRunArguments
            nativeArguments = (($dryRunArguments | ForEach-Object { ConvertTo-NativeArgument -Value $_ }) -join ' ')
        } | ConvertTo-Json -Depth 5
        exit 0
    }

    $overallStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $overallTimeoutMilliseconds = $TimeoutSeconds * 1000
    $versionBudget = [Math]::Min(10000, $overallTimeoutMilliseconds)
    $versionProcess = Invoke-NativeProcess -Executable $commandPath -Arguments @('--no-auto-update', 'version', '--json') -Directory $resolvedDirectory -TimeoutMilliseconds $versionBudget
    if ($versionProcess.TimedOut -or $versionProcess.StdoutTruncated -or $versionProcess.ExitCode -ne 0) {
        $metadata = New-ReviewMetadata -CliVersion $null -SelectedModel $Model -Attempts 0 -DurationMilliseconds ([int]$overallStopwatch.ElapsedMilliseconds) -PromptSha256 $promptSha256
        $result = New-FailureResult -Status 'unavailable' -Kind 'preflight' -Message 'Grok version preflight failed.' -Metadata $metadata
        Stop-WithReviewResult -Result $result -Format $resolvedOutputFormat -ExitCode 3
    }
    try {
        $versionEnvelope = $versionProcess.Stdout | ConvertFrom-Json -ErrorAction Stop
        $currentVersion = [string](Get-ExactObjectProperty -Object $versionEnvelope -Name 'currentVersion')
        $releaseChannel = [string](Get-ExactObjectProperty -Object $versionEnvelope -Name 'channel')
        $semanticVersionMatch = [regex]::Match($currentVersion, '^(\d+\.\d+\.\d+)')
        if (-not $semanticVersionMatch.Success -or
            [version]$semanticVersionMatch.Groups[1].Value -lt [version]'0.2.118') {
            throw 'Unsupported Grok CLI version.'
        }
        $cliVersion = if ($releaseChannel) { "$currentVersion [$releaseChannel]" } else { $currentVersion }
    } catch {
        $metadata = New-ReviewMetadata -CliVersion $null -SelectedModel $Model -Attempts 0 -DurationMilliseconds ([int]$overallStopwatch.ElapsedMilliseconds) -PromptSha256 $promptSha256
        $result = New-FailureResult -Status 'unavailable' -Kind 'version' -Message 'Grok CLI 0.2.118 or newer with structured review support is required.' -Metadata $metadata
        Stop-WithReviewResult -Result $result -Format $resolvedOutputFormat -ExitCode 3
    }

    $remainingMilliseconds = $overallTimeoutMilliseconds - [int]$overallStopwatch.ElapsedMilliseconds
    if ($remainingMilliseconds -le 0) {
        $metadata = New-ReviewMetadata -CliVersion $cliVersion -SelectedModel $Model -Attempts 0 -DurationMilliseconds ([int]$overallStopwatch.ElapsedMilliseconds) -PromptSha256 $promptSha256
        $result = New-FailureResult -Status 'unavailable' -Kind 'timeout' -Message 'Grok preflight exhausted the review timeout.' -Metadata $metadata
        Stop-WithReviewResult -Result $result -Format $resolvedOutputFormat -ExitCode 3
    }
    $modelsBudget = [Math]::Min(20000, $remainingMilliseconds)
    $modelsProcess = Invoke-NativeProcess -Executable $commandPath -Arguments @('--no-auto-update', 'models') -Directory $resolvedDirectory -TimeoutMilliseconds $modelsBudget
    if ($modelsProcess.TimedOut -or $modelsProcess.StdoutTruncated -or $modelsProcess.ExitCode -ne 0) {
        $metadata = New-ReviewMetadata -CliVersion $cliVersion -SelectedModel $Model -Attempts 0 -DurationMilliseconds ([int]$overallStopwatch.ElapsedMilliseconds) -PromptSha256 $promptSha256
        $result = New-FailureResult -Status 'unavailable' -Kind 'authentication_or_models' -Message 'Grok model preflight failed. Run grok login and verify model access.' -Metadata $metadata
        Stop-WithReviewResult -Result $result -Format $resolvedOutputFormat -ExitCode 3
    }
    $modelsText = $modelsProcess.Stdout
    $defaultModelMatches = [regex]::Matches($modelsText, '(?im)^Default model:\s*(\S+)\s*$')
    $availableModels = @([regex]::Matches($modelsText, '(?m)^\s*[-*]\s+([^\s(]+)') | ForEach-Object { $_.Groups[1].Value })
    $selectedModel = if ($Model) {
        $Model
    } elseif ($defaultModelMatches.Count -eq 1) {
        $defaultModelMatches[0].Groups[1].Value
    } else {
        $null
    }
    if ([string]::IsNullOrWhiteSpace($selectedModel) -or $availableModels -notcontains $selectedModel -or -not (Test-GrokModelName -Name $selectedModel)) {
        $metadata = New-ReviewMetadata -CliVersion $cliVersion -SelectedModel $selectedModel -Attempts 0 -DurationMilliseconds ([int]$overallStopwatch.ElapsedMilliseconds) -PromptSha256 $promptSha256
        $result = New-FailureResult -Status 'unavailable' -Kind 'model' -Message 'The selected/default model is unavailable or is not a Grok-family model.' -Metadata $metadata
        Stop-WithReviewResult -Result $result -Format $resolvedOutputFormat -ExitCode 3
    }

    $attempts = 0
    $ackRetryUsed = $false
    $timeoutRetryUsed = $false
    $transientRetries = 0
    while ($attempts -lt 3) {
        $attempts++
        $remainingMilliseconds = $overallTimeoutMilliseconds - [int]$overallStopwatch.ElapsedMilliseconds
        if ($remainingMilliseconds -le 0) {
            $metadata = New-ReviewMetadata -CliVersion $cliVersion -SelectedModel $selectedModel -Attempts ($attempts - 1) -DurationMilliseconds ([int]$overallStopwatch.ElapsedMilliseconds) -PromptSha256 $promptSha256
            $result = New-FailureResult -Status 'unavailable' -Kind 'timeout' -Message 'Grok review exhausted the overall timeout.' -Metadata $metadata
            Stop-WithReviewResult -Result $result -Format $resolvedOutputFormat -ExitCode 3
        }
        $attemptBudget = if (-not $timeoutRetryUsed -and $attempts -eq 1) {
            [Math]::Min(
                $remainingMilliseconds,
                [Math]::Max(250, [int][Math]::Floor($remainingMilliseconds * 0.8))
            )
        } else {
            $remainingMilliseconds
        }

        $managedPromptFile = Join-Path ([System.IO.Path]::GetTempPath()) (
            'sdoc-grok-review-{0}.txt' -f [System.Guid]::NewGuid().ToString('N')
        )
        $promptCleanupError = $null
        try {
            [System.IO.File]::WriteAllBytes($managedPromptFile, $advisoryBytes)
            $arguments = @(
                '--cwd', $resolvedDirectory,
                '--permission-mode', 'plan',
                '--no-plan',
                '--no-subagents',
                '--no-memory',
                '--disable-web-search',
                '--no-auto-update',
                '--max-turns', '8'
            ) + $(if ($DiagnosticMode) {
                @('--output-format', 'plain')
            } else {
                @('--json-schema', $script:GrokReviewSchema)
            }) + @('--model', $selectedModel) +
                @('--prompt-file', $managedPromptFile)
            $reviewProcess = Invoke-NativeProcess -Executable $commandPath -Arguments $arguments -Directory $resolvedDirectory -TimeoutMilliseconds $attemptBudget
        } finally {
            if (Test-Path -LiteralPath $managedPromptFile -PathType Leaf) {
                try { Remove-Item -LiteralPath $managedPromptFile -Force -ErrorAction Stop } catch {
                    $promptCleanupError = $_.Exception.Message
                }
            }
        }
        if ($null -ne $promptCleanupError) {
            $metadata = New-ReviewMetadata -CliVersion $cliVersion -SelectedModel $selectedModel -Attempts $attempts -DurationMilliseconds ([int]$overallStopwatch.ElapsedMilliseconds) -PromptSha256 $promptSha256
            $result = New-FailureResult -Status 'incomplete' -Kind 'cleanup' -Message 'Failed to remove a managed Grok prompt file.' -Metadata $metadata
            Stop-WithReviewResult -Result $result -Format $resolvedOutputFormat -ExitCode 4
        }

        if ($reviewProcess.TimedOut) {
            if (-not $timeoutRetryUsed -and $attempts -lt 3) {
                $timeoutRetryUsed = $true
                continue
            }
            $metadata = New-ReviewMetadata -CliVersion $cliVersion -SelectedModel $selectedModel -Attempts $attempts -DurationMilliseconds ([int]$overallStopwatch.ElapsedMilliseconds) -PromptSha256 $promptSha256
            $result = New-FailureResult -Status 'unavailable' -Kind 'timeout' -Message 'Grok review timed out.' -Metadata $metadata
            Stop-WithReviewResult -Result $result -Format $resolvedOutputFormat -ExitCode 3
        }

        if ($reviewProcess.ExitCode -ne 0) {
            $failureText = "$($reviewProcess.Stderr)`n$($reviewProcess.Stdout)"
            $failureKind = Get-ProcessFailureKind -Text $failureText
            if ($failureKind -eq 'transient' -and $transientRetries -lt 2 -and $attempts -lt 3) {
                $transientRetries++
                $retryAfter = Get-RetryAfterSeconds -Text $failureText
                $baseDelay = if ($null -ne $retryAfter) { $retryAfter } elseif ($transientRetries -eq 1) { 2 } else { 5 }
                $jitterMilliseconds = Get-Random -Minimum -200 -Maximum 201
                $delayMilliseconds = [Math]::Max(0, ($baseDelay * 1000) + [int]($baseDelay * $jitterMilliseconds))
                $remainingAfterFailure = $overallTimeoutMilliseconds - [int]$overallStopwatch.ElapsedMilliseconds
                if ($delayMilliseconds -lt $remainingAfterFailure) {
                    Start-Sleep -Milliseconds $delayMilliseconds
                    continue
                }
            }

            $metadata = New-ReviewMetadata -CliVersion $cliVersion -SelectedModel $selectedModel -Attempts $attempts -DurationMilliseconds ([int]$overallStopwatch.ElapsedMilliseconds) -PromptSha256 $promptSha256
            if ($failureKind -eq 'arguments') {
                $result = New-FailureResult -Status 'incomplete' -Kind $failureKind -Message 'Grok rejected the wrapper arguments or structured schema.' -Metadata $metadata
                Stop-WithReviewResult -Result $result -Format $resolvedOutputFormat -ExitCode 4
            }
            $message = switch ($failureKind) {
                'authentication' { 'Grok authentication failed. Run grok login and try again.' }
                'model' { 'Grok rejected the selected model.' }
                'transient' { 'Grok remained unavailable after bounded transient retries.' }
                default { 'Grok review process failed.' }
            }
            $result = New-FailureResult -Status 'unavailable' -Kind $failureKind -Message $message -Metadata $metadata
            Stop-WithReviewResult -Result $result -Format $resolvedOutputFormat -ExitCode 3
        }

        if ($DiagnosticMode) {
            $diagnosticText = Protect-SensitiveText -Text $reviewProcess.Stdout -MaximumLength 8192
            $metadata = New-ReviewMetadata -CliVersion $cliVersion -SelectedModel $selectedModel -Attempts $attempts -DurationMilliseconds ([int]$overallStopwatch.ElapsedMilliseconds) -PromptSha256 $promptSha256
            $diagnosticResult = [ordered]@{
                schemaVersion = $script:SchemaVersion
                provider = 'grok'
                mode = 'diagnostic'
                reviewStatus = 'diagnostic'
                conclusion = 'Grok connectivity diagnostic completed; this is not a valid critique.'
                rawResponse = $diagnosticText
                metadata = $metadata
            }
            if ($resolvedOutputFormat -eq 'Text') { Write-Output $diagnosticText } else { Write-AdvisorResult -Result $diagnosticResult -Format 'Json' }
            exit 0
        }

        if ($reviewProcess.StdoutTruncated) {
            if (-not $ackRetryUsed -and $attempts -lt 3) {
                $ackRetryUsed = $true
                continue
            }
            $metadata = New-ReviewMetadata -CliVersion $cliVersion -SelectedModel $selectedModel -Attempts $attempts -DurationMilliseconds ([int]$overallStopwatch.ElapsedMilliseconds) -PromptSha256 $promptSha256
            $result = New-FailureResult -Status 'incomplete' -Kind 'truncated' -Message 'Grok review output exceeded the bounded capture limit.' -Metadata $metadata
            Stop-WithReviewResult -Result $result -Format $resolvedOutputFormat -ExitCode 2
        }

        $metadata = New-ReviewMetadata -CliVersion $cliVersion -SelectedModel $selectedModel -Attempts $attempts -DurationMilliseconds ([int]$overallStopwatch.ElapsedMilliseconds) -PromptSha256 $promptSha256
        $parsedReview = ConvertFrom-GrokStructuredReview -Stdout $reviewProcess.Stdout -ExpectedModel $selectedModel -Metadata $metadata
        if ($parsedReview.Complete) {
            Write-AdvisorResult -Result $parsedReview.Result -Format $resolvedOutputFormat
            exit 0
        }
        if ($parsedReview.Retryable -and -not $ackRetryUsed -and $attempts -lt 3) {
            $ackRetryUsed = $true
            continue
        }

        if ($parsedReview.Kind -eq 'model_attestation') {
            $result = New-FailureResult -Status 'unavailable' -Kind $parsedReview.Kind -Message $parsedReview.Message -Metadata $metadata
            Stop-WithReviewResult -Result $result -Format $resolvedOutputFormat -ExitCode 3
        }
        $result = New-FailureResult -Status 'incomplete' -Kind $parsedReview.Kind -Message $parsedReview.Message -Metadata $metadata
        Stop-WithReviewResult -Result $result -Format $resolvedOutputFormat -ExitCode 2
    }

    $metadata = New-ReviewMetadata -CliVersion $cliVersion -SelectedModel $selectedModel -Attempts $attempts -DurationMilliseconds ([int]$overallStopwatch.ElapsedMilliseconds) -PromptSha256 $promptSha256
    $result = New-FailureResult -Status 'incomplete' -Kind 'attempts' -Message 'Grok review did not complete within the bounded attempts.' -Metadata $metadata
    Stop-WithReviewResult -Result $result -Format $resolvedOutputFormat -ExitCode 2
} catch {
    $safeMessage = Protect-SensitiveText -Text $_.Exception.Message
    if ($Provider -eq 'grok') {
        $durationMilliseconds = if ($null -ne $overallStopwatch) {
            [int]$overallStopwatch.ElapsedMilliseconds
        } else {
            0
        }
        $providerUnavailable = $providerResolutionFailed -or
            $_.Exception -is [System.ComponentModel.Win32Exception] -or
            $safeMessage -match '(?i)failed to start'
        $metadata = New-ReviewMetadata -CliVersion $cliVersion -SelectedModel $selectedModel -Attempts $attempts -DurationMilliseconds $durationMilliseconds -PromptSha256 $promptSha256
        if ($providerUnavailable) {
            $result = New-FailureResult -Status 'unavailable' -Kind 'provider' -Message 'The Grok CLI executable is unavailable.' -Metadata $metadata
            Stop-WithReviewResult -Result $result -Format $resolvedOutputFormat -ExitCode 3
        }
        $result = New-FailureResult -Status 'incomplete' -Kind 'wrapper' -Message 'The Grok advisor wrapper failed internally.' -Metadata $metadata
        Stop-WithReviewResult -Result $result -Format $resolvedOutputFormat -ExitCode 4
    }
    [Console]::Error.WriteLine($safeMessage)
    exit 4
}
