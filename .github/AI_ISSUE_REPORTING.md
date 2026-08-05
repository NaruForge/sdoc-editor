# AI agent issue-reporting guide

This guide is the repository contract for an AI agent that creates or edits a
GitHub issue. Read it before making any remote mutation. It supplements
[`CONTRIBUTING.md`](../CONTRIBUTING.md) and does not replace the security policy
or the selected Issue Form.

## Authoritative references

Read the references that apply, in this order:

1. [`SECURITY.md`](../SECURITY.md) for anything involving a vulnerability,
   credentials, document loss, unintended file access, or code execution.
2. [`CONTRIBUTING.md`](../CONTRIBUTING.md#이슈와-보안-보고) for the repository's
   general reporting expectations.
3. The matching Issue Form:
   - [CLI bug report](ISSUE_TEMPLATE/cli_bug_report.yml)
   - [VS Code or Windows desktop bug report](ISSUE_TEMPLATE/bug_report.yml)
   - [Feature request](ISSUE_TEMPLATE/feature_request.yml)
4. [`AGENTS.md`](../AGENTS.md#github-operations) when the reporting agent is
   working in this repository. It defines the allowed GitHub tooling and the
   issue lifecycle for implementation work.

The Issue Forms are the field-level source of truth. Do not bypass a required
field because an API or CLI permits an unstructured issue body. If no form fits
the report, stop and identify the missing template or ask a maintainer instead
of inventing a new format.

## Select the correct route

| Report | Required route |
|---|---|
| Reproducible `sdoc` command-line problem | CLI bug report |
| Reproducible VS Code extension or Windows desktop problem | Host bug report |
| Focused new behavior or UX improvement | Feature request |
| Suspected security or privacy vulnerability | Private process in `SECURITY.md`; never a public issue |
| Question, unverified observation, or report without safe evidence | Gather evidence or ask a maintainer before creating an issue |

Search open and closed issues before creating a new one. If an existing issue
has the same cause and desired outcome, add safe missing evidence there rather
than opening a duplicate.

## Content rules

- State one problem per issue and use the selected form's title prefix.
- Report observed behavior as fact. Label hypotheses, suspected causes, and
  proposed solutions as such.
- Give the affected product surface, released version, operating environment,
  exact safe command or interaction, current behavior, and expected behavior.
- Make reproduction self-contained. Use a committed repository fixture, attach
  a sanitized minimal input, or include a minimal example in the issue. A local
  or external project path that maintainers cannot access is not a fixture.
- Separate the minimum fix from optional improvements. Do not silently expand a
  narrow defect into new behavior for unrelated node types, hosts, or modes.
- Include concise acceptance criteria that can be verified. Do not prescribe an
  implementation unless it is an explicit constraint.
- Remove credentials, personal information, customer data, proprietary document
  content, private paths, and unrelated logs. When in doubt, omit the material
  and follow `SECURITY.md`.
- Keep the type label supplied by the Issue Form (`bug` or `enhancement`).
- Add `area: cli` when the primary acceptance surface is an SDOC CLI command,
  output, operations contract, installation or packaging flow, or CLI-specific
  documentation. The CLI bug form supplies this area label automatically;
  agents must add it explicitly to CLI feature requests.
- Add `area: vscode` for behavior specific to the VS Code extension and
  `area: desktop` for behavior specific to the Windows desktop app. Use both
  labels when the issue's acceptance criteria require verification in both
  hosts. Use the user-facing `desktop` name rather than the implementation
  technology name `tauri`.
- Do not add `area: cli` merely because the CLI was used to reproduce a
  host-neutral or host-specific problem. Likewise, do not infer a host label
  solely from an internal file path. Area labels identify affected delivery
  surfaces and may be combined with the type label. Add another label only
  when its meaning is confirmed by the repository's existing description.

## Creation and verification

Repository agents must use the authenticated GitHub CLI (`gh`) as required by
`AGENTS.md`. For multiline non-ASCII text, write a bounded UTF-8 body file and
pass it with `--body-file`; do not put a long body directly on the command line.

After every create or edit operation, read the issue back with `gh issue view`
and verify:

- title and Issue Form prefix;
- body text and character encoding;
- required fields and privacy confirmation;
- labels, issue number, URL, and open/closed state;
- absence of secrets and inaccessible reproduction material.

If verification fails, correct the issue immediately and read it back again.
Creating an issue is not complete until this check passes.

## Minimum instruction for another `AGENTS.md`

When configuring another AI agent to report issues to this repository, prefer
linking this file instead of copying its full contents. At minimum, add:

> Before creating or editing a GitHub issue for Structured Doc Editor, read and
> follow `.github/AI_ISSUE_REPORTING.md`, `CONTRIBUTING.md`, and the matching
> `.github/ISSUE_TEMPLATE/*.yml`. Search for duplicates, never bypass required
> form fields, keep reproduction safe and self-contained, use the private
> `SECURITY.md` process for vulnerabilities, and verify every remote mutation by
> reading the issue back. Apply `area: cli`, `area: vscode`, and
> `area: desktop` according to the affected delivery surfaces. When operating
> inside this repository, also follow
> the GitHub tooling and lifecycle rules in the repository's `AGENTS.md`.
