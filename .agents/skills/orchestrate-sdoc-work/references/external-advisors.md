# External advisor policy

Use Grok and agy as independent reviewers, not as autonomous implementers in
the shared working tree.

## Routing

- Prefer native Codex agents for repository exploration, edits, tests, and
  follow-up steering.
- Use Grok CLI in two independent modes. Planning critique challenges a
  judgment-material approach before implementation. Final-diff critique checks
  every material implementation and substantive repository verification after
  local checks. Neither mode replaces the other when both triggers apply, and
  neither requires an explicit user request.
- Use planning critique for persistence, schema, migration, security, data-loss,
  cross-host behavior, UX interaction models, ADR-level architecture, product
  interpretation, and material scope or direction changes. Skip it for typo or
  wording polish, version and release mechanics, pure renames, routine dependency
  changes without behavior impact, verification-only work whose direction is
  settled, and clear single-cause fixes without product or architecture judgment.
- Use agy or another external advisor only after an explicit request for that
  provider or additional cross-model validation.
- Choose a provider and model from observed local evaluations. Discover current
  choices with `grok models` or `agy models`; do not hardcode a model name in
  the project. For the required direct Grok critique, use an available official
  `grok-*` model and confirm the response attests that model (the CLI may append
  its observed `-build` runtime suffix). Do not route the required critique
  through an `ocx-*` alias or another provider.
- Give the advisor one bounded question using the mode-specific context below,
  but omit secrets, credentials, unrelated source or proprietary content,
  personal information, customer data, and sensitive logs.
- Ask Grok to challenge assumptions and identify counterexamples, simpler
  alternatives, regressions, security or data-loss risks, and missing tests
  rather than duplicating the main agent's work or merely agreeing with it.

## Critique modes

| Mode | Timing and inputs | Ask Grok for | Not required |
| --- | --- | --- | --- |
| Planning | Before the first judgment-material write; provide the goal, proposed approach, considered alternatives, assumptions, affected UX/host/persistence/security surfaces, and open questions | Adversarial questions, false assumptions, counterexamples, simpler alternatives, missing constraints, and wrong-direction risk | A full diff or test logs |
| Final diff | After integration and applicable local checks are stable; provide a task specification with requirements, acceptance criteria, relevant test evidence, and an explicit change set when needed; the generator supplies the exact diff | Regressions, counterexamples, security or data-loss risk, host-parity gaps, and missing tests | A manually assembled diff or plan essay |

Required reviews use the explicit `Planning` and `FinalDiff` contracts. The
default `Legacy` contract exists only for compatibility and cannot satisfy a
required critique. Planning results additionally carry `contextStatus` and
`requestedContext`. A Planning result may request allowlisted repository paths;
when expansion is enabled, the host-side generator rebuilds the payload once.
Grok never receives a repository reader, shell, web search, subagent, or other
tool for context discovery. Final-diff results must satisfy stricter evidence
invariants tying claims and findings to the generated change evidence.

The main agent remains the decision owner. Grok is not an approval gate, veto,
or source of consensus. Challenge execution risks and assumptions within the
user's explicit constraints; do not use Grok to renegotiate a product decision
the user has already fixed unless the user asks for alternatives.

Disposition planning findings with explicit rationale, and update the public
issue or working plan when the decision is product-facing. Disposition final
findings with repository and test evidence. A native architecture review and a
Grok planning critique are complementary: the former develops repo-grounded
design, while the latter independently challenges the chosen direction.

## Invocation

For a compatibility-only short prompt, run from the repository root:

```powershell
powershell.exe -NoProfile -File .agents/skills/orchestrate-sdoc-work/scripts/invoke-advisor.ps1 `
  -Provider grok `
  -Prompt "Review the book composition boundary for data-loss risks." `
  -WorkingDirectory $PWD
```

Do not copy a full diff or repository bundle into agent conversation context,
`-Prompt`, an inline PowerShell command, or a native process argument. For a
required critique, write only the small structured task specification as strict
UTF-8 without BOM. Pass it to the wrapper with an explicit mode and a result
path. The wrapper calls the context generator, which selects the exact diff and
canonical repository inputs, verifies integrity and selection coverage, creates
the bounded ephemeral bundle, and removes its managed files:

```powershell
$taskSpecPath = Join-Path ([System.IO.Path]::GetTempPath()) (
  'sdoc-review-task-{0}.json' -f [System.Guid]::NewGuid().ToString('N')
)
$resultPath = Join-Path ([System.IO.Path]::GetTempPath()) (
  'sdoc-review-result-{0}.json' -f [System.Guid]::NewGuid().ToString('N')
)
try {
  [System.IO.File]::WriteAllText(
    $taskSpecPath,
    $taskSpecJson,
    [System.Text.UTF8Encoding]::new($false)
  )
  powershell.exe -NoProfile -File .agents/skills/orchestrate-sdoc-work/scripts/invoke-advisor.ps1 `
    -Provider grok `
    -CritiqueMode Planning `
    -TaskSpecFile $taskSpecPath `
    -ResultFile $resultPath `
    -OutputDetail Summary `
    -WorkingDirectory $PWD

  if ($LASTEXITCODE -ne 0) {
    throw "Grok planning critique failed with exit code $LASTEXITCODE."
  }
  $review = Get-Content -LiteralPath $resultPath -Raw -Encoding UTF8 |
    ConvertFrom-Json
} finally {
  Remove-Item -LiteralPath $taskSpecPath, $resultPath `
    -Force -ErrorAction SilentlyContinue
}
```

Use the corresponding required invocation after integration and stable local
checks:

```powershell
powershell.exe -NoProfile -File .agents/skills/orchestrate-sdoc-work/scripts/invoke-advisor.ps1 `
  -Provider grok `
  -CritiqueMode FinalDiff `
  -TaskSpecFile $taskSpecPath `
  -ResultFile $resultPath `
  -OutputDetail Summary `
  -WorkingDirectory $PWD
```

Supply `-ChangeSetFile` whenever the task contains untracked files or the worktree
contains unrelated changes; the generator fails closed rather than guessing that
scope. Otherwise `-BaseRef` may select the tracked Git comparison. Do not assemble
or paste the diff yourself. Use
`-AllowContextExpansion` only for Planning when one host-side rebundle is
acceptable. Pass `-Model` only when the user selected a model or a maintained
evaluation identifies a clear winner. Required modes support Grok only; agy and
other providers remain Legacy compatibility surfaces. The wrapper applies
`-TimeoutSeconds` and stops the process tree on expiry. Give the surrounding
shell call its own finite timeout as a second guard. Use `-DryRun` to inspect
the generated command without calling the external model.

The required Grok invocation is payload-only: permission prompts are denied,
the tool surface is empty, terminal/repository reads and nested agents are
disallowed, web search and memory are disabled, and the review is limited to
one turn. These are defense in depth around a host-assembled payload. Inspect
`git status` after every external invocation. The wrapper performs an
authenticated model preflight, copies each attempt's complete advisory payload
to its own managed temporary UTF-8 file, passes only that path with
`--prompt-file`, and deletes it in `finally`. Scripted calls disable CLI
auto-update so one review uses one stable binary. Structured reviews require
Grok CLI 0.2.118 or newer.

Grok report validation is enabled by default. Explicit reviews use separate
Planning and FinalDiff JSON Schemas, and the wrapper exposes its own versioned
result rather than raw Grok thought or session data. A review is complete only
when `reviewStatus` is `pass` or `changes_required` and the mode-specific
semantic evidence and finding invariants pass. Exit code 0 alone,
acknowledgement text, empty or contradictory results, and `incomplete`,
`unavailable`, or `diagnostic` statuses do not prove review and must not count.
The result metadata records selected-input hashes, selection-coverage status,
configuration fingerprint, mode, model, byte counts, and per-attempt outcomes;
it does not treat ambient dirty state as the repository fingerprint.

Explicit reviews default to compact `Summary` stdout, capped independently from
provider output. `-ResultFile` receives the complete validated JSON as strict
UTF-8 without BOM; use `-OutputDetail Full` only when full stdout is actually
needed. Summary contains only compact status and finding titles and is not
enough to disposition evidence; read the caller-owned ResultFile, use its full
evidence/findings, then delete it in `finally`. Legacy `-OutputFormat Text`
headings and `NO_ACTIONABLE_FINDINGS` are
compatibility presentation, not the validation contract. `-DiagnosticMode` and
its deprecated `-AllowIncompleteResponse` alias are connectivity diagnostics
only and must never be used for a required critique.

The wrapper retries only bounded, plausibly transient provider or early
protocol failures within one overall timeout. Tool or permission attempts,
missing final structured output, hash mismatch, stale bundle, selection
coverage failure, authentication, model selection, argument, schema, and
semantic invariant failures are deterministic and never retry. Completed
`pass` and `changes_required` reviews exit 0; incomplete protocol results exit
2, unavailable provider results exit 3, and wrapper/configuration errors exit
4. Findings remain advisory even when the wrapper completed successfully.

The `-PromptFile` path also keeps a long task off the wrapper's own command
line for agy, but agy still receives the advisory text through its native
`--print` process argument. Keep agy prompts short unless its CLI gains an
equivalent file-input mode; the Grok large-diff guarantee does not apply to agy.

Task specifications and caller change-set files are accepted only as strict
UTF-8 without BOM. Task input is capped at 64 KiB; the generator is called with
a 256 KiB total bundle cap and at most six concern shards. Provider stdout is
stream-capped at 1 MiB, provider stderr at 128 KiB, compact Summary stdout at
8 KiB, and a full result file at 1 MiB. Oversize, invalid encoding, hash,
stale-input, and coverage failures fail closed. Caller-owned task/change/result
files remain the caller's cleanup responsibility; every wrapper- or
generator-owned temporary payload is removed after success, failure, timeout,
and retry.

Run planning critique before the decision is implemented. One planning critique
per decision boundary is normally sufficient; repeat it only when scope, UX,
architecture, persistence, security, or cross-host direction changes materially.
Run final-diff critique only after the integrated change and local checks are
stable. If a final finding leads to a material change in a reviewed file, rerun
the final critique on the updated diff. If the CLI is unavailable,
unauthenticated, times out, or cannot be safely given the necessary context,
state which critique is missing and report the residual risk; do not claim or
imply review.

## Evaluation

Score the response on correctness, useful evidence, novel risks, false
positives, latency, and cost. Verify final-diff claims against source and tests;
evaluate planning claims against requirements, repository constraints, and
explicit reasoning. Explicitly accept or reject actionable findings. Never
describe an external response as consensus merely because it agrees with the
main agent.
