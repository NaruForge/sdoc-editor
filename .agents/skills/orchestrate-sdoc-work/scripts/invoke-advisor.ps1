[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('grok', 'agy')]
    [string]$Provider,

    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$Prompt,

    [string]$WorkingDirectory = (Get-Location).Path,

    [string]$Model,

    [ValidateRange(30, 1800)]
    [int]$TimeoutSeconds = 300,

    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

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

$resolvedDirectory = (Resolve-Path -LiteralPath $WorkingDirectory).Path
$command = Get-Command $Provider -CommandType Application -ErrorAction Stop |
    Select-Object -First 1

$advisoryPrompt = @"
Act as a read-only advisory reviewer. Do not modify files, create commits,
change configuration, or invoke other agents. Inspect only the repository
content needed for the task. Return a concise conclusion, confidence, evidence
with file and line references, risks, assumptions, and recommended next action.

Task:
$Prompt
"@

$arguments = if ($Provider -eq 'grok') {
    @(
        '--cwd', $resolvedDirectory,
        '--permission-mode', 'plan',
        '--no-subagents',
        '--no-memory',
        '--disable-web-search',
        '--max-turns', '8',
        '--output-format', 'plain'
    ) + $(if ($Model) { @('--model', $Model) } else { @() }) +
        @('--single', $advisoryPrompt)
} else {
    @(
        '--mode', 'plan',
        '--sandbox',
        '--print-timeout', "${TimeoutSeconds}s"
    ) + $(if ($Model) { @('--model', $Model) } else { @() }) +
        @('--print', $advisoryPrompt)
}

$nativeArguments = ($arguments | ForEach-Object {
    ConvertTo-NativeArgument -Value $_
}) -join ' '

if ($DryRun) {
    [pscustomobject]@{
        provider = $Provider
        executable = $command.Source
        workingDirectory = $resolvedDirectory
        arguments = $arguments
        nativeArguments = $nativeArguments
    } | ConvertTo-Json -Depth 3
    return
}

$startInfo = [System.Diagnostics.ProcessStartInfo]::new()
$startInfo.FileName = $command.Source
$startInfo.Arguments = $nativeArguments
$startInfo.WorkingDirectory = $resolvedDirectory
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true
$startInfo.RedirectStandardOutput = $true
$startInfo.RedirectStandardError = $true

$process = [System.Diagnostics.Process]::new()
$process.StartInfo = $startInfo
try {
    if (-not $process.Start()) {
        throw "Failed to start $Provider."
    }

    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()

    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
        $processId = $process.Id
        & taskkill.exe /PID $processId /T /F 2>$null | Out-Null
        throw "$Provider exceeded the ${TimeoutSeconds}s timeout and was stopped."
    }

    $process.WaitForExit()
    $stdout = $stdoutTask.Result
    $stderr = $stderrTask.Result
    $exitCode = $process.ExitCode

    if ($stdout) {
        Write-Output $stdout.TrimEnd()
    }
    if ($stderr) {
        [Console]::Error.Write($stderr)
    }
    if ($exitCode -ne 0) {
        throw "$Provider exited with code $exitCode."
    }
} finally {
    $process.Dispose()
}
