---
name: orchestrate-sdoc-work
description: Coordinate bounded multi-agent work and its required Grok CLI critique for Structured Doc Editor across the VS Code host, Tauri host, shared core, tests, and documentation. Use when a task explicitly requests subagents, delegation, parallel work, Grok or agy review, or when a complex change has at least two independent exploration, implementation, verification, or review workstreams.
---

# Orchestrate SDOC Work

Keep the main agent focused on requirements, decisions, integration, and final
verification. Delegate only bounded work that can proceed independently.

## Workflow

1. Read `AGENTS.md`, `docs/architecture.md`, applicable nested instructions,
   and `git status` before dividing work. Preserve unrelated changes.
2. Keep the task in the main agent when it is a small edit, single-cause
   diagnosis, or tightly coupled change. Delegate only when two or more streams
   can return useful results independently.
3. Write a short task map. For every delegated stream define its goal, allowed
   files, read/write mode, constraints, evidence to return, and completion test.
4. Before the first judgment-material write, use Grok CLI as an independent
   planning critic when the work involves product interpretation, UX interaction
   choices, architecture, persistence, security or data-loss risk, cross-host
   behavior, or another consequential assumption. Give it the proposed plan,
   alternatives, assumptions, affected surfaces, and open questions; ask it to
   find counterexamples, simpler approaches, and wrong-direction risk. Skip this
   checkpoint for mechanical work and clear single-cause fixes.
5. Prefer parallel exploration, architecture review, test analysis, and diff
   review. Partition implementation by non-overlapping files or execute it
   sequentially. A native architect supplies repository-grounded design help;
   Grok independently challenges the chosen plan and does not replace it.
6. Wait for required results, verify claims against the repository, resolve
   conflicts, and integrate centrally. Never accept a worker summary as proof
   when source or test evidence is available.
7. Run the applicable commands from `AGENTS.md`, inspect the final diff, and
   invoke the Grok CLI for an independent critical review of every material
   implementation or substantive repository verification. Put full diffs and
   other long payloads in an OS temporary UTF-8 file and call the wrapper with
   `-PromptFile`; never place them in shell arguments. Grok report validation
   is enabled by default. Planning critique does not satisfy this final-diff
   critique; both are required when their triggers fire.
8. Treat Grok as an adversarial advisor, never an approval gate or decision
   owner. Disposition planning findings with explicit rationale and adjust the
   plan before coding when accepted. Disposition final findings with local
   repository and test evidence, remediate accepted findings, and rerun the
   final critique if reviewed files change materially.
9. Treat exit code 0 alone, an acknowledgement, or an intent statement as
   incomplete. A valid Grok critique is the wrapper-owned versioned JSON result
   with `reviewStatus` equal to `pass` or `changes_required`; all other statuses
   must not count. The optional Text renderer is display-only compatibility.
   Retry only through the wrapper's bounded policy and never report an
   incomplete, unavailable, or diagnostic result as Grok review.

## Native agent roles

- Use the built-in `explorer` for read-heavy codebase discovery.
- Use `sdoc-architect` for cross-host boundaries, migrations, and ADR-level
  choices.
- Use the built-in `worker` for a clearly bounded implementation slice.
- Use `sdoc-verifier` to run and interpret checks without repairing failures.
- Use `sdoc-reviewer` after integration for an independent regression review.

Use no more agents than there are genuinely independent streams. Keep one
thread available for the main agent and avoid recursive delegation.

## External advisors

Use Grok CLI as the default independent critic for judgment-material plans and
for every material implementation or substantive repository verification, even
without an explicit user request. One planning critique per decision boundary
is normally sufficient; repeat it only after a material direction change.
Read `references/external-advisors.md` and run `scripts/invoke-advisor.ps1` so
the review remains non-interactive, bounded, and advisory. Use agy or another
external advisor only when the user explicitly requests it.

The wrapper's default Grok output is machine-readable JSON. Consume
`reviewStatus`, evidence, and findings from that result instead of parsing Grok
prose. Use `-OutputFormat Text` only when a human-readable rendering is needed,
and never use `-DiagnosticMode` or its deprecated `-AllowIncompleteResponse`
alias to satisfy a required critique.

Do not send secrets, credentials, unrelated source or proprietary content,
personal information, customer data, or sensitive logs. Do not let an external
advisor modify the working tree. Verify every adopted claim locally,
disposition actionable findings with evidence, and rerun Grok after material
remediation. If Grok is unavailable, unauthenticated, or unsafe to scope,
report the missing critique and residual risk explicitly rather than implying
that Grok reviewed the work.

## Delegation contract

Ask every agent to return:

- conclusion and confidence;
- evidence with file and line references;
- files read or changed;
- commands and test outcomes;
- unresolved risks or assumptions;
- the smallest useful next action.

If an agent cannot satisfy the contract, treat its result as incomplete and
continue with direct inspection or a narrower follow-up.
