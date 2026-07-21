# Security Policy

Structured Doc Editor opens documents and local assets in VS Code and a native desktop host. Path handling, document validation, export embedding, webview isolation, and save integrity are therefore security-sensitive.

## Supported versions

Security fixes target the current `main` branch and, when practical, the latest published version. Older versions do not receive guaranteed backports. Before reporting a problem, confirm that it still occurs on the latest available build or current source.

## Reporting a vulnerability

Do not disclose a suspected vulnerability in a public issue, discussion, or pull request.

Use GitHub's private vulnerability reporting page:

<https://github.com/NaruForge/sdoc-editor/security/advisories/new>

Include as much of the following as possible:

- affected version, commit and host (VS Code or Tauri)
- operating system and relevant environment details
- minimal document, manifest or path needed to reproduce the issue
- reproduction steps and observed impact
- whether user interaction or a specially prepared workspace is required
- suggested mitigation, if known

Remove personal, proprietary, and unrelated workspace data before attaching a fixture. Do not include live credentials or tokens.

## What to expect

The maintainer will acknowledge a complete report when it has been reviewed, validate its impact, and coordinate a fix and disclosure plan through the private advisory. Response time depends on maintainer availability; submitting a report does not create a service-level agreement.

Please allow a reasonable remediation period before public disclosure. If a report is not a security issue, it may be moved to the public issue tracker after sensitive details are removed and the reporter agrees.

## Scope examples

Examples of issues that should be reported privately include:

- reading, overwriting or exporting files outside an allowed document/workspace boundary
- path traversal or symlink escape involving images, Draw.io files or `.sdocbook`
- script execution or isolation bypass in a webview or exported document
- data loss caused by save races, stale document identity or malformed input
- unsafe handling of untrusted `.sdoc`, `.tiptap.json`, `.sdocbook`, HTML or Markdown

General crashes, rendering bugs, and feature requests without a security impact belong in [GitHub Issues](https://github.com/NaruForge/sdoc-editor/issues).
