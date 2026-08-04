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
| Final diff | After integration and applicable local checks are stable; provide the bounded final diff, requirements, acceptance criteria, and relevant test evidence | Regressions, counterexamples, security or data-loss risk, host-parity gaps, and missing tests | A plan essay unless needed to explain intent |

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
every external invocation. For Grok, the wrapper performs an authenticated
model preflight, copies each attempt's complete advisory prompt to its own
managed temporary UTF-8 file, passes it with `--prompt-file`, and deletes it in
`finally`. Scripted calls disable CLI auto-update so one review uses one stable
binary. Grok's interactive planning feature is disabled for these one-shot
reviews while the read-only `plan` permission mode remains enforced. Structured
reviews require Grok CLI 0.2.118 or newer.

Grok report validation is enabled by default. The CLI is constrained with JSON
Schema, and the wrapper exposes its own `schemaVersion: 1` result rather than
raw Grok thought or session data. A review is complete only when
`reviewStatus` is `pass` or `changes_required` and the semantic evidence and
finding invariants pass. Exit code 0 alone, acknowledgement text, empty or
contradictory results, and `incomplete`, `unavailable`, or `diagnostic` statuses
do not prove review and must not count.

The default Grok output is JSON. `-OutputFormat Text` renders a validated result
with ASCII `Conclusion` and `Findings` headings and may display
`NO_ACTIONABLE_FINDINGS`, but those strings are compatibility presentation, not
the validation contract. `-DiagnosticMode` and its deprecated
`-AllowIncompleteResponse` alias are connectivity diagnostics only and must
never be used for a required critique.

The wrapper retries only bounded, plausibly transient failures within one
overall timeout. Authentication, model-selection, argument, and deterministic
schema errors fail immediately. Completed `pass` and `changes_required` reviews
exit 0; incomplete protocol results exit 2, unavailable provider results exit
3, and wrapper errors exit 4. Findings remain advisory even when the wrapper
completed successfully.

The `-PromptFile` path also keeps a long task off the wrapper's own command
line for agy, but agy still receives the advisory text through its native
`--print` process argument. Keep agy prompts short unless its CLI gains an
equivalent file-input mode; the Grok large-diff guarantee does not apply to agy.

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
