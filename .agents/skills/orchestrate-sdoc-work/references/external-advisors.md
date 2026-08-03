# External advisor policy

Use Grok and agy as independent reviewers, not as autonomous implementers in
the shared working tree.

## Routing

- Prefer native Codex agents for repository exploration, edits, tests, and
  follow-up steering.
- Use Grok CLI after local verification and final-diff inspection for every
  material implementation and substantive repository verification. This is the
  default critical-review step and does not require an explicit user request.
- Use agy or another external advisor only after an explicit request for that
  provider or additional cross-model validation.
- Choose a provider and model from observed local evaluations. Discover current
  choices with `grok models` or `agy models`; do not hardcode a model name in
  the project. For the required Grok critique, confirm that the selected model
  is a Grok-family model rather than silently routing to another provider.
- Give the advisor one bounded question. Include the final diff or exact
  relevant paths, requirements, acceptance criteria, and local test evidence,
  but omit secrets, credentials, unrelated source or proprietary content,
  personal information, customer data, and sensitive logs.
- Ask Grok to challenge assumptions, identify counterexamples, regressions,
  security or data-loss risks, and missing tests rather than duplicating the
  main agent's implementation work.

## Invocation

For a short prompt, run from the repository root:

```powershell
powershell.exe -NoProfile -File .agents/skills/orchestrate-sdoc-work/scripts/invoke-advisor.ps1 `
  -Provider grok `
  -Prompt "Review the book composition boundary for data-loss risks." `
  -WorkingDirectory $PWD
```

Never put a full diff or another long review payload in `-Prompt`, an inline
PowerShell command, or a native process argument. Write it as UTF-8 without BOM
to an OS temporary file, pass only its path, and delete that caller-owned file:

```powershell
$reviewPromptPath = Join-Path ([System.IO.Path]::GetTempPath()) (
  'sdoc-review-{0}.txt' -f [System.Guid]::NewGuid().ToString('N')
)
try {
  [System.IO.File]::WriteAllText(
    $reviewPromptPath,
    $reviewPrompt,
    [System.Text.UTF8Encoding]::new($false)
  )
  powershell.exe -NoProfile -File .agents/skills/orchestrate-sdoc-work/scripts/invoke-advisor.ps1 `
    -Provider grok `
    -PromptFile $reviewPromptPath `
    -WorkingDirectory $PWD
} finally {
  Remove-Item -LiteralPath $reviewPromptPath -Force -ErrorAction SilentlyContinue
}
```

Replace `grok` with `agy` as needed. Pass `-Model` only when the user selected a
model or a maintained evaluation identifies a clear winner. The wrapper applies
`-TimeoutSeconds` to both providers and stops the process tree on expiry. Give
the surrounding shell call its own finite timeout as a second guard. Use
`-DryRun` to inspect the generated command without calling the external model.

The wrapper uses plan or sandbox mode, asks for no file changes, and disables
nested Grok agents. These are safeguards, not proof. Inspect `git status` after
every external invocation. For Grok, the wrapper copies the complete advisory
prompt to its own managed temporary UTF-8 file, passes it with `--prompt-file`,
and deletes it in `finally`.

Grok report validation is enabled by default. Exit code 0 alone does not prove
that a review occurred. An acknowledgement such as “I will review” or an intent
statement without both an explicit conclusion and findings (or the explicit
`NO_ACTIONABLE_FINDINGS` result) is incomplete, must be retried, and must not
count. `-AllowIncompleteResponse` is reserved for connectivity diagnostics and
must never be used for a required critique.

Required reports use the ASCII `Conclusion` and `Findings` headings so the
PowerShell 5.1 wrapper can validate them without locale-dependent script
encoding. `NO_ACTIONABLE_FINDINGS` is the complete no-findings alternative.

The `-PromptFile` path also keeps a long task off the wrapper's own command
line for agy, but agy still receives the advisory text through its native
`--print` process argument. Keep agy prompts short unless its CLI gains an
equivalent file-input mode; the Grok large-diff guarantee does not apply to agy.

Run Grok only after the integrated change and local checks are stable. If a
review finding leads to a material change in a reviewed file, rerun the Grok
critique on the updated final diff. If the CLI is unavailable, unauthenticated,
times out, or cannot be safely given the necessary context, state that the Grok
critique is missing and report the residual risk; do not claim or imply review.

## Evaluation

Score the response on repository-grounded correctness, useful file references,
novel risks, false positives, latency, and cost. Verify adopted claims against
source and tests. Explicitly accept or reject actionable findings with that
evidence. Never describe an external response as consensus merely because it
agrees with the main agent.
