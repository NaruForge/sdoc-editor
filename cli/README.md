# sdoc-editor-cli

`sdoc-editor-cli` is the preview-first command-line interface for inspecting,
validating, creating, and safely changing Structured Doc Editor `.sdoc` and
legacy `.tiptap.json` documents. It requires Node.js 22.22.2 or newer.

The package is distributed as a GitHub Release tarball, not through the public
npm registry. The similarly named registry package `sdoc` is unrelated.

## Safe installation and verification

Discover the current versioned tarball from the latest non-prerelease GitHub
Release. This PowerShell example uses the anonymous GitHub Releases REST API
and refuses to continue unless exactly one CLI asset matches:

```powershell
$release = Invoke-RestMethod `
  -Headers @{
    Accept = 'application/vnd.github+json'
    'X-GitHub-Api-Version' = '2022-11-28'
  } `
  -Uri 'https://api.github.com/repos/NaruForge/sdoc-editor/releases/latest'
$cliAssets = @($release.assets | Where-Object {
  $_.name -match '^sdoc-editor-cli-[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?\.tgz$'
})
if ($cliAssets.Count -ne 1) {
  throw "Expected exactly one sdoc-editor-cli-*.tgz asset, found $($cliAssets.Count)."
}
$env:SDOC_CLI_TGZ_URL = $cliAssets[0].browser_download_url
```

The equivalent POSIX flow requires `curl` and `jq`:

```bash
SDOC_CLI_TGZ_URL="$(
  curl -fsSL \
    -H 'Accept: application/vnd.github+json' \
    -H 'X-GitHub-Api-Version: 2022-11-28' \
    https://api.github.com/repos/NaruForge/sdoc-editor/releases/latest |
  jq -er '
    [.assets[] | select(.name | test("^sdoc-editor-cli-[0-9]+[.][0-9]+[.][0-9]+(-[0-9A-Za-z.-]+)?[.]tgz$"))]
    | if length == 1 then .[0].browser_download_url
      else error("expected exactly one sdoc-editor-cli-*.tgz asset")
      end
  '
)"
export SDOC_CLI_TGZ_URL
```

Anonymous GitHub REST requests are rate-limited (typically 60 requests per
hour per source IP). Authenticate the API request when a shared runner may
exceed that limit. The CLI is not published to npm, and releases do not
provide an unversioned `latest` download alias; always use the selected
asset's `browser_download_url`.

For a project-local install, run these commands from the project that owns the
dependency:

```powershell
npm install --save-dev "$env:SDOC_CLI_TGZ_URL"
npm ls sdoc-editor-cli --depth=0
node .\node_modules\sdoc-editor-cli\dist\sdoc.js --version
```

> **Package name collision warning:** The npm public registry contains an
> unrelated package named `sdoc`. Even `npx --no-install sdoc` can resolve a
> cached copy of that unrelated package when the project-local CLI is absent.
> For deterministic local execution, invoke the installed package entry point
> directly with `node ./node_modules/sdoc-editor-cli/dist/sdoc.js ...` and verify
> the dependency first with `npm ls sdoc-editor-cli --depth=0`. A missing local
> package then fails with a path/module error instead of running another
> package. Do not install the registry package `sdoc`; it is not part of
> Structured Doc Editor. Check the current directory before invoking the CLI
> when an agent may be operating in more than one project.

Use a global install only when that scope was explicitly requested:

```powershell
npm install --global "$env:SDOC_CLI_TGZ_URL"
npm list --global sdoc-editor-cli --depth=0
sdoc --version
```

The remaining examples use `sdoc` for readability. For a local installation,
replace it with `node ./node_modules/sdoc-editor-cli/dist/sdoc.js`. Do not use
`npx sdoc` or `npx --no-install sdoc` as a local-presence check.

## Help and output

```powershell
sdoc --help
sdoc help apply
sdoc inspect --help
```

JSON is the default and stable machine-readable output. `--json` states that
choice explicitly. `--human` provides concise interactive output and is not a
stable machine API; its wording and layout may change between releases. Never
parse human output in an Agent or script. Success is written to stdout;
structured errors are written to stderr.

## Commands

### `inspect`

Returns the SHA-256 revision of the exact source bytes, outline, references,
referenceable nodes, and targetable blocks. The revision includes a UTF-8 BOM
when present and changes after representation-only edits.

```powershell
sdoc inspect document.sdoc --json
sdoc inspect document.sdoc --target-id intro --json
sdoc inspect document.sdoc --target-path /1/0 --json
```

Use the returned `revision`, IDs, paths, node types, and digests to construct an
operation request. Top-level `metadata` reports the current title, author,
version, timestamps, and document setting overrides. `--target-path` uses a
slash-delimited content path. For example, `/1/0` selects
`doc.content[1].content[0]`. A selected result has this shape:

```json
{
  "target": {
    "path": [1, 0],
    "node": { "type": "paragraph" },
    "digest": "sha256:...",
    "operationTarget": {
      "kind": "snapshot",
      "path": [1, 0],
      "nodeType": "paragraph",
      "digest": "sha256:..."
    }
  }
}
```

Copy `target.operationTarget` directly instead of assembling a snapshot
target. Every `blocks[]` entry also includes its canonical `operationTarget`.
Referenceable nodes receive an ID target; other blocks receive a snapshot
target. A provisional ID is valid only for that inspected revision; applying
it persists the ID.

### `validate`

Checks the persisted document contract and semantic invariants without writing:

```powershell
sdoc validate document.sdoc --json
sdoc validate legacy.tiptap.json --human
```

### `apply`

Reads a complete `sdoc.operations/1` request from a JSON file or stdin. Preview
is the default; only `--write` can modify the named document.

```powershell
sdoc apply document.sdoc --operations operations.json --json
sdoc apply document.sdoc --operations operations.json --dry-run --json
sdoc apply document.sdoc --operations operations.json --write --json
Get-Content -Raw -Encoding utf8 operations.json |
  sdoc apply document.sdoc --operations - --write --json
```

`--write` takes a sibling lock, re-reads the file, verifies its revision, and
atomically replaces it. A no-op is not written. Do not combine `--write` and
`--dry-run`.

The sibling `<document>.lock` records structured owner metadata with a format
version, process ID, random ownership token, hostname, and creation time. If a
write finds an existing lock, the CLI reclaims it automatically only when all
of these conditions are true:

```json
{"version":1,"pid":1234,"token":"0123456789abcdef0123456789abcdef","hostname":"workstation","createdAt":"2026-08-06T12:00:00.000Z"}
```

- the metadata is recognized and belongs to the current host;
- the owner process can be conclusively shown to have exited; and
- the lock is at least 60 seconds old.

Recovery atomically moves the stale lock aside, verifies that its owner did not
change during the move, and then retries normal exclusive acquisition. The
document is re-read and its revision is checked only after the new lock is
owned, and the CLI re-checks its ownership token before atomic publication.

Live owners, owners on another host, and legacy, malformed, or unsupported
metadata are never removed automatically. Wait for a known writer to finish.
For an abandoned lock that cannot be reclaimed automatically, remove the
`.lock` file manually only after confirming no writer is active on any reported
host, then re-inspect the document and rebuild the operation from its current
revision before retrying `--write`.

### `rename-heading`

Convenience command for a single `renameHeading` operation:

```powershell
$inspection = sdoc inspect document.sdoc --json | ConvertFrom-Json
sdoc rename-heading document.sdoc --id intro --title "Updated heading" `
  --expected-revision $inspection.revision --json
sdoc rename-heading document.sdoc --id intro --title "Updated heading" `
  --expected-revision $inspection.revision --write --json
```

The preview and a later independent write can have different
`outputRevision` values because each semantic change supplies a new
`meta.modified` time. Always treat the write result as authoritative.

### `set-document-title`

Convenience command for one `setDocumentTitle` operation. It requires the
persistent or provisional ID of an H1 and changes `meta.title` and that
explicit title heading atomically. The CLI never guesses a title heading and
never renames the file. To change only `meta.title`, use an apply request with
`setDocumentTitle` and omit its optional `headingTarget`.

```powershell
$inspection = sdoc inspect document.sdoc --json | ConvertFrom-Json
sdoc set-document-title document.sdoc --title "Updated document" --id title-h1 `
  --expected-revision $inspection.revision --write --json
```

Use `--discard-formatting` only when replacing marked or non-text content in
the selected H1 is intentional.

### `create`

Creates a schema-valid `.sdoc` without overwriting an existing path. The
default template is `builtin:blank`; the default title is the output filename.

```powershell
sdoc create report.sdoc --title "Quarterly Report" --json
sdoc create report.sdoc --template builtin:technical-report --dry-run --json
sdoc create design.sdoc --template builtin:design-specification --json
sdoc create verification.sdoc --template builtin:verification-report --json
sdoc create report.sdoc --template .\templates\company-report.sdoc --json
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

Referenceable `heading`, `image`, `table`, and `mathBlock` nodes use persistent
or revision-scoped provisional IDs:

```json
{ "kind": "id", "id": "intro", "expectedType": "heading" }
```

Other mutable blocks, including `paragraph`, `codeBlock`, and `diagram`, use a
protected snapshot locator:

```json
{
  "kind": "snapshot",
  "path": [1],
  "nodeType": "paragraph",
  "digest": "sha256:1111111111111111111111111111111111111111111111111111111111111111"
}
```

Prefer the ready-to-use `operationTarget` returned by `inspect` over copying
these fields manually. A `diagram` is snapshot-targeted; it is not a
persistent-ID node.

Snapshot targets and provisional IDs are revision-scoped. Re-inspect after any
source-byte change. A batch resolves all targets before applying its first
operation, so earlier operations cannot redirect later targets.

Destinations are `{ "position": "before"|"after", "target": ... }` or
`{ "position": "section-end", "target": ... }`. `section-end` targets a
heading and appends inside that section.

### The 14 operations

Each operation below has a complete file in `dist/examples/operations/`:

| Operation | Required fields | Purpose |
|---|---|---|
| `renameHeading` | `target`, `title` | Rename a heading; optional `discardFormatting` permits replacing rich heading content |
| `insertBlock` | `destination`, `block` | Insert a non-heading Tiptap block |
| `insertSection` | `target`, `title` | Insert a child section by default, or a same-level sibling with `position: "before"|"after"`; optional `id` and `blocks` |
| `replaceBlock` | `target`, `block` | Replace a block with the same node type while preserving identity |
| `updateBlockAttrs` | `target`, `attrs` | Merge block attributes |
| `moveBlock` | `target`, `destination` | Move a non-heading block |
| `deleteBlock` | `target` | Delete a non-heading block |
| `moveSection` | `target`, `destination` | Move a heading and its complete descendant section |
| `deleteSection` | `target` | Delete a heading and its complete descendant section |
| `setHeadingLevel` | `target`, `level` | Set a heading level and shift descendant headings by the same delta while preserving IDs |
| `renameBlockId` | `target`, `newId` | Rename a heading or table ID and rewrite matching internal links |
| `setDocumentTitle` | `title` | Set `meta.title`; optional `headingTarget` atomically updates an explicit H1 |
| `updateDocumentMetadata` | `patch` | Set or remove (`null`) the allowed `author` and `version` fields |
| `updateDocumentSettings` | `patch` | Set or remove (`null`) portable document setting overrides |

Operations are validated and applied atomically as one batch. Headings must be
moved or deleted with section operations. `created`, `modified`, document
identity, template metadata, arbitrary metadata, and filenames cannot be
changed by these operations. Portable settings are:
`headingNumbering`, `headingDecoration`, `headingH1Color` through
`headingH6Color`, `captionStyle`, `captionNumbering`, `equationNumbering`,
`crossRefIncludeCaption`, `pdfScale`, `selfContained`, `slideBreakLevel`,
`slideTransition`, and `showTitleSlide`. Local path settings
`slideCssPath`, `htmlCssPath`, and `outputDir` are deliberately excluded.

`insertSection` keeps its existing child behavior when `position` is omitted or
set to `"child"`: the new heading is one level deeper and is appended at the
target section boundary. Set `position` to `"before"` or `"after"` to insert a
same-level sibling before the target heading or after its complete descendant
section. This is the supported CLI route for building several peer H1 sections
without editing raw JSON; the new heading receives the target heading's level
and its requested persistent ID.

`setHeadingLevel` changes an existing heading to level 1-6 without changing its
persistent ID. Every descendant heading in that section moves by the same
level delta, preserving the section's relative hierarchy; the operation is
rejected with `INVALID_HEADING_LEVEL` or `SECTION_LEVEL_OUT_OF_RANGE` when the
requested level or any resulting descendant level falls outside 1-6. Inspect
again after the write to confirm the resulting outline paths and parentage.

`renameBlockId` requires an existing ID target and a unique non-empty `newId`.
It preserves the node and heading level, updates internal `#old-id` links in the
same atomic batch, and rejects duplicate IDs. A newly assigned ID cannot be used
as another target in that same request because all operation targets are
resolved from the inspected input revision before mutation begins.

### One inspection, one atomic batch

Do not inspect once per operation. One revision can guard a batch of up to 100
operations. This example inspects once, prepares three document-level changes,
previews them, and then writes the same batch:

```powershell
$inspection = sdoc inspect document.sdoc --target-id title-h1 --json |
  ConvertFrom-Json
$request = [ordered]@{
  contract = 'sdoc.operations/1'
  expected = @{ revision = $inspection.revision }
  operations = @(
    @{
      op = 'setDocumentTitle'
      title = 'Release Plan'
      headingTarget = $inspection.target.operationTarget
    }
    @{ op = 'updateDocumentMetadata'; patch = @{ author = 'Documentation Team'; version = '2.0' } }
    @{ op = 'updateDocumentSettings'; patch = @{ headingNumbering = $true; captionStyle = 'modern' } }
  )
}
$request | ConvertTo-Json -Depth 100 |
  Set-Content -Encoding utf8 operations.json
sdoc apply document.sdoc --operations operations.json --json
sdoc apply document.sdoc --operations operations.json --write --json
```

All targets in a mixed content/metadata batch must come from that same
inspection. Re-inspect after a successful write before preparing another
batch; no re-inspection is needed between operations inside one batch.

### Supported node and target catalog

The packaged `sdoc.schema.json` is authoritative. This concise catalog covers
the operation-relevant node types and required attributes:

| Nodes | Required attributes | Target kind and notes |
|---|---|---|
| `heading` | `attrs.level` (1-6) | ID target; rename with `renameHeading`, and move/delete as a complete section |
| `paragraph`, `blockquote`, `bulletList`, `orderedList`, `taskList`, `taskItem` | None | Snapshot target |
| `codeBlock` | None (`attrs.language` optional) | Snapshot target |
| `table` | None | ID target |
| `tableCell`, `tableHeader` | None | Snapshot target; span, width, and alignment attrs are optional |
| `image` | None | ID target; a new `src`, when present, must be portable |
| `mathBlock` | `attrs.latex` | ID target |
| `diagram` | `attrs.language`, `attrs.code` | Snapshot target; stores source such as Mermaid, PlantUML, or D2 |
| `horizontalRule`, `hardBreak`, `callout` | None | Snapshot target; callout `variant` is optional |
| `listItem`, `tableRow` | None | Structural container, not an operation block target |
| `text`, `mathInline` | `mathInline.attrs.latex` only | Inline content, not an operation target |

`updateBlockAttrs` accepts only the attrs defined for that node type.
`replaceBlock` must preserve the node type, while headings require the
heading/section operations.

Portable image assets use `./images/...`. Draw.io content is an `image` node
whose `src` is under `./drawio/` and ends in `.drawio.svg`; it is not a
`diagram` node. The CLI validates document structure and portable references
but does not render diagrams, create or copy asset files, or fetch assets from
the network.

### Diagram authoring and host rendering

For CLI and AI-operator workflows, the source of truth is the `diagram` node:
`diagram.attrs.language` plus `diagram.attrs.code`. A schema-valid node with
those attributes is sufficient to author and preserve a diagram in `.sdoc`;
the CLI owns structural validation and source preservation, not rendering.

Rendering belongs to the Structured Doc Editor host/viewer:

- Mermaid renders locally in the host.
- PlantUML, D2, and Graphviz use the host's online preview path only after the
  user grants the required first-use consent.
- If consent is declined or rendering is unavailable, the diagram source
  remains valid and preserved in the document.

Do not install local D2, Graphviz, PlantUML, or other renderers merely because
the CLI does not render a diagram. Local renderers are optional tools outside
the CLI authoring contract; AI operators should create or update the diagram
source node and leave rendering to the host unless the user explicitly asks
for a separate local-renderer workflow.

## Legacy documents

Legacy raw Tiptap JSON can be inspected and validated without an upgrade flag.
Every mutation, including preview, requires `--upgrade-legacy`. Persisting the
in-place envelope upgrade additionally requires `--write`:

```powershell
sdoc apply legacy.tiptap.json --operations operations.json --upgrade-legacy --json
sdoc apply legacy.tiptap.json --operations operations.json --upgrade-legacy --write --json
```

This changes the named file in place to an SDOC envelope but does not rename
its `.tiptap.json` extension. Back up or copy the file to a `.sdoc` path first
when preserving the legacy filename matters.

## PowerShell automation

Write non-ASCII JSON explicitly as UTF-8 and keep stdout separate from stderr:

```powershell
$request | ConvertTo-Json -Depth 100 |
  Set-Content -Encoding utf8 operations.json

$resultJson = sdoc apply document.sdoc --operations operations.json --json 2>error.json
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

## Diagnostic recovery

Diagnostic messages are explanatory text, not a parsing contract. Automations
must branch on `diagnostics[].code` from explicit `--json` output.

| Diagnostic code(s) | Likely cause | Recovery |
|---|---|---|
| `CLI_UNKNOWN_*`, `CLI_MISSING_*`, `CLI_CONFLICTING_OPTIONS` | Misspelled command/flag, omitted value, or incompatible flags | Run the command-specific `--help`, correct the invocation, and retry |
| `CLI_INVALID_TARGET_PATH` | `--target-path` is not a slash-delimited non-negative integer path | Copy the path from `inspect.blocks[].path` and format it like `/1/0` |
| `CLI_INVALID_JSON`, `INVALID_OPERATION_REQUEST`, `INVALID_OPERATION` | Malformed operations JSON or a request that does not match `sdoc.operations/1` | Validate against the packaged operation schema; inspect `operationIndex` when present |
| `MALFORMED_JSON`, `DOCUMENT_SCHEMA_INVALID`, `UNSUPPORTED_VERSION` | The input is not valid UTF-8 JSON, violates the document schema, or uses an unsupported SDOC version | Repair or migrate the source; do not force a write |
| `LEGACY_UPGRADE_REQUIRED` | A legacy `.tiptap.json` mutation omitted the explicit upgrade flag | Re-run with `--upgrade-legacy`, preview first, then add `--write` if intended |
| `STALE_REVISION` | The document bytes changed after inspection | Re-inspect the current file and rebuild the whole request from that revision |
| `TARGET_NOT_FOUND`, `TARGET_NOT_BLOCK`, `TARGET_TYPE_MISMATCH`, `TARGET_DIGEST_MISMATCH` | A selected path/ID is absent, is not a block, changed type, or no longer matches its snapshot | Re-inspect and use the returned `operationTarget`; do not weaken the precondition |
| `SECTION_OPERATION_REQUIRED`, `HEADING_TARGET_REQUIRED`, `SECTION_TARGET_REQUIRED`, `TITLE_H1_TARGET_REQUIRED` | A block operation was used for a heading, or a title target was not H1 | Use the matching heading/section operation and an inspected heading target |
| `INVALID_HEADING_LEVEL`, `SECTION_LEVEL_OUT_OF_RANGE` | A requested heading level is outside 1-6, or shifting the section would push a descendant outside that range | Choose a valid target level that keeps every descendant heading within 1-6 |
| `FORMATTED_HEADING` | Replacing a rich heading would discard marks or inline nodes | Preserve it, or explicitly use `discardFormatting` / `--discard-formatting` |
| `ATTRIBUTE_NOT_ALLOWED`, `NODE_TYPE_CHANGE` | An attr is not allowed for the node, or replacement changes its type | Consult the node catalog/schema and keep replacements type-compatible |
| `ID_RENAME_NOT_SUPPORTED`, `ID_RENAME_REQUIRES_EXISTING_ID`, `INVALID_NEW_ID` | An ID rename targeted an unsupported or provisional node, or supplied an invalid new ID | Target an inspected heading/table with an existing persistent ID and choose a unique non-reserved ID |
| `NEW_NONPORTABLE_ASSET`, `NEW_DANGLING_REFERENCE`, `NEW_UNSAFE_LINK` | The batch introduces an invalid asset path, missing internal target, or unsafe link | Use `./images/...` or `./drawio/*.drawio.svg`, create referenced IDs, and use a safe URL |
| `DUPLICATE_ID` | The document contains conflicting persistent IDs | Assign unique IDs before retrying |
| `CLI_TARGET_EXISTS` | `create` would overwrite an existing file | Choose a new path; the CLI never overwrites during creation |
| `CLI_LOCK_UNAVAILABLE` | Another writer holds the sibling lock, or its owner cannot be reclaimed safely | Wait for a known writer to finish. Remove an abandoned lock manually only after confirming no writer is active, then re-inspect before retrying |
| `CLI_READ_FAILED`, `CLI_ATOMIC_WRITE_FAILED` | Filesystem access or atomic replacement failed | Check path, permissions, free space, and filesystem support; verify the file before retrying |

Warnings such as `NONPORTABLE_ASSET`, `DANGLING_REFERENCE`, `UNSAFE_LINK`, and
`LEGACY_FILE_EXTENSION_RETAINED` describe pre-existing or retained conditions.
They do not authorize a later mutation to add or increase the same violation.
