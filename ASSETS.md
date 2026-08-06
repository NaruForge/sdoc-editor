# Assets and Licensing

The root [MIT License](LICENSE) applies to project source code and documentation unless a file or directory carries a different notice. Third-party software remains under its own license as listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Project artwork

`media/sdoc-editor-icon.png` is the Structured Doc Editor project icon used by the VS Code extension. It also served as the source for the historical Tauri desktop icon set in `tauri-app/src-tauri/icons/` through the final v0.7.8 Desktop release. It is distributed with the project under the root license. Project names and artwork do not grant rights to unrelated third-party trademarks.

Provenance record:

- Added by the repository owner in commit `7bd03990325fb54d03574cd9fec93aa042b45ee2` on 2026-07-20 and described in the project changelog as an original structured-document symbol.
- SHA-256: `a617a044d72b155947a5b5c4a39843cc5b1a777086b4a7ef23952d192d838925`.
- No separate editable source file or embedded PNG authorship metadata is retained. Future replacements must preserve their editable source and creation/license record.

## README editor overview

`media/readme/editor-overview-ko.png` is a retained historical v0.7.8 overview
image. It shows the same sanitized editor fixture in the VS Code light theme on
the left and the retired Tauri dark theme on the right, with descriptive
host/theme labels and no host logos. It is no longer used as the current README
product overview after Desktop EOL.

Provenance and redistribution record:

- Author/source: created for the project on 2026-08-05 from this repository's
  production editor components through the existing Playwright UI quality test
  harness (`tests/ui/`). It is a deterministic Chromium capture, not
  AI-generated imagery.
- Capture method: the Korean `editor` scene was rendered twice at 800 x 900
  pixels with a UTC timezone and five table columns (`vscode`/`light` and
  `tauri`/`dark`), then the two unretouched PNG captures were joined
  horizontally. The resulting image is 1600 x 900 pixels and 121,095 bytes.
- Content and asset scope: the fixture contains fixed sample text and
  timestamps only. It contains no personal paths, accounts, customer data, or
  company-restricted content, and it does not use the restricted legacy logo or
  font assets listed below.
- License and rights: the image is project documentation distributed under the
  root MIT License. It may be copied, modified, and redistributed under that
  license in source archives, VSIX packages, historical desktop installers, project
  documentation, and related project materials. Descriptive references to VS
  Code and Tauri do not grant rights to unrelated third-party trademarks.
- SHA-256: `c0beb76d303f9a979d7649aa0376d404afbed9930ee8f208359869b49749943a`.

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
