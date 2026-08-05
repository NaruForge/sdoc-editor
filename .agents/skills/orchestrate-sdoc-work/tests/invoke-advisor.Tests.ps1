[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../../..')).Path
$wrapperPath = Join-Path $repositoryRoot '.agents/skills/orchestrate-sdoc-work/scripts/invoke-advisor.ps1'
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) (
    'sdoc advisor wrapper tests {0}' -f [System.Guid]::NewGuid().ToString('N')
)
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
$script:passed = 0

function ConvertTo-NativeArgument {
    param([AllowEmptyString()][string]$Value)

    if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') {
        return $Value
    }

    $builder = New-Object System.Text.StringBuilder
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

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

function Assert-Equal {
    param($Actual, $Expected, [string]$Message)
    if ($Actual -cne $Expected) {
        throw "$Message Expected '$Expected', received '$Actual'."
    }
}

function Assert-Matches {
    param([AllowEmptyString()][string]$Actual, [string]$Pattern, [string]$Message)
    if ($Actual -notmatch $Pattern) { throw "$Message Output: $Actual" }
}

function Assert-NotMatches {
    param([AllowEmptyString()][string]$Actual, [string]$Pattern, [string]$Message)
    if ($Actual -match $Pattern) { throw "$Message Output: $Actual" }
}

function Complete-Test {
    param([string]$Name)
    $script:passed++
    Write-Host "[PASS] $Name"
}

function New-TestCase {
    param([string]$Name, [string]$Scenario)
    $path = Join-Path $testRoot $Name
    [System.IO.Directory]::CreateDirectory($path) | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $path 'scenario.txt'), $Scenario, $utf8WithoutBom)
    return $path
}

function Invoke-WrapperChild {
    param(
        [string]$Provider,
        [string]$WorkingDirectory,
        [string]$Prompt,
        [string]$PromptFile,
        [string]$TaskSpecFile,
        [ValidateSet('Legacy', 'Planning', 'FinalDiff')]
        [string]$CritiqueMode,
        [string]$ChangeSetFile,
        [string]$BaseRef,
        [string]$OutputFormat,
        [ValidateSet('Summary', 'Full')]
        [string]$OutputDetail,
        [string]$ResultFile,
        [string]$AdvisorContextScript,
        [string]$Model,
        [int]$TimeoutSeconds = 8,
        [switch]$DryRun,
        [switch]$DiagnosticMode,
        [switch]$UseDiagnosticAlias,
        [switch]$AllowContextExpansion
    )

    $shellPath = [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
    $arguments = @(
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', $wrapperPath,
        '-Provider', $Provider,
        '-WorkingDirectory', $WorkingDirectory,
        '-ProviderExecutable', $script:fakeProviderPath,
        '-TimeoutSeconds', [string]$TimeoutSeconds
    )
    if (-not [string]::IsNullOrEmpty($TaskSpecFile)) {
        $arguments += @('-TaskSpecFile', $TaskSpecFile)
    } elseif (-not [string]::IsNullOrEmpty($PromptFile)) {
        $arguments += @('-PromptFile', $PromptFile)
    } else {
        $arguments += @('-Prompt', $Prompt)
    }
    if (-not [string]::IsNullOrEmpty($CritiqueMode)) { $arguments += @('-CritiqueMode', $CritiqueMode) }
    if (-not [string]::IsNullOrEmpty($ChangeSetFile)) { $arguments += @('-ChangeSetFile', $ChangeSetFile) }
    if (-not [string]::IsNullOrEmpty($BaseRef)) { $arguments += @('-BaseRef', $BaseRef) }
    if (-not [string]::IsNullOrEmpty($OutputFormat)) { $arguments += @('-OutputFormat', $OutputFormat) }
    if (-not [string]::IsNullOrEmpty($OutputDetail)) { $arguments += @('-OutputDetail', $OutputDetail) }
    if (-not [string]::IsNullOrEmpty($ResultFile)) { $arguments += @('-ResultFile', $ResultFile) }
    if (-not [string]::IsNullOrEmpty($AdvisorContextScript)) {
        $arguments += @('-AdvisorContextScript', $AdvisorContextScript)
    }
    if (-not [string]::IsNullOrEmpty($Model)) { $arguments += @('-Model', $Model) }
    if ($DryRun) { $arguments += '-DryRun' }
    if ($DiagnosticMode) { $arguments += '-DiagnosticMode' }
    if ($UseDiagnosticAlias) { $arguments += '-AllowIncompleteResponse' }
    if ($AllowContextExpansion) { $arguments += '-AllowContextExpansion' }

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $shellPath
    $startInfo.Arguments = (($arguments | ForEach-Object { ConvertTo-NativeArgument ([string]$_) }) -join ' ')
    $startInfo.WorkingDirectory = $repositoryRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    if ($null -ne $startInfo.PSObject.Properties['StandardOutputEncoding']) {
        $startInfo.StandardOutputEncoding = $utf8WithoutBom
        $startInfo.StandardErrorEncoding = $utf8WithoutBom
    }

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    try {
        Assert-True $process.Start() 'Failed to start the child PowerShell process.'
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(20000)) {
            & taskkill.exe /PID $process.Id /T /F 2>$null | Out-Null
            throw 'The child PowerShell process exceeded the harness timeout.'
        }
        $process.WaitForExit()
        return [pscustomobject]@{
            ExitCode = $process.ExitCode
            Stdout = ([string]$stdoutTask.Result).TrimEnd()
            Stderr = ([string]$stderrTask.Result).TrimEnd()
        }
    } finally {
        $process.Dispose()
    }
}

function Get-CallFiles {
    param([string]$CaseDirectory)
    $callsDirectory = Join-Path $CaseDirectory 'calls'
    if (-not (Test-Path -LiteralPath $callsDirectory -PathType Container)) { return @() }
    return @(Get-ChildItem -LiteralPath $callsDirectory -Filter '*.args' | Sort-Object Name)
}

function Get-CallCount {
    param([string]$CaseDirectory)
    $files = @(Get-CallFiles $CaseDirectory)
    return $files.Count
}

function Get-CallArguments {
    param([System.IO.FileInfo]$CallFile)
    return @([System.IO.File]::ReadAllLines($CallFile.FullName, [System.Text.Encoding]::UTF8) | ForEach-Object {
        [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($_))
    })
}

function New-TaskSpecFile {
    param([string]$CaseDirectory, [string]$Name = 'task-spec.json')
    $path = Join-Path $CaseDirectory $Name
    $content = '{"schemaVersion":1,"goal":"Exercise the explicit critique contract.","requirements":["Keep payload-only isolation."],"acceptanceCriteria":["Return validated evidence."],"testEvidence":["Fake-provider contract fixture."],"proposedApproach":"Use the generated bounded bundle.","alternatives":["Legacy free-form prompt."],"assumptions":["The routing registry is valid."],"affectedSurfaces":["advisor wrapper"],"openQuestions":[]}'
    [System.IO.File]::WriteAllText($path, $content, $utf8WithoutBom)
    return $path
}

function Get-GeneratorCall {
    param([string]$CaseDirectory, [int]$Call)
    $path = Join-Path $CaseDirectory ('generator-call-{0:D2}.json' -f $Call)
    return [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8) |
        ConvertFrom-Json
}

function Assert-StrictUtf8NoBomFile {
    param([string]$Path, [string]$Message)
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    Assert-True ($bytes.Length -gt 0) "$Message File was empty."
    Assert-True (-not (
        $bytes.Length -ge 3 -and $bytes[0] -eq 0xef -and
        $bytes[1] -eq 0xbb -and $bytes[2] -eq 0xbf
    )) "$Message File used a UTF-8 BOM."
    [void]([System.Text.UTF8Encoding]::new($false, $true).GetString($bytes))
}

$fakeProviderSource = @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Threading;

internal static class FakeProvider
{
    private const string PassEnvelope = "{\"structuredOutput\":{\"status\":\"pass\",\"conclusion\":\"Review completed with no actionable findings.\",\"confidence\":\"high\",\"evidence\":[{\"claim\":\"The requested contract was exercised.\",\"support\":\"The fake provider observed the native invocation.\",\"file\":\"tests/fake.txt\",\"line\":1}],\"findings\":[],\"risks\":[],\"assumptions\":[]},\"modelUsage\":{\"grok-4\":{}},\"thought\":\"PRIVATE_THOUGHT\",\"sessionId\":\"PRIVATE_SESSION\"}";
    private const string FindingsEnvelope = "{\"structuredOutput\":{\"status\":\"changes_required\",\"conclusion\":\"One actionable defect remains.\",\"confidence\":\"medium\",\"evidence\":[{\"claim\":\"A defect is present.\",\"support\":\"The fixture identifies the failing boundary.\",\"file\":\"shared/example.ts\",\"line\":7}],\"findings\":[{\"severity\":\"major\",\"title\":\"Boundary is unchecked\",\"claim\":\"Input can bypass validation.\",\"evidence\":\"The fixture reaches the unchecked branch.\",\"recommendation\":\"Validate at the boundary.\",\"file\":\"shared/example.ts\",\"line\":7}],\"risks\":[\"Invalid input may persist.\"],\"assumptions\":[\"The fixture represents production input.\"]},\"modelUsage\":{\"grok-4\":{}}}";
    private const string AckEnvelope = "{\"structuredOutput\":{\"status\":\"incomplete\",\"conclusion\":\"I will review this now.\",\"confidence\":\"low\",\"evidence\":[],\"findings\":[],\"risks\":[],\"assumptions\":[]},\"modelUsage\":{\"grok-4\":{}}}";
    private const string InvalidSchemaEnvelope = "{\"structuredOutput\":{\"status\":\"pass\",\"conclusion\":\"Review completed.\",\"confidence\":\"high\",\"evidence\":[{\"claim\":\"Missing support\"}],\"findings\":[],\"risks\":[],\"assumptions\":[]},\"modelUsage\":{\"grok-4\":{}}}";
    private const string ExtraPropertyEnvelope = "{\"structuredOutput\":{\"status\":\"pass\",\"conclusion\":\"Review completed.\",\"confidence\":\"high\",\"evidence\":[{\"claim\":\"Evidence claim\",\"support\":\"Evidence support\"}],\"findings\":[],\"risks\":[],\"assumptions\":[],\"unexpected\":true},\"modelUsage\":{\"grok-4\":{}}}";
    private const string PlanningPassEnvelope = "{\"structuredOutput\":{\"reviewInputSha256\":\"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc\",\"status\":\"pass\",\"contextStatus\":\"sufficient\",\"requestedContext\":[],\"conclusion\":\"Planning critique completed with no actionable findings.\",\"confidence\":\"high\",\"evidence\":[{\"claim\":\"The plan was challenged.\",\"support\":\"The generated planning bundle contains the bounded task and canonical context.\",\"file\":\"shared/example.ts\",\"line\":1}],\"findings\":[],\"risks\":[],\"assumptions\":[]},\"modelUsage\":{\"grok-4\":{}}}";
    private const string PlanningRequestEnvelope = "{\"structuredOutput\":{\"reviewInputSha256\":\"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc\",\"status\":\"incomplete\",\"contextStatus\":\"needs_context\",\"requestedContext\":[\"shared/example.ts\"],\"conclusion\":\"One allowlisted source file is needed.\",\"confidence\":\"low\",\"evidence\":[{\"claim\":\"The current shard omits the implementation.\",\"support\":\"Only routing metadata is present.\"}],\"findings\":[],\"risks\":[],\"assumptions\":[]},\"modelUsage\":{\"grok-4\":{}}}";
    private const string PlanningContradictionEnvelope = "{\"structuredOutput\":{\"reviewInputSha256\":\"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc\",\"status\":\"pass\",\"contextStatus\":\"sufficient\",\"requestedContext\":[\"shared/example.ts\"],\"conclusion\":\"Contradictory context state.\",\"confidence\":\"high\",\"evidence\":[{\"claim\":\"Evidence claim.\",\"support\":\"Evidence support.\"}],\"findings\":[],\"risks\":[],\"assumptions\":[]},\"modelUsage\":{\"grok-4\":{}}}";
    private const string FinalMissingEvidenceEnvelope = "{\"structuredOutput\":{\"reviewInputSha256\":\"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc\",\"status\":\"pass\",\"conclusion\":\"Unsupported pass.\",\"confidence\":\"high\",\"evidence\":[],\"findings\":[],\"risks\":[],\"assumptions\":[]},\"modelUsage\":{\"grok-4\":{}}}";
    private const string ReviewInputSha256 = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
    private const string FinalPassEnvelope = "{\"structuredOutput\":{\"reviewInputSha256\":\"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc\",\"status\":\"pass\",\"conclusion\":\"Review completed with no actionable findings.\",\"confidence\":\"high\",\"evidence\":[{\"claim\":\"The requested contract was exercised.\",\"support\":\"The fake provider observed the bounded final-diff payload.\",\"file\":\"shared/example.ts\",\"line\":1}],\"findings\":[],\"risks\":[],\"assumptions\":[]},\"modelUsage\":{\"grok-4\":{}}}";

    private static bool HasArgument(string[] args, string value)
    {
        foreach (string arg in args) if (arg == value) return true;
        return false;
    }

    private static string ArgumentAfter(string[] args, string name)
    {
        for (int i = 0; i + 1 < args.Length; i++) if (args[i] == name) return args[i + 1];
        return null;
    }

    private static int RecordCall(string directory, string[] args)
    {
        string counterPath = Path.Combine(directory, "counter.txt");
        int count = File.Exists(counterPath) ? Int32.Parse(File.ReadAllText(counterPath)) : 0;
        count++;
        File.WriteAllText(counterPath, count.ToString(), new UTF8Encoding(false));
        string callsDirectory = Path.Combine(directory, "calls");
        Directory.CreateDirectory(callsDirectory);
        string[] encoded = new string[args.Length];
        for (int i = 0; i < args.Length; i++) encoded[i] = Convert.ToBase64String(Encoding.UTF8.GetBytes(args[i]));
        File.WriteAllLines(Path.Combine(callsDirectory, String.Format("call-{0:D2}.args", count)), encoded, new UTF8Encoding(false));
        return count;
    }

    private static int Fail(string message)
    {
        Console.Error.WriteLine(message);
        return 1;
    }

    public static int Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        Console.InputEncoding = new UTF8Encoding(false);
        string directory = Directory.GetCurrentDirectory();
        string scenario = File.ReadAllText(Path.Combine(directory, "scenario.txt"), Encoding.UTF8).Trim();
        int call = RecordCall(directory, args);

        if (args.Length == 3 && args[0] == "--no-auto-update" && args[1] == "version" && args[2] == "--json")
        {
            if (scenario == "versionFailure") return Fail("version command failed");
            if (scenario == "unsupportedVersion")
            {
                Console.WriteLine("{\"currentVersion\":\"0.2.117\",\"channel\":\"test\"}");
                return 0;
            }
            if (scenario == "malformedVersion")
            {
                Console.WriteLine("not-json");
                return 0;
            }
            Console.WriteLine("{\"currentVersion\":\"9.9.9\",\"channel\":\"test\"}");
            return 0;
        }

        if (args.Length == 2 && args[0] == "--no-auto-update" && args[1] == "models")
        {
            if (scenario == "authPreflight") return Fail("401 authentication required; api_key=sk-secretsecret");
            if (scenario == "familyFailure")
            {
                Console.WriteLine("Default model: claude-test\n- claude-test");
                return 0;
            }
            if (scenario == "directModelFallback")
            {
                Console.WriteLine("Default model: ocx-grok-fast\n- ocx-grok-fast\n- grok-4\n- grok-4-fast");
                return 0;
            }
            Console.WriteLine("Default model: grok-4\n- grok-4\n- grok-4-fast");
            return 0;
        }

        if (args.Length == 3 && args[0] == "--no-auto-update" &&
            args[1] == "inspect" && args[2] == "--json")
        {
            Console.WriteLine("{\"plugins\":[],\"mcpServers\":[],\"hooks\":[],\"configWarnings\":[]}");
            return 0;
        }

        if (scenario == "agy" || scenario == "agyTruncated")
        {
            if (!HasArgument(args, "--mode") || ArgumentAfter(args, "--mode") != "plan" ||
                !HasArgument(args, "--sandbox") || !HasArgument(args, "--print-timeout") ||
                String.IsNullOrEmpty(ArgumentAfter(args, "--print")))
                return Fail("agy arguments were not preserved");
            if (scenario == "agyTruncated") Console.Write(new string('a', 70000));
            else Console.WriteLine("AGY_OK");
            return 0;
        }

        string reviewSchema = ArgumentAfter(args, "--json-schema") ?? String.Empty;
        bool planningContract = reviewSchema.IndexOf("contextStatus", StringComparison.Ordinal) >= 0;
        bool explicitContract = reviewSchema.IndexOf("reviewInputSha256", StringComparison.Ordinal) >= 0;
        int reviewAttempt = call - (explicitContract ? 3 : 2);
        if (scenario == "ackThenPass" && reviewAttempt == 1)
        {
            Console.WriteLine(AckEnvelope);
            return 0;
        }
        if (scenario == "missingThenPass" && reviewAttempt == 1)
        {
            Console.WriteLine("{\"text\":\"OK\",\"modelUsage\":{\"grok-4\":{}}}");
            return 0;
        }
        if (scenario == "substantiveMissingThenPass" && reviewAttempt == 1)
        {
            Console.WriteLine("{\"text\":\"A long apparent review still lacks the required structuredOutput contract and must be retried.\",\"modelUsage\":{\"grok-4\":{}}}");
            return 0;
        }
        if (scenario == "missingStructured")
        {
            Console.WriteLine("{\"text\":\"No structured output was produced.\",\"modelUsage\":{\"grok-4\":{}}}");
            return 0;
        }
        if (scenario == "toolAttempt")
            return Fail("run_terminal_command approval cancelled");
        if (scenario == "truncatedThenPass" && reviewAttempt == 1)
        {
            Console.Write(new string('x', 70000));
            Console.WriteLine("}");
            return 0;
        }
        if (scenario == "malformedEnvelope")
        {
            Console.WriteLine("{this is not json}");
            return 0;
        }
        if (scenario == "malformedThenPass" && reviewAttempt == 1)
        {
            Console.WriteLine("{\"structuredOutput\":");
            return 0;
        }
        if (scenario == "invalidSchema")
        {
            Console.WriteLine(InvalidSchemaEnvelope);
            return 0;
        }
        if (scenario == "extraSchemaProperty")
        {
            Console.WriteLine(ExtraPropertyEnvelope);
            return 0;
        }
        if (scenario == "transientThenPass" && reviewAttempt == 1)
            return Fail("503 service unavailable; retry-after: 0");
        if (scenario == "schemaArgumentFailure")
            return Fail("invalid JSON schema supplied to --json-schema");
        if (scenario == "timeout")
        {
            Thread.Sleep(5000);
            Console.WriteLine(PassEnvelope);
            return 0;
        }
        if (scenario == "secretFailure")
            return Fail("fatal Bearer abcdefghijklmnop xai-supersecret123 api_key=sk-anothersecret");
        if (scenario == "diagnostic")
        {
            if (!HasArgument(args, "--output-format") || HasArgument(args, "--json-schema"))
                return Fail("diagnostic invocation used review schema");
            Console.WriteLine("diagnostic connectivity ok");
            return 0;
        }
        if (scenario == "validatePrompt")
        {
            string promptPath = ArgumentAfter(args, "--prompt-file");
            string schema = ArgumentAfter(args, "--json-schema");
            if (String.IsNullOrEmpty(promptPath) || !File.Exists(promptPath) ||
                !HasArgument(args, "--no-plan") || !HasArgument(args, "--no-subagents") ||
                !HasArgument(args, "--disable-web-search") ||
                String.IsNullOrEmpty(schema) || schema.IndexOf("additionalProperties", StringComparison.Ordinal) < 0)
                return Fail("unexpected argument or prompt-file contract");
            byte[] bytes = File.ReadAllBytes(promptPath);
            string prompt = new UTF8Encoding(false, true).GetString(bytes);
            if ((bytes.Length >= 3 && bytes[0] == 0xef && bytes[1] == 0xbb && bytes[2] == 0xbf) ||
                bytes.Length < 100000 || prompt.IndexOf("\uD55C\uAE00 \uD504\uB86C\uD504\uD2B8", StringComparison.Ordinal) < 0)
                return Fail("prompt UTF-8 or size validation failed");
            File.WriteAllText(Path.Combine(directory, "managed-prompt-path.txt"), promptPath, new UTF8Encoding(false));
            Console.WriteLine(PassEnvelope);
            return 0;
        }
        if (scenario == "planningContextRequest" && reviewAttempt == 1)
        {
            Console.WriteLine(PlanningRequestEnvelope);
            return 0;
        }
        if (scenario == "planningContradiction")
        {
            Console.WriteLine(PlanningContradictionEnvelope);
            return 0;
        }
        if (scenario == "finalMissingEvidence")
        {
            Console.WriteLine(FinalMissingEvidenceEnvelope);
            return 0;
        }
        if (scenario == "largeValidatedResult")
        {
            Console.WriteLine(FinalPassEnvelope.Replace(
                "Review completed with no actionable findings.", new string('z', 20000)));
            return 0;
        }
        if (scenario == "streamingOutputLimit")
        {
            Console.Write(new string('x', 1200000));
            return 0;
        }
        if (scenario == "payloadOnly" || scenario == "directModelFallback")
        {
            string promptPath = ArgumentAfter(args, "--prompt-file");
            if (ArgumentAfter(args, "--permission-mode") != "dontAsk" ||
                ArgumentAfter(args, "--tools") != String.Empty ||
                ArgumentAfter(args, "--deny") != "*" ||
                ArgumentAfter(args, "--max-turns") != "1" ||
                !HasArgument(args, "--disallowed-tools") ||
                !HasArgument(args, "--no-plan") || !HasArgument(args, "--no-subagents") ||
                !HasArgument(args, "--no-memory") || !HasArgument(args, "--disable-web-search") ||
                !HasArgument(args, "--verbatim") || String.IsNullOrEmpty(promptPath) ||
                !File.Exists(promptPath))
                return Fail("payload-only argument contract was not enforced");
            File.WriteAllText(Path.Combine(directory, "managed-prompt-path.txt"), promptPath, new UTF8Encoding(false));
            string envelope = planningContract ? PlanningPassEnvelope : FinalPassEnvelope;
            if (scenario == "directModelFallback")
            {
                string selected = ArgumentAfter(args, "--model");
                if (String.IsNullOrEmpty(selected) || !selected.StartsWith("grok-", StringComparison.Ordinal) ||
                    selected.StartsWith("ocx-", StringComparison.Ordinal))
                    return Fail("direct Grok model fallback was not selected");
                envelope = envelope.Replace("\"grok-4\"", "\"" + selected + "\"");
            }
            Console.WriteLine(envelope);
            return 0;
        }
        if (scenario == "selectedModel")
        {
            if (ArgumentAfter(args, "--model") != "grok-4-fast") return Fail("selected model was not pinned");
            Console.WriteLine(PassEnvelope.Replace("\"grok-4\"", "\"grok-4-fast\""));
            return 0;
        }
        if (scenario == "findings") Console.WriteLine(FindingsEnvelope);
        else if (planningContract) Console.WriteLine(PlanningPassEnvelope);
        else if (explicitContract) Console.WriteLine(FinalPassEnvelope);
        else Console.WriteLine(PassEnvelope);
        return 0;
    }
}
'@

$fakeContextGeneratorSource = @'
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Mode,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory,
    [Parameter(Mandatory = $true)][string]$TaskSpecFile,
    [string]$ChangeSetFile,
    [string]$BaseRef,
    [string[]]$RequestedPath,
    [string]$ContextExpansionRequestFile,
    [int]$MaximumBundleBytes,
    [int]$MaximumShardCount
)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false, $true)
$scenario = [System.IO.File]::ReadAllText(
    (Join-Path $WorkingDirectory 'scenario.txt'), $utf8
).Trim()
$counterPath = Join-Path $WorkingDirectory 'generator-counter.txt'
$call = if (Test-Path -LiteralPath $counterPath) {
    [int][System.IO.File]::ReadAllText($counterPath, $utf8)
} else { 0 }
$call++
[System.IO.File]::WriteAllText($counterPath, [string]$call, $utf8)

$argumentRecord = [ordered]@{
    mode = $Mode
    taskSpecFile = $TaskSpecFile
    changeSetFile = $ChangeSetFile
    baseRef = $BaseRef
    requestedPath = @($RequestedPath)
    contextExpansionRequestFile = $ContextExpansionRequestFile
    expansionRequestJson = if (
        -not [string]::IsNullOrWhiteSpace($ContextExpansionRequestFile) -and
        (Test-Path -LiteralPath $ContextExpansionRequestFile -PathType Leaf)
    ) {
        [System.IO.File]::ReadAllText($ContextExpansionRequestFile, $utf8)
    } else { $null }
    maximumBundleBytes = $MaximumBundleBytes
    maximumShardCount = $MaximumShardCount
}
[System.IO.File]::WriteAllText(
    (Join-Path $WorkingDirectory ('generator-call-{0:D2}.json' -f $call)),
    ($argumentRecord | ConvertTo-Json -Depth 5 -Compress),
    $utf8
)

foreach ($failure in @('hash', 'stale', 'coverage')) {
    if ($scenario -ceq ('generator_' + $failure)) {
        [Console]::Error.WriteLine('deterministic ' + $failure + ' validation failure')
        exit 4
    }
}

$artifactDirectory = Join-Path ([System.IO.Path]::GetTempPath()) (
    'sdoc-advisor-context-{0}' -f [System.Guid]::NewGuid().ToString('N')
)
[System.IO.Directory]::CreateDirectory($artifactDirectory) | Out-Null
$bundlePath = Join-Path $artifactDirectory 'bundle-01.txt'
$manifestPath = Join-Path $artifactDirectory 'integrity.json'
$coveragePath = Join-Path $artifactDirectory 'coverage.json'
[System.IO.File]::WriteAllText(
    $bundlePath,
    "mode=$Mode`ncall=$call`ncontext fixture`n",
    $utf8
)
$bundleBytes = [System.IO.File]::ReadAllBytes($bundlePath)
$sha256 = [System.Security.Cryptography.SHA256]::Create()
try {
    $bundleSha256 = (($sha256.ComputeHash($bundleBytes) | ForEach-Object {
        $_.ToString('x2')
    }) -join '')
} finally {
    $sha256.Dispose()
}
$manifest = [ordered]@{
    schemaVersion = 1
    selectedInputs = @()
    selectedInputFingerprint = ('a' * 64)
    configSha256 = ('b' * 64)
    bundles = @([ordered]@{
        fileName = [System.IO.Path]::GetFileName($bundlePath)
        bytes = $bundleBytes.Length
        sha256 = $bundleSha256
    })
}
[System.IO.File]::WriteAllText(
    $manifestPath,
    ($manifest | ConvertTo-Json -Depth 6 -Compress),
    $utf8
)
[System.IO.File]::WriteAllText(
    $coveragePath,
    '{"schemaVersion":1,"changedPaths":[],"relationships":[],"unclassifiedPaths":[],"selectionReasons":[]}',
    $utf8
)
[System.IO.File]::AppendAllText(
    (Join-Path $WorkingDirectory 'artifact-paths.txt'),
    $artifactDirectory + [Environment]::NewLine,
    $utf8
)

[ordered]@{
    schemaVersion = 1
    mode = $Mode
    contextStatus = 'complete'
    artifactDirectory = $artifactDirectory
    bundlePaths = @($bundlePath)
    integrityManifestPath = $manifestPath
    coveragePath = $coveragePath
    contextSha256 = ('c' * 64)
    fingerprint = ('d' * 64)
    selectionSha256 = ('e' * 64)
    selectedPaths = @('shared/example.ts')
    shards = @()
    expansionApplied = ($call -gt 1)
    callerMustDelete = $true
} | ConvertTo-Json -Depth 6 -Compress
'@

try {
    $sourceBytes = [System.IO.File]::ReadAllBytes($MyInvocation.MyCommand.Path)
    Assert-True (@($sourceBytes | Where-Object { $_ -gt 0x7f }).Count -eq 0) 'The harness source must remain ASCII-only for Windows PowerShell 5.1.'
    [System.IO.Directory]::CreateDirectory($testRoot) | Out-Null
    $providerDirectory = Join-Path $testRoot 'fake provider with spaces'
    [System.IO.Directory]::CreateDirectory($providerDirectory) | Out-Null
    $sourcePath = Join-Path $providerDirectory 'FakeProvider.cs'
    $script:fakeProviderPath = Join-Path $providerDirectory 'fake grok provider.exe'
    $script:fakeContextGeneratorPath = Join-Path $providerDirectory 'advisor-context.ps1'
    [System.IO.File]::WriteAllText($sourcePath, $fakeProviderSource, $utf8WithoutBom)
    [System.IO.File]::WriteAllText(
        $script:fakeContextGeneratorPath,
        $fakeContextGeneratorSource,
        $utf8WithoutBom
    )

    $compilerCandidates = @(
        (Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
        (Join-Path $env:WINDIR 'Microsoft.NET/Framework/v4.0.30319/csc.exe')
    )
    $compiler = @($compilerCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1)
    Assert-True ($compiler.Count -eq 1) 'The Windows .NET Framework C# compiler was not found.'
    $compilerOutput = & $compiler[0] /nologo /target:exe "/out:$script:fakeProviderPath" $sourcePath 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Failed to compile fake provider:`n$($compilerOutput -join "`n")" }
    Assert-True (Test-Path -LiteralPath $script:fakeProviderPath -PathType Leaf) 'The fake provider executable was not created.'

    $case = New-TestCase 'json pass' 'pass'
    $result = Invoke-WrapperChild -Provider grok -WorkingDirectory $case -Prompt 'Review the fixture.'
    Assert-Equal $result.ExitCode 0 "JSON pass exit code mismatch. stdout=[$($result.Stdout)] stderr=[$($result.Stderr)]"
    $json = $result.Stdout | ConvertFrom-Json
    Assert-Equal $json.reviewStatus 'pass' 'JSON pass status mismatch.'
    Assert-Equal $json.provider 'grok' 'JSON provider mismatch.'
    Assert-Equal $json.metadata.attempts 1 'JSON pass attempt count mismatch.'
    Assert-True (@($json.evidence).Count -eq 1) 'JSON pass evidence was not retained.'
    Assert-NotMatches $result.Stdout 'PRIVATE_THOUGHT|PRIVATE_SESSION' 'Raw thought or session metadata leaked.'
    Complete-Test 'JSON pass report'

    $case = New-TestCase 'json findings' 'findings'
    $result = Invoke-WrapperChild -Provider grok -WorkingDirectory $case -Prompt 'Find the defect.'
    Assert-Equal $result.ExitCode 0 'Findings exit code mismatch.'
    $json = $result.Stdout | ConvertFrom-Json
    Assert-Equal $json.reviewStatus 'changes_required' 'Findings status mismatch.'
    Assert-Equal $json.findings[0].severity 'major' 'Finding severity mismatch.'
    Assert-Equal $json.findings[0].file 'shared/example.ts' 'Finding evidence location mismatch.'
    Complete-Test 'JSON actionable findings report'

    $case = New-TestCase 'text renderer' 'findings'
    $result = Invoke-WrapperChild -Provider grok -WorkingDirectory $case -Prompt 'Render text.' -OutputFormat Text
    Assert-Equal $result.ExitCode 0 "Text renderer exit code mismatch. stdout=[$($result.Stdout)] stderr=[$($result.Stderr)]"
    Assert-Matches $result.Stdout '(?m)^Conclusion\r?$' 'Text renderer omitted Conclusion heading.'
    Assert-Matches $result.Stdout '(?m)^Findings\r?$' 'Text renderer omitted Findings heading.'
    Assert-Matches $result.Stdout '\[major\] Boundary is unchecked' 'Text renderer omitted the actionable finding.'
    Complete-Test 'Text renderer'

    foreach ($retryScenario in @(
        'ackThenPass', 'missingThenPass', 'substantiveMissingThenPass', 'truncatedThenPass'
    )) {
        $case = New-TestCase "retry $retryScenario" $retryScenario
        $result = Invoke-WrapperChild -Provider grok -WorkingDirectory $case -Prompt 'Complete the review.'
        Assert-Equal $result.ExitCode 0 "$retryScenario exit code mismatch. stdout=[$($result.Stdout)] stderr=[$($result.Stderr)]"
        $json = $result.Stdout | ConvertFrom-Json
        Assert-Equal $json.metadata.attempts 2 "$retryScenario did not report two attempts."
        Assert-True ((Get-CallCount $case) -eq 4) "$retryScenario did not make exactly one review retry."
        Complete-Test "$retryScenario bounded retry"
    }

    foreach ($rejection in @(
        @{ Scenario = 'malformedEnvelope'; Kind = 'envelope' },
        @{ Scenario = 'invalidSchema'; Kind = 'schema' },
        @{ Scenario = 'extraSchemaProperty'; Kind = 'schema' }
    )) {
        $case = New-TestCase "reject $($rejection.Scenario)" $rejection.Scenario
        $result = Invoke-WrapperChild -Provider grok -WorkingDirectory $case -Prompt 'Reject malformed output.'
        Assert-Equal $result.ExitCode 2 "$($rejection.Scenario) exit code mismatch."
        $json = $result.Stdout | ConvertFrom-Json
        Assert-Equal $json.error.kind $rejection.Kind "$($rejection.Scenario) error kind mismatch."
        Assert-True ((Get-CallCount $case) -eq 3) "$($rejection.Scenario) was unexpectedly retried."
        Complete-Test "$($rejection.Scenario) rejected without retry"
    }

    $case = New-TestCase 'provider schema rejection' 'schemaArgumentFailure'
    $result = Invoke-WrapperChild -Provider grok -WorkingDirectory $case -Prompt 'Reject the schema argument.'
    Assert-Equal $result.ExitCode 4 'Provider schema-rejection exit code mismatch.'
    $json = $result.Stdout | ConvertFrom-Json
    Assert-Equal $json.error.kind 'arguments' 'Provider schema-rejection error kind mismatch.'
    Assert-True ((Get-CallCount $case) -eq 3) 'Provider schema rejection was unexpectedly retried.'
    Complete-Test 'Provider schema rejection without retry'

    $case = New-TestCase 'authentication preflight' 'authPreflight'
    $result = Invoke-WrapperChild -Provider grok -WorkingDirectory $case -Prompt 'Preflight.'
    Assert-Equal $result.ExitCode 3 'Authentication preflight exit code mismatch.'
    $json = $result.Stdout | ConvertFrom-Json
    Assert-Equal $json.error.kind 'authentication_or_models' 'Authentication preflight error kind mismatch.'
    Assert-True ((Get-CallCount $case) -eq 2) 'Authentication failure reached the review command.'
    Complete-Test 'Authentication preflight failure'

    foreach ($versionScenario in @('versionFailure', 'unsupportedVersion', 'malformedVersion')) {
        $case = New-TestCase "version $versionScenario" $versionScenario
        $result = Invoke-WrapperChild -Provider grok -WorkingDirectory $case -Prompt 'Preflight.'
        Assert-Equal $result.ExitCode 3 "$versionScenario exit code mismatch."
        $json = $result.Stdout | ConvertFrom-Json
        Assert-True ($json.error.kind -in @('preflight', 'version')) "$versionScenario error kind mismatch."
        Assert-True ((Get-CallCount $case) -eq 1) "$versionScenario reached model or review calls."
        Complete-Test "$versionScenario version preflight failure"
    }

    $case = New-TestCase 'missing selected model' 'pass'
    $result = Invoke-WrapperChild -Provider grok -WorkingDirectory $case -Prompt 'Preflight.' -Model 'grok-not-installed'
    Assert-Equal $result.ExitCode 3 'Missing model exit code mismatch.'
    $json = $result.Stdout | ConvertFrom-Json
    Assert-Equal $json.error.kind 'model' 'Missing model error kind mismatch.'
    Assert-True ((Get-CallCount $case) -eq 2) 'Missing model reached the review command.'
    Complete-Test 'Selected model preflight failure'

    $case = New-TestCase 'non grok family' 'familyFailure'
    $result = Invoke-WrapperChild -Provider grok -WorkingDirectory $case -Prompt 'Preflight.'
    Assert-Equal $result.ExitCode 3 'Non-Grok family exit code mismatch.'
    $json = $result.Stdout | ConvertFrom-Json
    Assert-Equal $json.error.kind 'model' 'Non-Grok family error kind mismatch.'
    Assert-True ((Get-CallCount $case) -eq 2) 'Non-Grok family reached the review command.'
    Complete-Test 'Grok-family enforcement'

    $missingWorkingDirectory = Join-Path $testRoot 'missing working directory'
    $result = Invoke-WrapperChild -Provider grok -WorkingDirectory $missingWorkingDirectory -Prompt 'Reject missing workdir.'
    Assert-Equal $result.ExitCode 4 'Missing working directory exit code mismatch.'
    $json = $result.Stdout | ConvertFrom-Json
    Assert-Equal $json.error.kind 'wrapper' 'Missing working directory was misclassified as provider unavailable.'
    Complete-Test 'Missing working directory classification'

    $case = New-TestCase 'missing prompt file' 'pass'
    $missingPromptFile = Join-Path $case 'missing prompt.txt'
    $result = Invoke-WrapperChild -Provider grok -WorkingDirectory $case -PromptFile $missingPromptFile
    Assert-Equal $result.ExitCode 4 'Missing prompt file exit code mismatch.'
    $json = $result.Stdout | ConvertFrom-Json
    Assert-Equal $json.error.kind 'wrapper' 'Missing prompt file was misclassified as provider unavailable.'
    Assert-True ((Get-CallCount $case) -eq 0) 'Missing prompt file invoked the provider.'
    Complete-Test 'Missing prompt file classification'

    $case = New-TestCase 'transient retry' 'transientThenPass'
    $result = Invoke-WrapperChild -Provider grok -WorkingDirectory $case -Prompt 'Retry transient failures.'
    Assert-Equal $result.ExitCode 0 'Transient retry exit code mismatch.'
    $json = $result.Stdout | ConvertFrom-Json
    Assert-Equal $json.metadata.attempts 2 'Transient failure was not retried once.'
    Assert-True ((Get-CallCount $case) -eq 4) 'Transient retry call count mismatch.'
    Complete-Test 'Transient provider retry'

    $case = New-TestCase 'selected model' 'selectedModel'
    $result = Invoke-WrapperChild -Provider grok -WorkingDirectory $case -Prompt 'Use the selected model.' -Model 'grok-4-fast'
    Assert-Equal $result.ExitCode 0 'Selected model review exit code mismatch.'
    $json = $result.Stdout | ConvertFrom-Json
    Assert-Equal $json.metadata.model 'grok-4-fast' 'Selected model attestation mismatch.'
    $selectedModelArguments = Get-CallArguments @(Get-CallFiles $case)[2]
    Assert-True ($selectedModelArguments -contains '--model') 'Selected model flag was omitted.'
    Assert-True ($selectedModelArguments -contains 'grok-4-fast') 'Selected model value was omitted.'
    Complete-Test 'Selected model pinning and attestation'

    $case = New-TestCase 'explicit planning' 'payloadOnly'
    $taskSpecPath = New-TaskSpecFile $case
    $resultPath = Join-Path $case 'planning-result.json'
    $result = Invoke-WrapperChild -Provider grok -WorkingDirectory $case `
        -TaskSpecFile $taskSpecPath -CritiqueMode Planning `
        -AdvisorContextScript $script:fakeContextGeneratorPath `
        -ResultFile $resultPath
    Assert-Equal $result.ExitCode 0 "Planning exit code mismatch. stdout=[$($result.Stdout)] stderr=[$($result.Stderr)]"
    Assert-True ($utf8WithoutBom.GetByteCount($result.Stdout) -le 8192) 'Planning Summary exceeded 8192 bytes.'
    $summary = $result.Stdout | ConvertFrom-Json
    Assert-Equal $summary.critiqueMode 'Planning' 'Planning Summary mode mismatch.'
    Assert-Equal $summary.reviewStatus 'pass' 'Planning Summary status mismatch.'
    Assert-Equal $summary.resultFile $resultPath 'Planning Summary omitted the full-result path.'
    Assert-True (Test-Path -LiteralPath $taskSpecPath -PathType Leaf) `
        'Wrapper removed the caller-owned task specification.'
    Assert-StrictUtf8NoBomFile $resultPath 'Planning ResultFile'
    $full = [System.IO.File]::ReadAllText($resultPath, [System.Text.Encoding]::UTF8) |
        ConvertFrom-Json
    Assert-Equal $full.schemaVersion 2 'Planning full-result schema mismatch.'
    Assert-Equal $full.contextStatus 'sufficient' 'Planning contextStatus mismatch.'
    Assert-True (@($full.requestedContext).Count -eq 0) 'Planning sufficient result requested context.'
    Assert-True (@($full.evidence).Count -eq 1) 'Planning full result omitted evidence.'
    Assert-Equal $full.metadata.attemptCount 1 'Planning attempt count mismatch.'
    Assert-Equal $full.metadata.critiqueMode 'Planning' 'Planning metadata mode mismatch.'
    foreach ($hashName in @(
        'contextSha256', 'selectionSha256', 'repositoryFingerprint',
        'configFingerprint', 'promptSha256'
    )) {
        Assert-True ($full.metadata.$hashName -match '^[0-9a-f]{64}$') "Planning metadata omitted $hashName."
    }
    Assert-True ($full.metadata.byteCounts.taskSpec -gt 0) 'Planning task-spec byte count was omitted.'
    Assert-True ($full.metadata.byteCounts.context -gt 0) 'Planning context byte count was omitted.'
    Assert-True (@($full.metadata.attemptOutcomes).Count -eq 1) 'Planning attempt outcomes were omitted.'
    $reviewArguments = Get-CallArguments @(Get-CallFiles $case)[3]
    Assert-True ($reviewArguments -contains '--permission-mode') 'Payload-only permission mode was omitted.'
    Assert-True ($reviewArguments -contains 'dontAsk') 'Payload-only permission mode was not dontAsk.'
    Assert-True ($reviewArguments -contains '--tools') 'Payload-only empty tool surface was omitted.'
    Assert-True ($reviewArguments -contains '--deny') 'Payload-only deny policy was omitted.'
    Assert-True ($reviewArguments -contains '*') 'Payload-only deny-all value was omitted.'
    Assert-True ($reviewArguments -contains '--max-turns') 'Payload-only turn bound was omitted.'
    Assert-True ($reviewArguments -contains '1') 'Payload-only review was not one turn.'
    Assert-True (-not ($reviewArguments -contains $taskSpecPath)) 'Task specification path leaked into Grok argv.'
    $managedPromptPath = [System.IO.File]::ReadAllText(
        (Join-Path $case 'managed-prompt-path.txt'), [System.Text.Encoding]::UTF8
    )
    Assert-True (-not (Test-Path -LiteralPath $managedPromptPath)) 'Explicit managed prompt was not cleaned.'
    foreach ($artifactPath in [System.IO.File]::ReadAllLines(
        (Join-Path $case 'artifact-paths.txt'), [System.Text.Encoding]::UTF8
    )) {
        Assert-True (-not (Test-Path -LiteralPath $artifactPath)) 'Generated context artifact was not cleaned.'
    }
    Complete-Test 'Explicit Planning payload isolation, metadata, summary, result, and cleanup'

    $case = New-TestCase 'explicit mode rejects prompt' 'pass'
    $result = Invoke-WrapperChild -Provider grok -WorkingDirectory $case `
        -Prompt 'Free-form prompt is not a Planning task specification.' `
        -CritiqueMode Planning -AdvisorContextScript $script:fakeContextGeneratorPath `
        -OutputDetail Full
    Assert-Equal $result.ExitCode 4 'Planning accepted a free-form Prompt parameter set.'
    Assert-True ((Get-CallCount $case) -eq 0) 'Invalid Planning parameter set invoked Grok.'
    Complete-Test 'Explicit Planning requires TaskSpecFile'

    $case = New-TestCase 'explicit mode rejects agy' 'agy'
    $taskSpecPath = New-TaskSpecFile $case
    $result = Invoke-WrapperChild -Provider agy -WorkingDirectory $case `
        -TaskSpecFile $taskSpecPath -CritiqueMode FinalDiff `
        -AdvisorContextScript $script:fakeContextGeneratorPath -OutputDetail Full
    Assert-Equal $result.ExitCode 4 'FinalDiff accepted the agy compatibility provider.'
    Assert-True ((Get-CallCount $case) -eq 0) 'Invalid FinalDiff provider was invoked.'
    Complete-Test 'Explicit required modes reject non-Grok providers'

    $case = New-TestCase 'planning context expansion' 'planningContextRequest'
    $taskSpecPath = New-TaskSpecFile $case
    $resultPath = Join-Path $case 'expanded-result.json'
    $result = Invoke-WrapperChild -Provider grok -WorkingDirectory $case `
        -TaskSpecFile $taskSpecPath -CritiqueMode Planning -AllowContextExpansion `
        -AdvisorContextScript $script:fakeContextGeneratorPath -ResultFile $resultPath
    Assert-Equal $result.ExitCode 0 "Planning expansion failed. stdout=[$($result.Stdout)] stderr=[$($result.Stderr)]"
    $full = [System.IO.File]::ReadAllText($resultPath, [System.Text.Encoding]::UTF8) |
        ConvertFrom-Json
    Assert-Equal $full.contextStatus 'sufficient' 'Expanded Planning result did not complete.'
    Assert-Equal $full.metadata.attemptCount 2 'Context expansion did not consume exactly two attempts.'
    Assert-Equal ([int][System.IO.File]::ReadAllText(
        (Join-Path $case 'generator-counter.txt'), [System.Text.Encoding]::UTF8
    )) 3 'Context expansion plus post-review freshness verification did not use exactly three generator calls.'
    $secondGeneratorCall = Get-GeneratorCall $case 2
    Assert-True (-not [string]::IsNullOrWhiteSpace($secondGeneratorCall.contextExpansionRequestFile)) `
        'Context expansion was not passed through a host-side request file.'
    Assert-Matches $secondGeneratorCall.expansionRequestJson 'shared/example\.ts' `
        'Context expansion request file omitted the requested allowlisted path.'
    Assert-True (-not (Test-Path -LiteralPath $secondGeneratorCall.contextExpansionRequestFile)) `
        'Wrapper-owned context expansion request file was not cleaned.'
    Complete-Test 'Planning context request and one host-side rebundle'

    $case = New-TestCase 'compact summary full result' 'largeValidatedResult'
    $taskSpecPath = New-TaskSpecFile $case
    $changeSetPath = Join-Path $case 'change-set.json'
    [System.IO.File]::WriteAllText($changeSetPath, '["shared/example.ts"]', $utf8WithoutBom)
    $resultPath = Join-Path $case 'final-result.json'
    $result = Invoke-WrapperChild -Provider grok -WorkingDirectory $case `
        -TaskSpecFile $taskSpecPath -CritiqueMode FinalDiff `
        -ChangeSetFile $changeSetPath `
        -AdvisorContextScript $script:fakeContextGeneratorPath `
        -ResultFile $resultPath
    Assert-Equal $result.ExitCode 0 "FinalDiff summary/result failed. stdout=[$($result.Stdout)] stderr=[$($result.Stderr)]"
    $summaryBytes = $utf8WithoutBom.GetByteCount($result.Stdout)
    Assert-True ($summaryBytes -le 8192) 'FinalDiff compact Summary exceeded 8192 bytes.'
    $summary = $result.Stdout | ConvertFrom-Json
    Assert-Equal $summary.critiqueMode 'FinalDiff' 'FinalDiff Summary mode mismatch.'
    Assert-StrictUtf8NoBomFile $resultPath 'FinalDiff ResultFile'
    $fullBytes = [System.IO.File]::ReadAllBytes($resultPath)
    Assert-True ($fullBytes.Length -gt $summaryBytes) 'ResultFile did not retain more detail than Summary.'
    $full = $utf8WithoutBom.GetString($fullBytes) | ConvertFrom-Json
    Assert-True ($full.conclusion.Length -ge 20000) 'Full ResultFile truncated validated conclusion detail.'
    Assert-True (@($full.evidence).Count -eq 1) 'FinalDiff ResultFile omitted validated evidence.'
    $generatorCall = Get-GeneratorCall $case 1
    Assert-Equal $generatorCall.mode 'FinalDiff' 'Generator did not receive FinalDiff mode.'
    Assert-Equal $generatorCall.changeSetFile $changeSetPath 'Generator did not receive the exact change-set file.'
    Assert-Equal $generatorCall.maximumBundleBytes 262144 'Wrapper changed the 256 KiB generator cap.'
    Assert-Equal $generatorCall.maximumShardCount 6 'Wrapper changed the six-shard cap.'
    Complete-Test 'Compact Summary and complete strict-UTF8 ResultFile'

    foreach ($explicitFailure in @(
        @{ Scenario = 'planningContradiction'; Mode = 'Planning'; Kind = 'schema' },
        @{ Scenario = 'finalMissingEvidence'; Mode = 'FinalDiff'; Kind = 'semantic' },
        @{ Scenario = 'missingStructured'; Mode = 'FinalDiff'; Kind = 'structured_output' },
        @{ Scenario = 'toolAttempt'; Mode = 'FinalDiff'; Kind = 'tool_attempt' }
    )) {
        $case = New-TestCase "explicit reject $($explicitFailure.Scenario)" $explicitFailure.Scenario
        $taskSpecPath = New-TaskSpecFile $case
        $resultPath = Join-Path $case 'failure-result.json'
        $result = Invoke-WrapperChild -Provider grok -WorkingDirectory $case `
            -TaskSpecFile $taskSpecPath -CritiqueMode $explicitFailure.Mode `
            -AdvisorContextScript $script:fakeContextGeneratorPath `
            -ResultFile $resultPath -OutputDetail Full
        Assert-Equal $result.ExitCode 2 "$($explicitFailure.Scenario) exit code mismatch. stdout=[$($result.Stdout)] stderr=[$($result.Stderr)]"
        $json = $result.Stdout | ConvertFrom-Json
        Assert-Equal $json.error.kind $explicitFailure.Kind "$($explicitFailure.Scenario) kind mismatch."
        Assert-Equal $json.metadata.attemptCount 1 "$($explicitFailure.Scenario) was unexpectedly retried."
        Assert-True ((Get-CallCount $case) -eq 4) "$($explicitFailure.Scenario) made more than one provider attempt."
        Complete-Test "$($explicitFailure.Scenario) explicit deterministic no-retry"
    }

    foreach ($generatorFailure in @('hash', 'stale', 'coverage')) {
        $case = New-TestCase "generator $generatorFailure" "generator_$generatorFailure"
        $taskSpecPath = New-TaskSpecFile $case
        $result = Invoke-WrapperChild -Provider grok -WorkingDirectory $case `
            -TaskSpecFile $taskSpecPath -CritiqueMode FinalDiff `
            -AdvisorContextScript $script:fakeContextGeneratorPath -OutputDetail Full
        Assert-Equal $result.ExitCode 2 "$generatorFailure generator failure exit code mismatch."
        $json = $result.Stdout | ConvertFrom-Json
        $expectedKind = if ($generatorFailure -eq 'hash') {
            'context_digest'
        } elseif ($generatorFailure -eq 'stale') {
            'stale_context'
        } else { 'coverage' }
        Assert-Equal $json.error.kind $expectedKind "$generatorFailure generator failure kind mismatch."
        Assert-True ((Get-CallCount $case) -eq 0) "$generatorFailure generator failure invoked Grok."
        Assert-Equal ([int][System.IO.File]::ReadAllText(
            (Join-Path $case 'generator-counter.txt'), [System.Text.Encoding]::UTF8
        )) 1 "$generatorFailure generator failure was retried."
        Complete-Test "$generatorFailure context validation fails before Grok without retry"
    }

    foreach ($retryScenario in @('transientThenPass', 'malformedThenPass')) {
        $case = New-TestCase "explicit retry $retryScenario" $retryScenario
        $taskSpecPath = New-TaskSpecFile $case
        $result = Invoke-WrapperChild -Provider grok -WorkingDirectory $case `
            -TaskSpecFile $taskSpecPath -CritiqueMode FinalDiff `
            -AdvisorContextScript $script:fakeContextGeneratorPath -OutputDetail Full
        Assert-Equal $result.ExitCode 0 "$retryScenario explicit retry failed."
        $json = $result.Stdout | ConvertFrom-Json
        Assert-Equal $json.metadata.attemptCount 2 "$retryScenario did not use exactly two attempts."
        Assert-True ((Get-CallCount $case) -eq 5) "$retryScenario provider retry count mismatch."
        Assert-True (@($json.metadata.attemptOutcomes).Count -eq 2) "$retryScenario attempt outcomes were incomplete."
        Complete-Test "$retryScenario viable bounded retry"
    }

    $case = New-TestCase 'direct model fallback' 'directModelFallback'
    $taskSpecPath = New-TaskSpecFile $case
    $result = Invoke-WrapperChild -Provider grok -WorkingDirectory $case `
        -TaskSpecFile $taskSpecPath -CritiqueMode FinalDiff `
        -AdvisorContextScript $script:fakeContextGeneratorPath -OutputDetail Full
    Assert-Equal $result.ExitCode 0 'Direct Grok model fallback failed.'
    $json = $result.Stdout | ConvertFrom-Json
    Assert-Matches $json.metadata.model '^grok-' 'Direct Grok fallback metadata was not a grok-* model.'
    Assert-NotMatches $json.metadata.model '^ocx-' 'Required critique used an ocx-* model alias.'
    Complete-Test 'Direct Grok model fallback'

    $case = New-TestCase 'strict input caps' 'pass'
    $bomTaskSpecPath = Join-Path $case 'bom-task.json'
    [System.IO.File]::WriteAllBytes(
        $bomTaskSpecPath,
        [byte[]](0xef, 0xbb, 0xbf, 0x7b, 0x7d)
    )
    $result = Invoke-WrapperChild -Provider grok -WorkingDirectory $case `
        -TaskSpecFile $bomTaskSpecPath -CritiqueMode Planning `
        -AdvisorContextScript $script:fakeContextGeneratorPath -OutputDetail Full
    Assert-Equal $result.ExitCode 4 'UTF-8 BOM task specification was accepted.'
    Assert-True ((Get-CallCount $case) -eq 0) 'Invalid UTF-8 task specification invoked Grok.'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $case 'generator-counter.txt'))) `
        'Invalid UTF-8 task specification invoked the context generator.'

    $oversizeTaskSpecPath = Join-Path $case 'oversize-task.json'
    $oversizeBytes = New-Object byte[] 65537
    [System.IO.File]::WriteAllBytes($oversizeTaskSpecPath, $oversizeBytes)
    $result = Invoke-WrapperChild -Provider grok -WorkingDirectory $case `
        -TaskSpecFile $oversizeTaskSpecPath -CritiqueMode FinalDiff `
        -AdvisorContextScript $script:fakeContextGeneratorPath -OutputDetail Full
    Assert-Equal $result.ExitCode 4 'Oversize task specification was accepted.'
    Assert-True ((Get-CallCount $case) -eq 0) 'Oversize task specification invoked Grok.'
    Complete-Test 'Strict UTF-8 and 64 KiB task-spec cap'

    $case = New-TestCase 'streaming output cap' 'streamingOutputLimit'
    $taskSpecPath = New-TaskSpecFile $case
    $result = Invoke-WrapperChild -Provider grok -WorkingDirectory $case `
        -TaskSpecFile $taskSpecPath -CritiqueMode FinalDiff `
        -AdvisorContextScript $script:fakeContextGeneratorPath -OutputDetail Full
    Assert-Equal $result.ExitCode 2 'Provider stdout cap failure exit code mismatch.'
    $json = $result.Stdout | ConvertFrom-Json
    Assert-Equal $json.error.kind 'output_limit' 'Provider stdout cap failure kind mismatch.'
    Assert-Equal $json.metadata.attemptCount 1 'Provider stdout cap failure was retried.'
    Assert-True ($utf8WithoutBom.GetByteCount($result.Stdout) -lt 1048576) `
        'Wrapper emitted provider overflow output.'
    Complete-Test 'Streaming provider output cap fails closed without retry'

    $case = New-TestCase 'bounded timeout' 'timeout'
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $result = Invoke-WrapperChild -Provider grok -WorkingDirectory $case -Prompt 'Bound the timeout.' -TimeoutSeconds 1
    $stopwatch.Stop()
    Assert-Equal $result.ExitCode 3 'Timeout exit code mismatch.'
    $json = $result.Stdout | ConvertFrom-Json
    Assert-Equal $json.error.kind 'timeout' 'Timeout error kind mismatch.'
    Assert-True ($stopwatch.Elapsed.TotalSeconds -lt 8) 'The one-second wrapper timeout was not bounded.'
    Complete-Test 'Bounded timeout and process termination'

    $case = New-TestCase 'utf8 prompt and quoted paths' 'validatePrompt'
    $callerPromptPath = Join-Path $case 'caller prompt with spaces.txt'
    $koreanMarker = -join @(
        [char]0xd55c, [char]0xae00, [char]0x20,
        [char]0xd504, [char]0xb86c, [char]0xd504, [char]0xd2b8
    )
    $largePrompt = "$koreanMarker`r`n" + ('large review payload ' * 6500)
    [System.IO.File]::WriteAllText($callerPromptPath, $largePrompt, $utf8WithoutBom)
    $result = Invoke-WrapperChild -Provider grok -WorkingDirectory $case -PromptFile $callerPromptPath
    Assert-Equal $result.ExitCode 0 'UTF-8 prompt-file exit code mismatch.'
    Assert-True (Test-Path -LiteralPath $callerPromptPath -PathType Leaf) 'The caller-owned prompt file was removed.'
    $managedPromptPath = [System.IO.File]::ReadAllText((Join-Path $case 'managed-prompt-path.txt'), [System.Text.Encoding]::UTF8)
    Assert-True (-not (Test-Path -LiteralPath $managedPromptPath)) 'The managed prompt file was not cleaned up.'
    $reviewArguments = Get-CallArguments @(Get-CallFiles $case)[2]
    Assert-True ($reviewArguments -contains $managedPromptPath) 'The managed prompt path was not passed as one native argument.'
    Complete-Test 'UTF-8 large prompt, quoting, and prompt cleanup'

    $case = New-TestCase 'dry run' 'pass'
    $dryPromptPath = Join-Path $case 'private prompt.txt'
    $drySecret = 'PROMPT_MUST_NOT_APPEAR_42'
    [System.IO.File]::WriteAllText($dryPromptPath, $drySecret, $utf8WithoutBom)
    $result = Invoke-WrapperChild -Provider grok -WorkingDirectory $case -PromptFile $dryPromptPath -DryRun
    Assert-Equal $result.ExitCode 0 'Dry-run exit code mismatch.'
    Assert-True ((Get-CallCount $case) -eq 0) 'Dry-run executed the provider.'
    Assert-NotMatches $result.Stdout $drySecret 'Dry-run leaked prompt content.'
    $json = $result.Stdout | ConvertFrom-Json
    Assert-True ($json.arguments[-1] -eq '<managed-temporary-utf8-prompt-file>') 'Dry-run exposed a real managed prompt path.'
    Assert-True ($json.promptSha256 -match '^[0-9a-f]{64}$') 'Dry-run omitted the prompt digest.'
    Complete-Test 'Dry-run isolation and prompt privacy'

    $case = New-TestCase 'secret redaction' 'secretFailure'
    $result = Invoke-WrapperChild -Provider grok -WorkingDirectory $case -Prompt 'Redact provider failures.'
    Assert-Equal $result.ExitCode 3 'Secret failure exit code mismatch.'
    $combined = "$($result.Stdout)`n$($result.Stderr)"
    Assert-NotMatches $combined 'abcdefghijklmnop|supersecret123|anothersecret' 'Provider secrets were exposed.'
    Assert-Matches $combined 'Grok review process failed' 'Provider failure was not reduced to a safe generic message.'
    Complete-Test 'Secret redaction'

    $case = New-TestCase 'diagnostic alias' 'diagnostic'
    $result = Invoke-WrapperChild -Provider grok -WorkingDirectory $case -Prompt 'Check connectivity.' -UseDiagnosticAlias
    Assert-Equal $result.ExitCode 0 'Diagnostic mode exit code mismatch.'
    $json = $result.Stdout | ConvertFrom-Json
    Assert-Equal $json.mode 'diagnostic' 'Diagnostic mode was presented as a review.'
    Assert-Equal $json.reviewStatus 'diagnostic' 'Diagnostic status could be mistaken for review pass.'
    Assert-Matches $json.conclusion 'not a valid critique' 'Diagnostic result omitted its review disclaimer.'
    Complete-Test 'Diagnostic mode cannot count as review'

    $case = New-TestCase 'agy unchanged' 'agy'
    $result = Invoke-WrapperChild -Provider agy -WorkingDirectory $case -Prompt 'Review with agy.'
    Assert-Equal $result.ExitCode 0 'agy exit code mismatch.'
    Assert-Equal $result.Stdout 'AGY_OK' 'agy output was not passed through.'
    Assert-True ((Get-CallCount $case) -eq 1) 'agy unexpectedly ran Grok preflights.'
    $agyArguments = Get-CallArguments @(Get-CallFiles $case)[0]
    Assert-True ($agyArguments -contains '--sandbox') 'agy sandbox argument was omitted.'
    Assert-True ($agyArguments -contains '--print') 'agy prompt argument was omitted.'
    Complete-Test 'agy compatibility'

    $case = New-TestCase 'agy dry run privacy' 'agy'
    $agySecret = 'AGY_PROMPT_MUST_NOT_APPEAR_42'
    $result = Invoke-WrapperChild -Provider agy -WorkingDirectory $case -Prompt $agySecret -DryRun
    Assert-Equal $result.ExitCode 0 'agy dry-run exit code mismatch.'
    Assert-True ((Get-CallCount $case) -eq 0) 'agy dry-run executed the provider.'
    Assert-NotMatches $result.Stdout $agySecret 'agy dry-run leaked prompt content.'
    $json = $result.Stdout | ConvertFrom-Json
    Assert-True ($json.arguments[-1] -eq '<redacted-advisory-prompt>') 'agy dry-run omitted its prompt placeholder.'
    Assert-True ($json.promptSha256 -match '^[0-9a-f]{64}$') 'agy dry-run omitted the prompt digest.'
    Complete-Test 'agy dry-run prompt privacy'

    $case = New-TestCase 'agy truncation' 'agyTruncated'
    $result = Invoke-WrapperChild -Provider agy -WorkingDirectory $case -Prompt 'Reject truncated agy output.'
    Assert-Equal $result.ExitCode 4 'agy truncation exit code mismatch.'
    Assert-True ([string]::IsNullOrEmpty($result.Stdout)) 'agy emitted truncated stdout before failing.'
    Assert-Matches $result.Stderr 'bounded capture limit' 'agy truncation failure was not reported.'
    Complete-Test 'agy truncation fails closed'

    Write-Host "All $script:passed invoke-advisor tests passed under $($PSVersionTable.PSEdition) $($PSVersionTable.PSVersion)."
} finally {
    if (Test-Path -LiteralPath $testRoot) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
