# sdoc-editor-cli

`sdoc-editor-cli` is the preview-first command-line interface for inspecting,
validating, creating, and safely changing Structured Doc Editor `.sdoc` and
legacy `.tiptap.json` documents. It requires Node.js 22.22.2 or newer.

The package is distributed as a GitHub Release tarball, not through the public
npm registry. The similarly named registry package `sdoc` is unrelated.

## Safe installation and verification

For a project-local install, download the `sdoc-editor-cli-<version>.tgz`
release asset, then run these commands from the project that owns the
dependency:

```powershell
npm install --save-dev ./sdoc-editor-cli-0.5.0.tgz
npm ls sdoc-editor-cli --depth=0
npx --no-install sdoc --version
```

Keep `--no-install` on every local invocation. If the local binary is missing,
the command must fail instead of allowing npm to download and execute an
unrelated package. Check `Get-Location` first when an agent may be operating in
more than one project.

Use a global install only when that scope was explicitly requested:

```powershell
npm install --global ./sdoc-editor-cli-0.5.0.tgz
npm list --global sdoc-editor-cli --depth=0
sdoc --version
```

The remaining examples use `sdoc` for readability. For a local installation,
replace it with `npx --no-install sdoc`.

## Help and output

```powershell
sdoc --help
sdoc help apply
sdoc inspect --help
```

JSON is the default and stable machine-readable output. `--json` states that
choice explicitly. `--human` provides concise interactive output and is not a
stable machine API. Success is written to stdout; structured errors are
written to stderr.

## Commands

### `inspect`

Returns the SHA-256 revision of the exact source bytes, outline, references,
referenceable nodes, and targetable blocks. The revision includes a UTF-8 BOM
when present and changes after representation-only edits.

```powershell
sdoc inspect document.sdoc
sdoc inspect document.sdoc --target-id intro --human
```

Use the returned `revision`, IDs, paths, node types, and digests to construct an
operation request. A provisional ID is valid only for that inspected revision;
applying it persists the ID.

### `validate`

Checks the persisted document contract and semantic invariants without writing:

```powershell
sdoc validate document.sdoc
sdoc validate legacy.tiptap.json --human
```

### `apply`

Reads a complete `sdoc.operations/1` request from a JSON file or stdin. Preview
is the default; only `--write` can modify the named document.

```powershell
sdoc apply document.sdoc --operations operations.json
sdoc apply document.sdoc --operations operations.json --dry-run
sdoc apply document.sdoc --operations operations.json --write
Get-Content -Raw -Encoding utf8 operations.json |
  sdoc apply document.sdoc --operations - --write
```

`--write` takes a sibling lock, re-reads the file, verifies its revision, and
atomically replaces it. A no-op is not written. Do not combine `--write` and
`--dry-run`.

### `rename-heading`

Convenience command for a single `renameHeading` operation:

```powershell
$inspection = sdoc inspect document.sdoc | ConvertFrom-Json
sdoc rename-heading document.sdoc --id intro --title "Updated heading" `
  --expected-revision $inspection.revision
sdoc rename-heading document.sdoc --id intro --title "Updated heading" `
  --expected-revision $inspection.revision --write
```

The preview and a later independent write can have different
`outputRevision` values because each semantic change supplies a new
`meta.modified` time. Always treat the write result as authoritative.

### `create`

Creates a schema-valid `.sdoc` without overwriting an existing path. The
default template is `builtin:blank`; the default title is the output filename.

```powershell
sdoc create report.sdoc --title "Quarterly Report"
sdoc create report.sdoc --template builtin:technical-report --dry-run
sdoc create design.sdoc --template builtin:design-specification
sdoc create verification.sdoc --template builtin:verification-report
sdoc create report.sdoc --template .\templates\company-report.sdoc
```

An explicit file template must be a valid `.sdoc`. Creation removes persisted
document identity and template-only metadata while preserving supported
settings, node IDs, and links.

## Public operation contract

The package includes:

- `dist/schemas/sdoc.operations.schema.json`: draft-07 request schema
- `dist/schemas/sdoc.schema.json`: persisted document schema and reusable
  `anyNode` fragment
- `dist/examples/operations/*.json`: one request for each semantic operation

Repository copies live at `sdoc.operations.schema.json`, `sdoc.schema.json`,
and `examples/operations/`.

Every request has this envelope:

```json
{
  "contract": "sdoc.operations/1",
  "expected": {
    "revision": "sha256:0000000000000000000000000000000000000000000000000000000000000000"
  },
  "operations": []
}
```

In published examples, the all-zero revision means "replace with the exact
`revision` returned by `inspect`." The all-one snapshot digest means "replace
with that block's exact `digest` returned by the same inspection." IDs ending
in `-from-inspect` are also placeholders. These values are syntactically valid
so schema tools can validate every example, but they are not usable against a
real document until replaced.

Do not add `expected.documentId` in CLI requests. Although inspection may
report a document ID, the file-only CLI cannot establish a trusted external
document identity and rejects that precondition as unverifiable. Revision is
the CLI concurrency contract.

### Targets

Referenceable nodes such as headings, images, tables, equations, and diagrams
use persistent IDs:

```json
{ "kind": "id", "id": "intro", "expectedType": "heading" }
```

Ordinary blocks without IDs use a protected snapshot locator copied from
`inspect`:

```json
{
  "kind": "snapshot",
  "path": [1],
  "nodeType": "paragraph",
  "digest": "sha256:1111111111111111111111111111111111111111111111111111111111111111"
}
```

Snapshot targets and provisional IDs are revision-scoped. Re-inspect after any
source-byte change. A batch resolves all targets before applying its first
operation, so earlier operations cannot redirect later targets.

Destinations are `{ "position": "before"|"after", "target": ... }` or
`{ "position": "section-end", "target": ... }`. `section-end` targets a
heading and appends inside that section.

### The nine operations

Each operation below has a complete file in `dist/examples/operations/`:

| Operation | Required fields | Purpose |
|---|---|---|
| `renameHeading` | `target`, `title` | Rename a heading; optional `discardFormatting` permits replacing rich heading content |
| `insertBlock` | `destination`, `block` | Insert a non-heading Tiptap block |
| `insertSection` | `target`, `title` | Append a child section; optional `id` and `blocks` |
| `replaceBlock` | `target`, `block` | Replace a block with the same node type while preserving identity |
| `updateBlockAttrs` | `target`, `attrs` | Merge block attributes |
| `moveBlock` | `target`, `destination` | Move a non-heading block |
| `deleteBlock` | `target` | Delete a non-heading block |
| `moveSection` | `target`, `destination` | Move a heading and its complete descendant section |
| `deleteSection` | `target` | Delete a heading and its complete descendant section |

Operations are validated and applied atomically as one batch. Headings must be
moved or deleted with section operations. New assets must use portable
`./images/` or `./drawio/` paths.

## Legacy documents

Legacy raw Tiptap JSON can be inspected and validated without an upgrade flag.
Every mutation, including preview, requires `--upgrade-legacy`. Persisting the
in-place envelope upgrade additionally requires `--write`:

```powershell
sdoc apply legacy.tiptap.json --operations operations.json --upgrade-legacy
sdoc apply legacy.tiptap.json --operations operations.json --upgrade-legacy --write
```

This changes the named file in place to an SDOC envelope but does not rename
its `.tiptap.json` extension. Back up or copy the file to a `.sdoc` path first
when preserving the legacy filename matters.

## PowerShell automation

Write non-ASCII JSON explicitly as UTF-8 and keep stdout separate from stderr:

```powershell
$request | ConvertTo-Json -Depth 100 |
  Set-Content -Encoding utf8 operations.json

$resultJson = sdoc apply document.sdoc --operations operations.json 2>error.json
if ($LASTEXITCODE -ne 0) {
  $errorResult = Get-Content -Raw -Encoding utf8 error.json | ConvertFrom-Json
  throw "$($errorResult.diagnostics[0].code): $($errorResult.diagnostics[0].message)"
}
$result = $resultJson | ConvertFrom-Json
```

## Exit codes

| Code | Meaning | Representative diagnostic |
|---:|---|---|
| 0 | Success | No diagnostic |
| 2 | CLI argument or operation request error | `CLI_CONFLICTING_OPTIONS`, `CLI_MISSING_OPERATIONS` |
| 3 | Document, template, invariant, or legacy-upgrade error | `LEGACY_UPGRADE_REQUIRED` |
| 4 | Stale revision or precondition conflict | `STALE_REVISION` |
| 5 | File I/O error | `CLI_READ_FAILED` |

On failure, inspect `diagnostics[].code` rather than matching human-readable
messages.
