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
        [string]$OutputFormat,
        [string]$Model,
        [int]$TimeoutSeconds = 8,
        [switch]$DryRun,
        [switch]$DiagnosticMode,
        [switch]$UseDiagnosticAlias
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
    if (-not [string]::IsNullOrEmpty($PromptFile)) {
        $arguments += @('-PromptFile', $PromptFile)
    } else {
        $arguments += @('-Prompt', $Prompt)
    }
    if (-not [string]::IsNullOrEmpty($OutputFormat)) { $arguments += @('-OutputFormat', $OutputFormat) }
    if (-not [string]::IsNullOrEmpty($Model)) { $arguments += @('-Model', $Model) }
    if ($DryRun) { $arguments += '-DryRun' }
    if ($DiagnosticMode) { $arguments += '-DiagnosticMode' }
    if ($UseDiagnosticAlias) { $arguments += '-AllowIncompleteResponse' }

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
            Console.WriteLine("Default model: grok-4\n- grok-4\n- grok-4-fast");
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

        int reviewAttempt = call - 2;
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
        if (scenario == "selectedModel")
        {
            if (ArgumentAfter(args, "--model") != "grok-4-fast") return Fail("selected model was not pinned");
            Console.WriteLine(PassEnvelope.Replace("\"grok-4\"", "\"grok-4-fast\""));
            return 0;
        }
        if (scenario == "findings") Console.WriteLine(FindingsEnvelope);
        else Console.WriteLine(PassEnvelope);
        return 0;
    }
}
'@

try {
    $sourceBytes = [System.IO.File]::ReadAllBytes($MyInvocation.MyCommand.Path)
    Assert-True (@($sourceBytes | Where-Object { $_ -gt 0x7f }).Count -eq 0) 'The harness source must remain ASCII-only for Windows PowerShell 5.1.'
    [System.IO.Directory]::CreateDirectory($testRoot) | Out-Null
    $providerDirectory = Join-Path $testRoot 'fake provider with spaces'
    [System.IO.Directory]::CreateDirectory($providerDirectory) | Out-Null
    $sourcePath = Join-Path $providerDirectory 'FakeProvider.cs'
    $script:fakeProviderPath = Join-Path $providerDirectory 'fake grok provider.exe'
    [System.IO.File]::WriteAllText($sourcePath, $fakeProviderSource, $utf8WithoutBom)

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
