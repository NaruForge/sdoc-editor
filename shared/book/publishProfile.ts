import { SETTINGS_DEFAULTS } from '../settingsResolver';
import type { DocumentSettings } from '../types';
import type {
  SdocBookPublishProfileV1,
  SdocBookV1_0,
  SdocBookV1_1,
} from './types';

function clonePublishProfile(profile: SdocBookPublishProfileV1): SdocBookPublishProfileV1 {
  return {
    profileVersion: '1',
    settings: { ...profile.settings },
    theme: { ...profile.theme },
    html: { ...profile.html },
    pdf: { ...profile.pdf },
    diagrams: { ...profile.diagrams },
    ...(profile.outputDir !== undefined ? { outputDir: profile.outputDir } : {}),
  };
}

export function createDefaultSdocBookPublishProfile(): SdocBookPublishProfileV1 {
  return {
    profileVersion: '1',
    settings: {
      headingNumbering: SETTINGS_DEFAULTS.headingNumbering,
      headingStartNumber: SETTINGS_DEFAULTS.headingStartNumber,
      headingDecoration: SETTINGS_DEFAULTS.headingDecoration,
      headingH1Color: SETTINGS_DEFAULTS.headingH1Color,
      headingH2Color: SETTINGS_DEFAULTS.headingH2Color,
      headingH3Color: SETTINGS_DEFAULTS.headingH3Color,
      headingH4Color: SETTINGS_DEFAULTS.headingH4Color,
      headingH5Color: SETTINGS_DEFAULTS.headingH5Color,
      headingH6Color: SETTINGS_DEFAULTS.headingH6Color,
      captionStyle: SETTINGS_DEFAULTS.captionStyle,
      captionNumbering: SETTINGS_DEFAULTS.captionNumbering,
      equationNumbering: SETTINGS_DEFAULTS.equationNumbering,
      crossRefIncludeCaption: SETTINGS_DEFAULTS.crossRefIncludeCaption,
    },
    theme: { id: 'default-v1' },
    html: { selfContained: SETTINGS_DEFAULTS.selfContained },
    pdf: { scale: SETTINGS_DEFAULTS.pdfScale },
    diagrams: { failurePolicy: 'source-fallback' },
  };
}

/** Project the versioned Book profile into the shared settings resolver contract. */
export function getSdocBookPublishDocumentSettings(
  profile: SdocBookPublishProfileV1,
): Partial<DocumentSettings> {
  return {
    ...profile.settings,
    htmlCssPath: profile.theme.cssPath ?? '',
    selfContained: profile.html.selfContained,
    pdfScale: profile.pdf.scale,
    outputDir: profile.outputDir ?? '',
  };
}

/** Explicitly upgrade a legacy Book; parsing never invokes this operation. */
export function upgradeBookToV1_1(
  book: SdocBookV1_0,
  publish: SdocBookPublishProfileV1,
): SdocBookV1_1 {
  const { sdocBook: _legacyVersion, ...rest } = book;
  return {
    ...rest,
    documents: book.documents.map((entry) => ({ ...entry })),
    sdocBook: '1.1',
    publish: clonePublishProfile(publish),
  };
}
