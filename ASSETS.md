# Assets and Licensing

The root [MIT License](LICENSE) applies to project source code and documentation unless a file or directory carries a different notice. Third-party software remains under its own license as listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Project artwork

`media/sdoc-editor-icon.png` is the Structured Doc Editor project icon used by the VS Code extension. It also served as the source for the historical Tauri desktop icon set in `tauri-app/src-tauri/icons/` through the final v0.7.8 Desktop release. It is distributed with the project under the root license. Project names and artwork do not grant rights to unrelated third-party trademarks.

Provenance record:

- Added by the repository owner in commit `7bd03990325fb54d03574cd9fec93aa042b45ee2` on 2026-07-20 and described in the project changelog as an original structured-document symbol.
- SHA-256: `a617a044d72b155947a5b5c4a39843cc5b1a777086b4a7ef23952d192d838925`.
- No separate editable source file or embedded PNG authorship metadata is retained. Future replacements must preserve their editable source and creation/license record.

## README VS Code product captures

The current README uses two unretouched captures from the real VS Code
Extension Development Host. They show the production v0.8.3 extension rather
than the browser-only UI quality fixture or generated imagery:

- `media/readme/vscode-editor-publish-ko-dark.png`: 1600 x 900 pixels,
  137,165 bytes, SHA-256
  `201e3a02238a0a4ac20a8033e48314224bf59dc7dab2db5d6a6d643ff464bf40`.
- `media/readme/vscode-templates-ko-light.png`: 1600 x 900 pixels,
  117,685 bytes, SHA-256
  `d07c5cbe63e0ff66ea4d26aaedf7d30082fa1b547d5c3a9e4f9ca727ff50a949`.

Provenance and redistribution record:

- Author/source: captured for this project on 2026-08-07 from repository commit
  `dd337f07d06155e94ed39fdd950a0589b822aa24`, Structured Doc Editor v0.8.3,
  with the repository owner authorizing this documentation update.
- Runtime: VS Code 1.132.0 on Windows, launched with this repository as
  `--extensionDevelopmentPath` and isolated temporary user-data and extension
  directories. The normal VS Code profile and installed extensions were not
  used.
- Content: the repository-owned `builtin:verification-report` document was
  copied to an isolated temporary workspace, opened and saved through the real
  custom editor, then captured with the Publish panel in `Dark 2026` and the
  Templates panel in `Light 2026`. The product locale was Korean (`ko-KR`) and
  reduced motion was enabled. The input document SHA-256 was
  `d34ab434fe971f26a3a396e721324ded330d513dba8d4665a924ca016466e7b0`.
- Capture method: Playwright controlled the installed VS Code Electron process,
  asserted the Extension Development Host argument, product frame, theme class,
  Korean locale, active panel, and saved state, and wrote lossless 1600 x 900
  PNG screenshots. The images were not cropped, composited, reconstructed, or
  AI-generated.
- Sanitization: no personal paths, signed-in accounts, notifications, customer
  data, unrelated extensions, Desktop UI, restricted legacy logo, or restricted
  font asset is visible. The sample document and all visible document content
  are owned by this repository.
- License and rights: the screenshots are project documentation distributed
  under the root MIT License and may be copied, modified, and redistributed in
  source archives, project documentation, and Marketplace material. VS Code
  chrome is shown only to identify the supported host; this record grants no
  rights to Microsoft trademarks. README screenshots remain remote GitHub
  assets and are intentionally excluded from the VSIX payload.

## Temporarily retained restricted assets

The following legacy assets are present in the source tree pending a separate cleanup:

- `media/legacy-brand-logo.png`
- `media/fonts/`

These files are **not licensed under the repository's MIT License**. Their presence does not grant permission to copy, modify, redistribute, or use the associated trademarks or typefaces. Downstream distributors must omit them unless they have independently obtained the necessary rights.

The VS Code packaging rules exclude the restricted `media/` paths; only `media/sdoc-editor-icon.png` is included from `media/`. The historical desktop icon files are generated derivatives of that project icon and are not restricted legacy assets. Contributors must not add new references to the restricted assets.

## Bundled open-source fonts

The editor embeds the following WOFF2 files for offline use. Both fonts are
distributed under the SIL Open Font License 1.1; the unmodified license texts
are included in `licenses/fonts/` and current VSIX packages. They were also
included in the final v0.7.8 MSI, NSIS, and portable Desktop artifacts.

- Pretendard Variable v1.3.9
  - Upstream: `https://github.com/orioncactus/pretendard`
  - Revision: `5c41199ea0024a9e0b2cb31735265056e5472d76`
  - File: `shared/editor/assets/fonts/PretendardVariable.woff2`
  - SHA-256: `9599f12fd42fc0bce1cd50b47a0c022e108d7aa64dd0d1bb0ed44f3282d900b4`
  - License: `licenses/fonts/Pretendard-OFL.txt`
- JetBrains Mono Variable
  - Upstream: `https://github.com/JetBrains/JetBrainsMono`
  - Revision: `19371302b95d218af43299bce79ddbddd0bc364d`
  - Regular SHA-256: `31ec365b93e4bad6f202ce23352a56d01ca4462b2afc782ed2cf6fa42ca9ac0e`
  - Italic SHA-256: `76a805b6ea613ce2e3973f1bac6fa29db23116b2881390b59247d22890844ecc`
  - Files: `shared/editor/assets/fonts/JetBrainsMono-Variable.woff2` and
    `shared/editor/assets/fonts/JetBrainsMono-VariableItalic.woff2`
  - License: `licenses/fonts/JetBrainsMono-OFL.txt`

## Adding an asset

Every new image, font, sample document, diagram, or media file must have reviewable provenance. A contribution should identify:

- its author or original source
- the applicable license and required attribution
- whether the contributor has permission from an employer or other rights holder
- whether redistribution in VSIX packages, CLI packages, source archives, and exported documents is allowed

Do not commit an asset when its source or redistribution rights are uncertain. Prefer original project artwork, permissively licensed assets, and system fonts that do not need to be redistributed.
