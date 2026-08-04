import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  createActivitySessionState,
  selectSidePanel,
  transitionActivityDestination,
} from '../shared/editor/activityState';
import { ActivityBar } from '../shared/editor/components/ActivityBar';
import { DesignPanel } from '../shared/editor/components/DesignPanel';
import { ViewControlPanel } from '../shared/editor/components/ViewControlPanel';
import { SidePanelTabs } from '../shared/editor/components/SidePanelTabs';
import { SidePanelBody } from '../shared/editor/components/SidePanelBody';
import {
  getSidePanelTabId,
  SIDE_PANEL_TAB_CONTENT_ID,
  SidePanelTabPanel,
  type TabbedSidePanelSelection,
} from '../shared/editor/components/SidePanelTabPanel';
import {
  applyHeadingPalette,
  DocumentSettingsPanel,
  getHeadingPalette,
  removeDocumentSettings,
} from '../shared/editor/components/DocumentSettingsPanel';
import { EditorProvider } from '../shared/editor/context/EditorContext';
import { EditorI18nProvider } from '../shared/editor/i18n';

const renderActivityBar = (element: React.ReactElement): string => renderToStaticMarkup(
  <EditorI18nProvider locale="en">{element}</EditorI18nProvider>,
);

describe('activity hubs and settings UI', () => {
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

  it('keeps unavailable workspace and template destinations out of session state', () => {
    let state = createActivitySessionState(null);
    expect(transitionActivityDestination(state, 'workspace')).toBe(state);

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
    const workspaceMarkup = renderActivityBar(
      <ActivityBar
        activeDestination="workspace"
        onDestinationClick={vi.fn()}
        showWorkspace
      />,
    );

    expect(sharedMarkup.match(/class="activity-bar-icon/g)).toHaveLength(4);
    expect(sharedMarkup.indexOf('Navigate')).toBeLessThan(sharedMarkup.indexOf('Design'));
    expect(sharedMarkup.indexOf('Design')).toBeLessThan(sharedMarkup.indexOf('Templates'));
    expect(sharedMarkup.indexOf('Templates')).toBeLessThan(sharedMarkup.indexOf('Publish'));
    expect(sharedMarkup).not.toContain('Workspace');
    expect(workspaceMarkup.match(/class="activity-bar-icon/g)).toHaveLength(4);
    expect(workspaceMarkup).toContain('Workspace');
  });

  it('keeps only Export and Import in Publish and remembers its last tab', () => {
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
    { destination: 'workspace' },
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

  it('uses the shared tab-and-panel composition in both hosts', () => {
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

    for (const path of [
      'webview-ui/src/components/SidePanel.tsx',
      'tauri-app/src/components/SidePanel.tsx',
    ]) {
      const source = readFileSync(resolve(process.cwd(), path), 'utf8');
      expect(source).toContain("import { SidePanelBody } from '@shared/editor/components/SidePanelBody'");
      expect(source).toContain("import { DesignPanel } from '@shared/editor/components/DesignPanel'");
      expect(source).toContain('<SidePanelBody selection={selection} onSelectionChange={onSelectionChange}>');
      expect(source).toContain("selection.destination === 'design'");
      expect(source).not.toContain("selection.destination === 'design' && selection.tab");
      expect(source).not.toContain('id="side-panel-tab-content"');
    }
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
            />
          </SidePanelBody>
        </EditorProvider>
      </EditorI18nProvider>,
    );

    expect(markup).toContain('View controls');
    expect(markup).toContain('do not modify the document');
    expect(markup).toContain('Document settings');
    expect(markup).toContain('saved with this document');
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
    expect(settingsMarkup).toContain('Use host defaults');
    expect(settingsMarkup).toContain('Reset all document settings');
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
    expect(markup).toContain(locale === 'ko' ? '호스트 기본값 사용' : 'Use host defaults');
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
        'Use host defaults',
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
