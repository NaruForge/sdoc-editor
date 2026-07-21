# Assets and Licensing

The root [MIT License](LICENSE) applies to project source code and documentation unless a file or directory carries a different notice. Third-party software remains under its own license as listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Project artwork

`media/sdoc-editor-icon.png` is the Structured Doc Editor project icon used by the VS Code package. It is distributed with the project under the root license. Project names and artwork do not grant rights to unrelated third-party trademarks.

Provenance record:

- Added by the repository owner in commit `7bd03990325fb54d03574cd9fec93aa042b45ee2` on 2026-07-20 and described in the project changelog as an original structured-document symbol.
- SHA-256: `a617a044d72b155947a5b5c4a39843cc5b1a777086b4a7ef23952d192d838925`.
- No separate editable source file or embedded PNG authorship metadata is retained. Future replacements must preserve their editable source and creation/license record.

## Temporarily retained restricted assets

The following legacy assets are present in the source tree pending a separate cleanup:

- `media/legacy-brand-logo.png`
- `media/fonts/`
- `tauri-app/src-tauri/icons/` (legacy desktop icon set with incomplete provenance)

These files are **not licensed under the repository's MIT License**. Their presence does not grant permission to copy, modify, redistribute, or use the associated trademarks or typefaces. Downstream distributors must omit them unless they have independently obtained the necessary rights.

The VS Code packaging rules exclude the restricted `media/` paths; only `media/sdoc-editor-icon.png` is included from `media/`. The desktop application does not use the legacy logo or font files, but its current icon set remains a packaging input until the separately planned branding cleanup. Contributors must not add new references to the restricted assets.

## Adding an asset

Every new image, font, sample document, diagram, or media file must have reviewable provenance. A contribution should identify:

- its author or original source
- the applicable license and required attribution
- whether the contributor has permission from an employer or other rights holder
- whether redistribution in VSIX, desktop installers, source archives, and exported documents is allowed

Do not commit an asset when its source or redistribution rights are uncertain. Prefer original project artwork, permissively licensed assets, and system fonts that do not need to be redistributed.
