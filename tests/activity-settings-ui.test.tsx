import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import postcss from 'postcss';
import { describe, expect, it, vi } from 'vitest';
import {
  createActivitySessionState,
  selectSidePanel,
  transitionActivityDestination,
} from '../shared/editor/activityState';
import { ActivityBar } from '../shared/editor/components/ActivityBar';
import {
  buildDesignCompactPreview,
  DesignPanel,
} from '../shared/editor/components/DesignPanel';
import { ViewControlPanel } from '../shared/editor/components/ViewControlPanel';
import {
  nextSidePanelTabIndex,
  SidePanelTabs,
} from '../shared/editor/components/SidePanelTabs';
import { SidePanelBody } from '../shared/editor/components/SidePanelBody';
import {
  getSidePanelTabId,
  SIDE_PANEL_TAB_CONTENT_ID,
  SidePanelTabPanel,
  type TabbedSidePanelSelection,
} from '../shared/editor/components/SidePanelTabPanel';
import {
  applyHeadingPalette,
  DeferredNumberInput,
  DeferredTextInput,
  DocumentSettingsPanel,
  getHeadingPalette,
  isDeferredTextDraftValid,
  parseDeferredNumberDraft,
  removeDocumentSettings,
} from '../shared/editor/components/DocumentSettingsPanel';
import { EditorProvider } from '../shared/editor/context/EditorContext';
import { EditorI18nProvider } from '../shared/editor/i18n';
import {
  createDefaultViewPreferences,
  materializeSettingsGroup,
  removeSettingsOverrides,
  restoreSettingsGroupBaseline,
} from '../shared/editor/designSettings';
import { resolveDocumentSettingsSnapshot } from '../shared/settingsResolver';

const renderActivityBar = (element: React.ReactElement): string => renderToStaticMarkup(
  <EditorI18nProvider locale="en">{element}</EditorI18nProvider>,
);

describe('activity hubs and settings UI', () => {
  it('keeps Design view preferences session-only and follows the document by default', () => {
    expect(createDefaultViewPreferences()).toEqual({
      headingNumbering: 'follow-document',
      headingDecoration: 'follow-document',
    });
  });

  it('builds the compact preview from the effective numbering and caption formatter', () => {
    expect(buildDesignCompactPreview({
      headingNumbering: true,
      headingStartNumber: 5,
      captionStyle: 'ieee',
    }, 'Example caption')).toEqual({
      headingOne: '5',
      headingTwo: '5.1',
      caption: 'Fig. 1. Example caption',
    });
    expect(buildDesignCompactPreview({
      headingNumbering: false,
      headingStartNumber: 8,
      captionStyle: 'korean',
    }, '캡션 예시')).toEqual({
      headingOne: '',
      headingTwo: '',
      caption: '그림 1 캡션 예시',
    });
  });

  it('restores panel-open group baselines without disturbing other settings', () => {
    const baseline = { headingDecoration: false, captionStyle: 'iso' } as const;
    const current = {
      headingDecoration: true,
      headingH1Color: '#123456',
      captionStyle: 'korean',
    } as const;

    expect(restoreSettingsGroupBaseline(current, baseline, [
      'headingDecoration',
      'headingH1Color',
    ])).toEqual({ headingDecoration: false, captionStyle: 'korean' });
  });

  it('can pin effective settings or remove only the selected overrides', () => {
    const snapshot = resolveDocumentSettingsSnapshot({
      context: 'standalone',
      documentSettings: { captionStyle: 'korean' },
    });

    expect(materializeSettingsGroup(
      { captionStyle: 'korean' },
      snapshot,
      ['headingDecoration', 'headingH1Color'],
    )).toMatchObject({
      captionStyle: 'korean',
      headingDecoration: snapshot.values.headingDecoration,
      headingH1Color: snapshot.values.headingH1Color,
    });
    expect(removeSettingsOverrides(
      { captionStyle: 'korean', headingDecoration: false },
      ['headingDecoration'],
    )).toEqual({ captionStyle: 'korean' });
  });

  it('keeps invalid deferred drafts local and connects the error message', () => {
    expect(isDeferredTextDraftValid('#GGGGGG', '^#[0-9a-fA-F]{6}$')).toBe(false);
    const markup = renderToStaticMarkup(
      <DeferredTextInput
        value="#GGGGGG"
        placeholder="#2563EB"
        pattern="^#[0-9a-fA-F]{6}$"
        errorMessage="Enter a valid HEX color"
        onCommit={vi.fn()}
      />,
    );
    const errorId = markup.match(/aria-errormessage="([^"]+)"/)?.[1];
    expect(markup).toContain('aria-invalid="true"');
    expect(errorId).toBeTruthy();
    expect(markup).toContain(`id="${errorId}"`);
    expect(markup).toContain('Enter a valid HEX color');
  });

  it('accepts only finite in-range PDF scale drafts before commit', () => {
    expect(parseDeferredNumberDraft('', 10, 200)).toBeNull();
    expect(parseDeferredNumberDraft('not-a-number', 10, 200)).toBeNull();
    expect(parseDeferredNumberDraft('9', 10, 200)).toBeNull();
    expect(parseDeferredNumberDraft('201', 10, 200)).toBeNull();
    expect(parseDeferredNumberDraft('95', 10, 200)).toBe(95);

    const markup = renderToStaticMarkup(
      <DeferredNumberInput
        value={70}
        min={10}
        max={200}
        ariaLabel="PDF scale"
        errorMessage="Enter a number from 10 through 200."
        onCommit={vi.fn()}
      />,
    );
    expect(markup).toContain('inputMode="decimal"');
    expect(markup).toContain('aria-label="PDF scale"');
    expect(markup).not.toContain('aria-invalid="true"');
  });
  it('calculates wrapped side-panel tab focus for arrows, Home, and End', () => {
    expect(nextSidePanelTabIndex(0, 'ArrowLeft', 3)).toBe(2);
    expect(nextSidePanelTabIndex(2, 'ArrowRight', 3)).toBe(0);
    expect(nextSidePanelTabIndex(1, 'Home', 3)).toBe(0);
    expect(nextSidePanelTabIndex(1, 'End', 3)).toBe(2);
    expect(nextSidePanelTabIndex(-1, 'ArrowLeft', 3)).toBe(2);
    expect(nextSidePanelTabIndex(-1, 'ArrowRight', 3)).toBe(0);
    expect(nextSidePanelTabIndex(0, 'ArrowRight', 0)).toBe(-1);
  });

  it('remembers each hub child and closes an open hub when it is clicked again', () => {
    let state = createActivitySessionState(
      { destination: 'navigate', tab: 'toc' },
      { showTemplates: true },
    );
    state = selectSidePanel(
      state,
      { destination: 'navigate', tab: 'figures' },
      { showTemplates: true },
    );
    state = transitionActivityDestination(state, 'design', { showTemplates: true });
    expect(state.selection).toEqual({ destination: 'design' });

    state = transitionActivityDestination(state, 'navigate', { showTemplates: true });
    expect(state.selection).toEqual({ destination: 'navigate', tab: 'figures' });

    state = transitionActivityDestination(state, 'navigate', { showTemplates: true });
    expect(state.selection).toBeNull();
    expect(state.lastChildTabs.navigate).toBe('figures');
  });

  it('keeps the capability-gated template destination out of unavailable session state', () => {
    let state = createActivitySessionState(null);
    state = transitionActivityDestination(state, 'templates', { showTemplates: true });
    expect(state.selection).toEqual({ destination: 'templates' });
    state = transitionActivityDestination(state, 'templates', { showTemplates: true });
    expect(state.selection).toBeNull();
    state = transitionActivityDestination(state, 'publish');
    expect(state.selection).toEqual({ destination: 'publish', tab: 'export' });

    const unavailable = createActivitySessionState(null);
    expect(transitionActivityDestination(unavailable, 'templates')).toBe(unavailable);
  });

  it('renders Templates as an independent shared destination in the required order', () => {
    const sharedMarkup = renderActivityBar(
      <ActivityBar
        activeDestination="templates"
        onDestinationClick={vi.fn()}
        showTemplates
      />,
    );
    expect(sharedMarkup.match(/class="activity-bar-icon/g)).toHaveLength(4);
    expect(sharedMarkup.indexOf('Navigate')).toBeLessThan(sharedMarkup.indexOf('Design'));
    expect(sharedMarkup.indexOf('Design')).toBeLessThan(sharedMarkup.indexOf('Templates'));
    expect(sharedMarkup.indexOf('Templates')).toBeLessThan(sharedMarkup.indexOf('Files'));
    expect(sharedMarkup).not.toContain('Workspace');
  });

  it('keeps only Export and Import in Files and remembers its last tab', () => {
    const markup = renderToStaticMarkup(
      <EditorI18nProvider locale="en">
        <SidePanelTabs
          selection={{ destination: 'publish', tab: 'import' }}
          onSelectionChange={vi.fn()}
        />
      </EditorI18nProvider>,
    );
    expect(markup.match(/role="tab"/g)).toHaveLength(2);
    expect(markup).toContain('Export');
    expect(markup).toContain('Import');
    expect(markup).not.toContain('Templates');

    let state = createActivitySessionState({ destination: 'publish', tab: 'import' });
    state = transitionActivityDestination(state, 'templates', { showTemplates: true });
    state = transitionActivityDestination(state, 'publish', { showTemplates: true });
    expect(state.selection).toEqual({ destination: 'publish', tab: 'import' });
  });

  it.each([
    { destination: 'navigate', tab: 'figures' },
    { destination: 'publish', tab: 'import' },
  ] satisfies TabbedSidePanelSelection[])(
    'connects every $destination tab to the shared panel and labels it from the selected tab',
    (selection) => {
      const markup = renderToStaticMarkup(
        <EditorI18nProvider locale="en">
          <SidePanelTabs selection={selection} onSelectionChange={vi.fn()} />
          <SidePanelTabPanel selection={selection}>Panel content</SidePanelTabPanel>
        </EditorI18nProvider>,
      );
      const controlledIds = Array.from(
        markup.matchAll(/aria-controls="([^"]+)"/g),
        (match) => match[1],
      );
      const selectedTabId = markup.match(
        /<button[^>]*id="([^"]+)"[^>]*aria-selected="true"/,
      )?.[1];

      expect(controlledIds.length).toBeGreaterThan(0);
      for (const controlledId of controlledIds) {
        expect(markup).toContain(`id="${controlledId}"`);
      }
      expect(controlledIds).toEqual(
        Array.from({ length: controlledIds.length }, () => SIDE_PANEL_TAB_CONTENT_ID),
      );
      expect(selectedTabId).toBe(getSidePanelTabId(selection));
      expect(markup).toContain(`role="tabpanel"`);
      expect(markup).toContain(`aria-labelledby="${selectedTabId}"`);
    },
  );

  it.each([
    { destination: 'design' },
    { destination: 'templates' },
  ] as const)(
    'renders $destination content without tabpanel semantics',
    (selection) => {
      const markup = renderToStaticMarkup(
        <SidePanelTabPanel selection={selection}>Panel content</SidePanelTabPanel>,
      );

      expect(markup).toBe('Panel content');
      expect(markup).not.toContain('role="tabpanel"');
      expect(markup).not.toContain('aria-labelledby');
      expect(markup).not.toContain(`id="${SIDE_PANEL_TAB_CONTENT_ID}"`);
    },
  );

  it('uses the shared tab-and-panel composition in the VS Code host', () => {
    const bodySource = readFileSync(
      resolve(process.cwd(), 'shared/editor/components/SidePanelBody.tsx'),
      'utf8',
    );
    const panelSource = readFileSync(
      resolve(process.cwd(), 'shared/editor/components/SidePanelTabPanel.tsx'),
      'utf8',
    );
    expect(bodySource).toContain("from './SidePanelTabs'");
    expect(bodySource).toContain("from './SidePanelTabPanel'");
    expect(panelSource).not.toContain("from './SidePanelTabs'");

    const source = readFileSync(
      resolve(process.cwd(), 'webview-ui/src/components/SidePanel.tsx'),
      'utf8',
    );
    expect(source).toContain("import { SidePanelBody } from '@shared/editor/components/SidePanelBody'");
    expect(source).toContain("import { DesignPanel } from '@shared/editor/components/DesignPanel'");
    expect(source).toContain('settingsSnapshot: designState.settingsSnapshot');
    expect(source).toContain("type: 'SET_VIEW_PREFERENCES'");
    expect(source).toContain('<SidePanelBody selection={selection} onSelectionChange={onSelectionChange}>');
    expect(source).toContain("selection.destination === 'design'");
    expect(source).not.toContain("selection.destination === 'design' && selection.tab");
    expect(source).not.toContain('id="side-panel-tab-content"');
  });

  it('defines every VS Code theme variable used by shared CSS in the UI fixture', () => {
    const sharedStyles = readFileSync(
      resolve(process.cwd(), 'shared/editor/styles/editor.css'),
      'utf8',
    );
    const harnessStyles = readFileSync(resolve(process.cwd(), 'tests/ui/src/harness.css'), 'utf8');
    const referencedVariables = new Set(
      [...sharedStyles.matchAll(/var\((--vscode-[\w-]+)/gu)].map((match) => match[1]),
    );
    const declaredVariables = new Set<string>();
    postcss.parse(harnessStyles).walkDecls(/^--vscode-/u, (declaration) => {
      declaredVariables.add(declaration.prop);
    });

    expect([...referencedVariables].filter((name) => !declaredVariables.has(name)).sort()).toEqual([]);
  });

  it('renders the host-shared composition with a connected selected tab and tabpanel', () => {
    const selection = { destination: 'publish', tab: 'export' } as const;
    const markup = renderToStaticMarkup(
      <EditorI18nProvider locale="en">
        <SidePanelBody selection={selection} onSelectionChange={vi.fn()}>
          Panel content
        </SidePanelBody>
      </EditorI18nProvider>,
    );

    expect(markup).toContain(`id="${getSidePanelTabId(selection)}"`);
    expect(markup).toContain(`aria-controls="${SIDE_PANEL_TAB_CONTENT_ID}"`);
    expect(markup).toContain(`id="${SIDE_PANEL_TAB_CONTENT_ID}"`);
    expect(markup).toContain(`aria-labelledby="${getSidePanelTabId(selection)}"`);
  });

  it('renders screen-only and document-persisted controls together without Design tabs', () => {
    const snapshot = resolveDocumentSettingsSnapshot({
      context: 'editor',
      documentSettings: { headingDecoration: false },
      temporaryView: { headingNumbering: 'show' },
    });
    const markup = renderToStaticMarkup(
      <EditorI18nProvider locale="en">
        <EditorProvider>
          <SidePanelBody selection={{ destination: 'design' }} onSelectionChange={vi.fn()}>
            <DesignPanel
              showNumbering
              onToggleNumbering={vi.fn()}
              showDecoration
              onToggleDecoration={vi.fn()}
              uiLanguagePreference="auto"
              onUiLanguagePreferenceChange={vi.fn()}
              onUpdateDocSettings={vi.fn()}
              adapter={{
                settingsSnapshot: snapshot,
                viewPreferences: {
                  headingNumbering: 'show',
                  headingDecoration: 'follow-document',
                },
                onViewPreferencesChange: vi.fn(),
                settingsSyncState: { status: 'saved' },
              }}
            />
          </SidePanelBody>
        </EditorProvider>
      </EditorI18nProvider>,
    );

    expect(markup).toContain('View controls');
    expect(markup).toContain('do not modify the document');
    expect(markup).toContain('Document settings');
    expect(markup).toContain('saved with this document');
    expect(markup).toContain('Temporary view');
    expect(markup).toContain('Session only');
    expect(markup).toContain('Stored in document');
    expect(markup).toContain('Applies to Editor view, HTML, PDF');
    expect(markup).toContain('Saved to disk');
    expect(markup).toContain('Portable style preview');
    expect(markup).not.toContain('role="tablist"');
    expect(markup).not.toContain('role="tabpanel"');
  });

  it('renders the global UI language preference in the shared View panel', () => {
    const markup = renderToStaticMarkup(
      <EditorProvider>
        <ViewControlPanel
          showNumbering
          onToggleNumbering={vi.fn()}
          showDecoration
          onToggleDecoration={vi.fn()}
          uiLanguagePreference="ko"
          onUiLanguagePreferenceChange={vi.fn()}
        />
      </EditorProvider>,
    );

    expect(markup).toContain('Interface language');
    expect(markup).toContain('<option value="auto">Auto</option>');
    expect(markup).toContain('<option value="ko" selected="">한국어</option>');
    expect(markup).toContain('<option value="en">English</option>');
    expect(markup.match(/<option value="follow-document" selected="">Follow document<\/option>/g))
      .toHaveLength(2);
  });

  it('applies a document-wide palette as one H1-H6 settings patch', () => {
    const patched = applyHeadingPalette(
      { captionStyle: 'ieee', headingH1Color: '#123456' },
      'heritage-red',
    );

    expect(patched).toMatchObject({
      captionStyle: 'ieee',
      headingH1Color: '#A50034',
      headingH2Color: '#A50034',
      headingH3Color: '#A50034',
      headingH4Color: '#A50034',
      headingH5Color: '#A50034',
      headingH6Color: '#A50034',
    });
    expect(getHeadingPalette(patched)).toBe('heritage-red');
    expect(getHeadingPalette({
      ...patched,
      headingH6Color: '#123456',
    })).toBe('mixed');
  });

  it('removes only the selected group overrides when using host defaults', () => {
    expect(removeDocumentSettings(
      {
        headingDecoration: false,
        headingH1Color: '#123456',
        captionStyle: 'iso',
      },
      ['headingDecoration', 'headingH1Color'],
    )).toEqual({ captionStyle: 'iso' });
    expect(removeDocumentSettings({ headingDecoration: false }, ['headingDecoration'])).toBeNull();
  });

  it('opens common document groups while progressively disclosing advanced and export settings', () => {
    const settingsMarkup = renderToStaticMarkup(
      <EditorProvider>
        <DocumentSettingsPanel onUpdateSettings={vi.fn()} />
      </EditorProvider>,
    );
    const exportMarkup = renderToStaticMarkup(
      <EditorProvider>
        <DocumentSettingsPanel onUpdateSettings={vi.fn()} exportMode="export" />
      </EditorProvider>,
    );

    expect(settingsMarkup).toContain('Document appearance');
    expect(settingsMarkup).toContain('Numbering and references');
    expect(settingsMarkup).toContain('Heading start number');
    expect(settingsMarkup).toContain('type="number"');
    expect(settingsMarkup).toContain('min="0"');
    expect(settingsMarkup).toContain('Advanced heading colors');
    expect(settingsMarkup).toContain('aria-expanded="false"');
    expect(settingsMarkup).toContain('Remove overrides');
    expect(settingsMarkup).toContain('Store effective values');
    expect(settingsMarkup).toContain('Undo all panel changes');
    expect(settingsMarkup).toContain('Reset all document settings');
    expect(settingsMarkup.match(/settings-palette-card/g)).toHaveLength(4);
    expect(settingsMarkup).toContain('Blue palette, #2563EB');
    expect(settingsMarkup).toContain('LG heritage red, #A50034');
    expect(settingsMarkup).toContain('Black, #000000');
    expect(settingsMarkup).toContain('Custom, #2563EB');
    expect(settingsMarkup).not.toContain('settings-palette-mixed-notice');
    expect(settingsMarkup).not.toContain('settings-custom-palette-controls');
    expect(settingsMarkup).toContain('disabled="">Undo group');
    expect(exportMarkup).toContain('Export options');
    expect(exportMarkup).not.toContain('Document appearance');
  });

  it.each([
    ['en', 'settings', 'Document settings', 'Document appearance'],
    ['en', 'export', 'Export options', 'General'],
    ['en', 'slides', 'Slide options', 'Slides'],
    ['ko', 'settings', '문서 설정', '문서 모양'],
    ['ko', 'export', '내보내기 옵션', '일반'],
    ['ko', 'slides', '슬라이드 옵션', '슬라이드'],
  ] as const)('renders %s %s settings UI from the locale catalog', (locale, mode, title, section) => {
    const markup = renderToStaticMarkup(
      <EditorProvider initialLocale={locale}>
        <DocumentSettingsPanel onUpdateSettings={vi.fn()} exportMode={mode} />
      </EditorProvider>,
    );

    expect(markup).toContain(title);
    expect(markup).toContain(section);
    expect(markup).toContain(locale === 'ko' ? '재정의 제거' : 'Remove overrides');
  });

  it.each(['settings', 'export', 'slides'] as const)(
    'does not leave known hardcoded English UI in Korean %s mode',
    (mode) => {
      const markup = renderToStaticMarkup(
        <EditorProvider initialLocale="ko">
          <DocumentSettingsPanel onUpdateSettings={vi.fn()} exportMode={mode} />
        </EditorProvider>,
      );

      for (const text of [
        'Document appearance',
        'Heading palette',
        'Mixed',
        'Advanced heading colors',
        'Numbering and references',
        'Remove overrides',
        'Shown when heading levels use different colors',
        'Custom document heading color',
        'Export options',
        'Slide options',
        'Confirm reset all document settings',
        'Reset all document settings?',
      ]) {
        expect(markup).not.toContain(text);
      }
    },
  );
});
