# External advisor policy

Use Grok and agy as independent reviewers, not as autonomous implementers in
the shared working tree.

## Routing

- Prefer native Codex agents for repository exploration, edits, tests, and
  follow-up steering.
- Use an external advisor only after an explicit request for Grok, agy, another
  model, or cross-model validation.
- Choose a provider and model from observed local evaluations. Discover current
  choices with `grok models` or `agy models`; do not hardcode a model name in
  the project.
- Give the advisor one bounded question. Include relevant paths and acceptance
  criteria, but omit unrelated files and secrets.
- Request alternatives, counterexamples, or risks rather than duplicating a
  native agent's implementation work.

## Invocation

From the repository root, run:

```powershell
powershell.exe -NoProfile -File .agents/skills/orchestrate-sdoc-work/scripts/invoke-advisor.ps1 `
  -Provider grok `
  -Prompt "Review the book composition boundary for data-loss risks." `
  -WorkingDirectory $PWD
```

Replace `grok` with `agy` as needed. Pass `-Model` only when the user selected a
model or a maintained evaluation identifies a clear winner. The wrapper applies
`-TimeoutSeconds` to both providers and stops the process tree on expiry. Give
the surrounding shell call its own finite timeout as a second guard. Use
`-DryRun` to inspect the generated command without calling the external model.

The wrapper uses plan or sandbox mode, asks for no file changes, and disables
nested Grok agents. These are safeguards, not proof. Inspect `git status` after
every external invocation.

## Evaluation

Score the response on repository-grounded correctness, useful file references,
novel risks, false positives, latency, and cost. Verify adopted claims against
source and tests. Never describe an external response as consensus merely
because it agrees with the main agent.
