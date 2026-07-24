# sdoc-editor-cli

Node.js 22 command line interface for inspecting, validating, and safely
applying semantic operations to Structured Doc Editor documents.

Install the package tarball produced by the repository:

```powershell
npm install --global ./output/sdoc-editor-cli-*.tgz
sdoc --version
```

Commands preview changes unless `--write` is specified:

```powershell
sdoc inspect document.sdoc --json
sdoc validate document.sdoc --json
sdoc apply document.sdoc --operations operations.json
sdoc apply document.sdoc --operations operations.json --write
sdoc rename-heading document.sdoc --id intro --title "시험 결과" `
  --expected-revision sha256:...
```

Pass `-` to `--operations` to read a request from standard input. Legacy raw
Tiptap JSON can be inspected and validated, but writing it requires
`--upgrade-legacy`. Apply requests must use the exact `revision` returned by
`inspect`. `--dry-run` is an explicit alias for the default preview behavior.

Commands emit one JSON object to stdout on success and one structured JSON
error to stderr on failure. Exit codes are `0` success, `2` argument or
operation-contract error, `3` document-contract or invariant error, `4` stale
revision or precondition conflict, and `5` file I/O error.
