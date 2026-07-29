import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  createActivitySessionState,
  selectSidePanel,
  transitionActivityDestination,
} from '../shared/editor/activityState';
import { ActivityBar } from '../shared/editor/components/ActivityBar';
import { ViewControlPanel } from '../shared/editor/components/ViewControlPanel';
import {
  applyHeadingPalette,
  DocumentSettingsPanel,
  getHeadingPalette,
  removeDocumentSettings,
} from '../shared/editor/components/DocumentSettingsPanel';
import { EditorProvider } from '../shared/editor/context/EditorContext';

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
    expect(state.selection).toEqual({ destination: 'design', tab: 'view' });

    state = transitionActivityDestination(state, 'navigate', { showTemplates: true });
    expect(state.selection).toEqual({ destination: 'navigate', tab: 'figures' });

    state = transitionActivityDestination(state, 'navigate', { showTemplates: true });
    expect(state.selection).toBeNull();
    expect(state.lastChildTabs.navigate).toBe('figures');
  });

  it('keeps unavailable workspace and template destinations out of session state', () => {
    let state = createActivitySessionState(null);
    expect(transitionActivityDestination(state, 'workspace')).toBe(state);

    state = selectSidePanel(
      state,
      { destination: 'publish', tab: 'templates' },
      { showTemplates: true },
    );
    state = selectSidePanel(state, null);
    state = transitionActivityDestination(state, 'publish');
    expect(state.selection).toEqual({ destination: 'publish', tab: 'export' });
  });

  it('renders three shared hubs and an optional workspace hub', () => {
    const sharedMarkup = renderToStaticMarkup(
      <ActivityBar activeDestination="design" onDestinationClick={vi.fn()} />,
    );
    const workspaceMarkup = renderToStaticMarkup(
      <ActivityBar
        activeDestination="workspace"
        onDestinationClick={vi.fn()}
        showWorkspace
      />,
    );

    expect(sharedMarkup.match(/class="activity-bar-icon/g)).toHaveLength(3);
    expect(sharedMarkup).toContain('Navigate');
    expect(sharedMarkup).toContain('Design');
    expect(sharedMarkup).toContain('Publish');
    expect(sharedMarkup).not.toContain('Workspace');
    expect(workspaceMarkup.match(/class="activity-bar-icon/g)).toHaveLength(4);
    expect(workspaceMarkup).toContain('Workspace');
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
    expect(settingsMarkup).toContain('Advanced heading colors');
    expect(settingsMarkup).toContain('aria-expanded="false"');
    expect(settingsMarkup).toContain('Use host defaults');
    expect(settingsMarkup).toContain('Reset all document settings');
    expect(exportMarkup).toContain('Export options');
    expect(exportMarkup).not.toContain('Document appearance');
  });
});
