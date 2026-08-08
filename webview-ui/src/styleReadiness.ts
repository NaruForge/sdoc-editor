export interface EditorStyleProbe {
  shellDisplay: string;
  shellFlexDirection: string;
  toolbarDisplay: string;
  activityBarDisplay: string;
  proseMirrorPaddingTop: string;
}

export function collectEditorStyleProbe(elements: {
  shell: HTMLElement;
  toolbar: HTMLElement;
  activityBar: HTMLElement;
  proseMirror: HTMLElement;
}): EditorStyleProbe {
  const shell = window.getComputedStyle(elements.shell);
  return {
    shellDisplay: shell.display,
    shellFlexDirection: shell.flexDirection,
    toolbarDisplay: window.getComputedStyle(elements.toolbar).display,
    activityBarDisplay: window.getComputedStyle(elements.activityBar).display,
    proseMirrorPaddingTop: window.getComputedStyle(elements.proseMirror).paddingTop,
  };
}

export function hasAppliedEditorStyles(probe: EditorStyleProbe): boolean {
  return probe.shellDisplay === 'flex'
    && probe.shellFlexDirection === 'column'
    && probe.toolbarDisplay === 'flex'
    && probe.activityBarDisplay === 'flex'
    && Number.parseFloat(probe.proseMirrorPaddingTop) > 0;
}
