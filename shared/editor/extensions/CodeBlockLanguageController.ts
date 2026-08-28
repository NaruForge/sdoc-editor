import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';

export interface CodeBlockLanguageChoice {
  readonly key: string;
  readonly label: string;
  readonly value: string | null;
}

export const codeBlockLanguageLabel = (value: unknown, autoLabel: string): string => {
  if (typeof value !== 'string') return autoLabel;
  return value.length === 0 ? '""' : value;
};

export const createCodeBlockLanguageChoices = (
  currentLanguage: unknown,
  supportedLanguages: readonly string[],
  autoLabel = 'Auto detect',
): readonly CodeBlockLanguageChoice[] => {
  const current = typeof currentLanguage === 'string' ? currentLanguage : null;
  const values: Array<string | null> = [null];
  if (current !== null && !supportedLanguages.includes(current)) values.push(current);
  values.push(...supportedLanguages);
  return values.map((value, index) => ({
    key: `language-choice-${index}`,
    label: codeBlockLanguageLabel(value, autoLabel),
    value,
  }));
};

interface RegistryEntry<Controller> {
  controller: Controller;
  references: number;
}

export class EditorScopedControllerRegistry<Owner extends object, Controller extends {
  destroy(): void;
}> {
  private readonly entries = new WeakMap<Owner, RegistryEntry<Controller>>();

  acquire(owner: Owner, create: () => Controller): { controller: Controller; release(): void } {
    let entry = this.entries.get(owner);
    if (!entry) {
      entry = { controller: create(), references: 0 };
      this.entries.set(owner, entry);
    }
    entry.references += 1;
    let released = false;
    return {
      controller: entry.controller,
      release: () => {
        if (released) return;
        released = true;
        const liveEntry = this.entries.get(owner);
        if (liveEntry !== entry) return;
        liveEntry.references -= 1;
        if (liveEntry.references > 0) return;
        this.entries.delete(owner);
        liveEntry.controller.destroy();
      },
    };
  }
}

export interface CodeBlockLanguageOwner {
  readonly trigger: HTMLButtonElement;
  readonly wrapper: HTMLElement;
  readonly position: number;
  readonly node: ProseMirrorNode;
}

export const resolveCodeBlockOwner = (
  view: EditorView,
  trigger: HTMLButtonElement,
): CodeBlockLanguageOwner | undefined => {
  mutableCounters().resolverOperations += 1;
  const wrapper = trigger.closest<HTMLElement>('.code-block');
  if (!wrapper || !trigger.isConnected || !view.dom.contains(wrapper)) return undefined;
  const candidates = new Set<number>();
  for (const dom of [wrapper, trigger]) {
    for (const offset of new Set([0, dom.childNodes.length])) {
      for (const bias of [-1, 1]) {
      try {
        const position = view.posAtDOM(dom, offset, bias);
        for (const candidate of [position, position - 1, position + 1]) {
          if (candidate >= 0 && candidate <= view.state.doc.content.size) candidates.add(candidate);
        }
      } catch { /* fail closed */ }
      }
    }
  }
  const matches: Array<{ position: number; node: ProseMirrorNode }> = [];
  for (const position of candidates) {
    const node = view.state.doc.nodeAt(position);
    if (node?.type.name !== 'codeBlock') continue;
    if (view.nodeDOM(position) !== wrapper) continue;
    matches.push({ position, node });
  }
  if (matches.length !== 1) return undefined;
  const [{ position, node }] = matches;
  return { trigger, wrapper, position, node };
};

export interface CodeBlockLanguageUiCounters {
  readonly triggersCreated: number;
  readonly triggersCurrent: number;
  readonly triggersMaximum: number;
  readonly triggersDestroyed: number;
  readonly controllersCreated: number;
  readonly controllersCurrent: number;
  readonly controllersMaximum: number;
  readonly controllersDestroyed: number;
  readonly popupsCreated: number;
  readonly popupsCurrent: number;
  readonly popupsMaximum: number;
  readonly popupsDestroyed: number;
  readonly resolverOperations: number;
  readonly optionMaterializationOperations: number;
  readonly geometryOperations: number;
  readonly ownerScanOperations: number;
}

const counters: CodeBlockLanguageUiCounters = {
  triggersCreated: 0,
  triggersCurrent: 0,
  triggersMaximum: 0,
  triggersDestroyed: 0,
  controllersCreated: 0,
  controllersCurrent: 0,
  controllersMaximum: 0,
  controllersDestroyed: 0,
  popupsCreated: 0,
  popupsCurrent: 0,
  popupsMaximum: 0,
  popupsDestroyed: 0,
  resolverOperations: 0,
  optionMaterializationOperations: 0,
  geometryOperations: 0,
  ownerScanOperations: 0,
};

const mutableCounters = (): { -readonly [Key in keyof CodeBlockLanguageUiCounters]: number } =>
  counters as { -readonly [Key in keyof CodeBlockLanguageUiCounters]: number };

export const readCodeBlockLanguageUiCounters = (): CodeBlockLanguageUiCounters => ({ ...counters });

export const resetCodeBlockLanguageOperationCounters = (): void => {
  const live = mutableCounters();
  live.resolverOperations = 0;
  live.optionMaterializationOperations = 0;
  live.geometryOperations = 0;
  live.ownerScanOperations = 0;
};

export const recordCodeBlockLanguageTriggerCreated = (): void => {
  const live = mutableCounters();
  live.triggersCreated += 1;
  live.triggersCurrent += 1;
  live.triggersMaximum = Math.max(live.triggersMaximum, live.triggersCurrent);
};

export const recordCodeBlockLanguageTriggerDestroyed = (): void => {
  const live = mutableCounters();
  live.triggersDestroyed += 1;
  live.triggersCurrent -= 1;
};

let popupSequence = 0;

interface ActiveSession extends CodeBlockLanguageOwner {
  readonly generation: number;
  readonly openingAttrs: Readonly<Record<string, unknown>>;
  readonly openingLanguage: string | null;
}

export class CodeBlockLanguageController {
  private readonly popup: HTMLDivElement;
  private readonly select: HTMLSelectElement;
  private activeOwner: ActiveSession | undefined;
  private activeChoices: readonly CodeBlockLanguageChoice[] = [];
  private readonly editableObserver: MutationObserver | undefined;
  private destroyed = false;
  private composing = false;
  private geometryFrame: number | undefined;
  private generation = 0;
  private pointerOpeningIndex = -1;

  public constructor(
    private readonly editor: Editor,
    private readonly view: EditorView,
    private readonly languages: readonly string[],
    private readonly autoLabel: string,
    languageAriaLabel: string,
  ) {
    const ownerDocument = view.dom.ownerDocument;
    this.popup = ownerDocument.createElement('div');
    this.popup.id = `code-block-language-popup-${++popupSequence}`;
    this.popup.className = 'code-block-language-popup';
    this.popup.hidden = true;
    this.popup.setAttribute('contenteditable', 'false');
    this.select = ownerDocument.createElement('select');
    this.select.size = 12;
    this.select.setAttribute('aria-label', languageAriaLabel);
    this.popup.appendChild(this.select);
    const overlayRoot = view.root instanceof ShadowRoot ? view.root : ownerDocument.body;
    overlayRoot.appendChild(this.popup);

    this.select.addEventListener('keydown', this.onSelectKeyDown);
    this.select.addEventListener('compositionstart', this.onCompositionStart);
    this.select.addEventListener('compositionend', this.onCompositionEnd);
    this.select.addEventListener('pointerdown', this.onSelectPointerDown);
    this.select.addEventListener('pointerup', this.onSelectPointerUp);
    ownerDocument.addEventListener('click', this.onEditorClick, true);
    ownerDocument.addEventListener('keydown', this.onEditorKeyDown, true);
    ownerDocument.addEventListener('pointerdown', this.onDocumentPointerDown, true);
    ownerDocument.defaultView?.addEventListener('resize', this.scheduleGeometry);
    ownerDocument.defaultView?.addEventListener('scroll', this.scheduleGeometry, true);
    ownerDocument.defaultView?.visualViewport?.addEventListener('resize', this.scheduleGeometry);
    ownerDocument.defaultView?.visualViewport?.addEventListener('scroll', this.scheduleGeometry);
    ownerDocument.defaultView?.addEventListener('beforeprint', this.onBeforePrint);
    const MutationObserverType = ownerDocument.defaultView?.MutationObserver;
    this.editableObserver = MutationObserverType
      ? new MutationObserverType(() => this.syncEditableState())
      : undefined;
    this.editableObserver?.observe(view.dom, {
      attributes: true,
      attributeFilter: ['contenteditable'],
      childList: true,
      subtree: true,
    });

    const live = mutableCounters();
    live.controllersCreated += 1;
    live.controllersCurrent += 1;
    live.controllersMaximum = Math.max(live.controllersMaximum, live.controllersCurrent);
    live.popupsCreated += 1;
    live.popupsCurrent += 1;
    live.popupsMaximum = Math.max(live.popupsMaximum, live.popupsCurrent);
  }

  public get popupId(): string {
    return this.popup.id;
  }

  public get isOpen(): boolean {
    return !this.popup.hidden;
  }

  public open(owner: CodeBlockLanguageOwner): void {
    this.popup.dataset.openResult = 'attempted';
    if (!this.editor.isEditable || this.destroyed) {
      this.popup.dataset.openResult = 'rejected-stale-owner';
      this.close(false);
      return;
    }
    if (this.activeOwner) {
      this.activeOwner.trigger.setAttribute('aria-expanded', 'false');
    }
    this.generation += 1;
    const openingLanguage = typeof owner.node.attrs.language === 'string'
      ? owner.node.attrs.language
      : null;
    this.activeOwner = {
      ...owner,
      generation: this.generation,
      openingAttrs: { ...owner.node.attrs },
      openingLanguage,
    };
    this.activeChoices = createCodeBlockLanguageChoices(
      owner.node.attrs.language,
      this.languages,
      this.autoLabel,
    );
    const options = this.activeChoices.map((choice) => {
      const option = this.select.ownerDocument.createElement('option');
      option.value = choice.key;
      option.textContent = choice.label;
      if (choice.value === '') option.dataset.languageEmpty = 'true';
      return option;
    });
    mutableCounters().optionMaterializationOperations += options.length;
    this.select.replaceChildren(...options);
    const selectedIndex = this.activeChoices.findIndex(({ value }) =>
      value === openingLanguage);
    this.select.selectedIndex = Math.max(0, selectedIndex);
    this.select.size = Math.min(12, Math.max(2, options.length));
    this.popup.hidden = false;
    this.popup.dataset.openResult = 'opened';
    owner.trigger.setAttribute('aria-expanded', 'true');
    this.updateGeometry();
    this.select.focus({ preventScroll: true });
  }

  public sync(trigger: HTMLButtonElement, updatedNode: ProseMirrorNode): void {
    if (this.activeOwner?.trigger !== trigger) return;
    if (this.activeOwner.node !== updatedNode) {
      this.close(true);
      return;
    }
    const owner = this.resolveActiveOwner();
    if (!owner) {
      this.close(true);
      return;
    }
    const selectedIndex = this.activeChoices.findIndex(({ value }) =>
      value === (typeof owner.node.attrs.language === 'string' ? owner.node.attrs.language : null));
    if (selectedIndex < 0) this.close(false);
    else this.select.selectedIndex = selectedIndex;
  }

  public unregister(trigger: HTMLButtonElement): void {
    if (this.activeOwner?.trigger === trigger) this.close(true);
  }

  private ownerFromEvent(event: Event): CodeBlockLanguageOwner | undefined {
    const target = event.target;
    const ownerWindow = this.view.dom.ownerDocument.defaultView;
    if (!ownerWindow || !(target instanceof ownerWindow.Element)) return undefined;
    const trigger = target.closest<HTMLButtonElement>('.code-block-language-trigger');
    return trigger ? resolveCodeBlockOwner(this.view, trigger) : undefined;
  }

  private activate(owner: CodeBlockLanguageOwner, reason: string): void {
    owner.trigger.dataset.activationResult = reason;
    this.open(owner);
  }

  private readonly onEditorClick = (event: MouseEvent): void => {
    const owner = this.ownerFromEvent(event);
    if (!owner) return;
    event.preventDefault();
    event.stopPropagation();
    this.activate(owner, 'click');
  };

  private readonly onEditorKeyDown = (event: KeyboardEvent): void => {
    const owner = this.ownerFromEvent(event);
    if (!owner) return;
    const reason = event.key === 'Enter'
      ? 'enter'
      : event.key === ' '
        ? 'space'
        : event.altKey && event.key === 'ArrowDown'
          ? 'alt-arrow-down'
          : undefined;
    if (!reason) return;
    event.preventDefault();
    event.stopPropagation();
    this.activate(owner, reason);
  };

  private syncEditableState(): void {
    if (!this.editor.isEditable
      || (this.activeOwner && !this.resolveActiveOwner())) this.close(true);
    const expectedDisabled = String(!this.editor.isEditable);
    const firstTrigger = this.view.dom.querySelector<HTMLButtonElement>(
      '.code-block-language-trigger',
    );
    if (!firstTrigger || firstTrigger.getAttribute('aria-disabled') === expectedDisabled) return;
    for (const trigger of this.view.dom.querySelectorAll<HTMLButtonElement>('.code-block-language-trigger')) {
      mutableCounters().ownerScanOperations += 1;
      trigger.setAttribute('aria-disabled', expectedDisabled);
    }
  }

  public close(returnFocus: boolean): void {
    const owner = this.activeOwner;
    this.activeOwner = undefined;
    this.generation += 1;
    this.activeChoices = [];
    this.popup.hidden = true;
    owner?.trigger.setAttribute('aria-expanded', 'false');
    if (returnFocus && owner?.trigger.isConnected) {
      const ownerDocument = owner.trigger.ownerDocument;
      const suppressEditorFocus = (event: FocusEvent): void => {
        if (event.target === owner.trigger) event.stopImmediatePropagation();
      };
      ownerDocument.addEventListener('focus', suppressEditorFocus, true);
      owner.trigger.focus({ preventScroll: true });
      ownerDocument.removeEventListener('focus', suppressEditorFocus, true);
    }
  }

  private resolveActiveOwner(): CodeBlockLanguageOwner | undefined {
    const active = this.activeOwner;
    if (!active || this.destroyed || !this.editor.isEditable || this.view.composing) return undefined;
    const fresh = resolveCodeBlockOwner(this.view, active.trigger);
    if (!fresh || fresh.wrapper !== active.wrapper || active.generation !== this.generation) return undefined;
    if (fresh.node !== active.node || fresh.node.type !== active.node.type) return undefined;
    const language = typeof fresh.node.attrs.language === 'string' ? fresh.node.attrs.language : null;
    if (language !== active.openingLanguage) return undefined;
    for (const [key, value] of Object.entries(active.openingAttrs)) {
      if (key !== 'language' && fresh.node.attrs[key] !== value) return undefined;
    }
    return fresh;
  }

  private commit(): void {
    const owner = this.activeOwner;
    const choice = this.activeChoices[this.select.selectedIndex];
    if (!owner || !choice) {
      this.close(false);
      return;
    }
    const fresh = this.resolveActiveOwner();
    if (!fresh) {
      this.close(true);
      return;
    }
    const currentLanguage = typeof fresh.node.attrs.language === 'string'
      ? fresh.node.attrs.language
      : null;
    if (currentLanguage === choice.value) {
      this.close(true);
      return;
    }
    this.view.dispatch(this.view.state.tr.setNodeMarkup(fresh.position, undefined, {
      ...fresh.node.attrs,
      language: choice.value,
    }));
    this.close(true);
  }

  private readonly onSelectKeyDown = (event: KeyboardEvent): void => {
    if (event.isComposing || this.composing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      this.commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.close(true);
    } else if (event.key === 'Tab') {
      event.preventDefault();
      this.close(true);
    }
  };

  private readonly onCompositionStart = (): void => { this.composing = true; };
  private readonly onCompositionEnd = (): void => { this.composing = false; };
  private readonly onSelectPointerDown = (): void => {
    this.pointerOpeningIndex = this.select.selectedIndex;
  };
  private readonly onSelectPointerUp = (): void => {
    if (this.select.selectedIndex !== this.pointerOpeningIndex) this.commit();
    this.pointerOpeningIndex = -1;
  };

  private readonly onDocumentPointerDown = (event: PointerEvent): void => {
    if (this.popup.hidden) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (this.popup.contains(target) || this.activeOwner?.trigger.contains(target)) return;
    this.close(false);
  };

  private readonly onBeforePrint = (): void => this.close(true);

  private readonly scheduleGeometry = (): void => {
    if (this.popup.hidden || this.geometryFrame !== undefined) return;
    const ownerWindow = this.view.dom.ownerDocument.defaultView;
    if (!ownerWindow) return;
    this.geometryFrame = ownerWindow.requestAnimationFrame(() => {
      this.geometryFrame = undefined;
      this.updateGeometry();
    });
  };

  private updateGeometry(): void {
    mutableCounters().geometryOperations += 1;
    const trigger = this.activeOwner?.trigger;
    const ownerWindow = this.view.dom.ownerDocument.defaultView;
    if (!trigger || !ownerWindow) return;
    const viewport = ownerWindow.visualViewport;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportWidth = viewport?.width ?? ownerWindow.innerWidth;
    const viewportHeight = viewport?.height ?? ownerWindow.innerHeight;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(Math.max(220, rect.width), Math.max(160, viewportWidth - 16));
    const left = Math.min(
      Math.max(viewportLeft + 8, rect.right - width),
      viewportLeft + viewportWidth - width - 8,
    );
    const estimatedHeight = Math.min(320, viewportHeight - 16);
    const fitsBelow = rect.bottom + estimatedHeight <= viewportTop + viewportHeight - 8;
    const top = fitsBelow
      ? rect.bottom + 4
      : Math.max(viewportTop + 8, rect.top - estimatedHeight - 4);
    Object.assign(this.popup.style, {
      position: 'fixed',
      left: `${Math.round(left)}px`,
      top: `${Math.round(top)}px`,
      width: `${Math.round(width)}px`,
      maxHeight: `${Math.round(estimatedHeight)}px`,
      zIndex: '1000',
    });
    this.select.style.width = '100%';
    this.select.style.maxHeight = `${Math.round(estimatedHeight)}px`;
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.close(false);
    const ownerWindow = this.view.dom.ownerDocument.defaultView;
    if (this.geometryFrame !== undefined) ownerWindow?.cancelAnimationFrame(this.geometryFrame);
    this.select.removeEventListener('keydown', this.onSelectKeyDown);
    this.select.removeEventListener('compositionstart', this.onCompositionStart);
    this.select.removeEventListener('compositionend', this.onCompositionEnd);
    this.select.removeEventListener('pointerdown', this.onSelectPointerDown);
    this.select.removeEventListener('pointerup', this.onSelectPointerUp);
    this.view.dom.ownerDocument.removeEventListener('click', this.onEditorClick, true);
    this.view.dom.ownerDocument.removeEventListener('keydown', this.onEditorKeyDown, true);
    this.view.dom.ownerDocument.removeEventListener('pointerdown', this.onDocumentPointerDown, true);
    ownerWindow?.removeEventListener('resize', this.scheduleGeometry);
    ownerWindow?.removeEventListener('scroll', this.scheduleGeometry, true);
    ownerWindow?.visualViewport?.removeEventListener('resize', this.scheduleGeometry);
    ownerWindow?.visualViewport?.removeEventListener('scroll', this.scheduleGeometry);
    ownerWindow?.removeEventListener('beforeprint', this.onBeforePrint);
    this.editableObserver?.disconnect();
    this.popup.remove();
    const live = mutableCounters();
    live.controllersDestroyed += 1;
    live.controllersCurrent -= 1;
    live.popupsDestroyed += 1;
    live.popupsCurrent -= 1;
  }
}

const controllerRegistry = new EditorScopedControllerRegistry<Editor, CodeBlockLanguageController>();

export const acquireCodeBlockLanguageController = (
  editor: Editor,
  view: EditorView,
  languages: readonly string[],
  autoLabel: string,
  languageAriaLabel: string,
): { controller: CodeBlockLanguageController; release(): void } => controllerRegistry.acquire(
  editor,
  () => new CodeBlockLanguageController(editor, view, languages, autoLabel, languageAriaLabel),
);
