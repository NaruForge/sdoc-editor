import { describe, expect, it } from 'vitest';
import {
  hasAppliedEditorStyles,
  type EditorStyleProbe,
} from '../webview-ui/src/styleReadiness';

const appliedStyles: EditorStyleProbe = {
  shellDisplay: 'flex',
  shellFlexDirection: 'column',
  toolbarDisplay: 'flex',
  activityBarDisplay: 'flex',
  proseMirrorPaddingTop: '16px',
};

describe('editor style readiness', () => {
  it('accepts the built editor layout contract', () => {
    expect(hasAppliedEditorStyles(appliedStyles)).toBe(true);
  });

  it.each([
    ['shell display', { shellDisplay: 'block' }],
    ['shell direction', { shellFlexDirection: 'row' }],
    ['toolbar layout', { toolbarDisplay: 'block' }],
    ['activity layout', { activityBarDisplay: 'block' }],
    ['document padding', { proseMirrorPaddingTop: '0px' }],
  ])('rejects missing %s CSS', (_label, override) => {
    expect(hasAppliedEditorStyles({ ...appliedStyles, ...override })).toBe(false);
  });
});
