import { CodeBlock, type CodeBlockOptions } from '@tiptap/extension-code-block';
import { all, createLowlight } from 'lowlight';
import type { EditorExtensionRuntime } from '../extensionRuntime';
import {
  acquireCodeBlockLanguageController,
  codeBlockLanguageLabel,
  readCodeBlockLanguageUiCounters,
  recordCodeBlockLanguageTriggerCreated,
  recordCodeBlockLanguageTriggerDestroyed,
} from './CodeBlockLanguageController';
import {
  createOptimizedLowlightPlugin,
  type LowlightLike,
} from './optimizedLowlightPlugin';

export { readCodeBlockLanguageUiCounters };
export { resetCodeBlockLanguageOperationCounters } from './CodeBlockLanguageController';

const lowlight = createLowlight(all);

interface CustomCodeBlockOptions extends CodeBlockOptions {
  lowlight: LowlightLike;
  runtime?: EditorExtensionRuntime;
}

export const CustomCodeBlock = CodeBlock.extend<CustomCodeBlockOptions>({
  addOptions() {
    const parent = this.parent?.();
    if (!parent) throw new Error('CodeBlock parent options are unavailable');
    return {
      ...parent,
      lowlight,
    };
  },
  addNodeView() {
    const options = this.options;
    return ({ node, view, editor }) => {
      let currentNode = node;
      let destroyed = false;
      const translate = options.runtime?.translate;
      if (!translate) throw new Error('CodeBlock runtime translator is unavailable');
      const autoLabel = translate('code.languageAuto');
      const languageAriaLabel = translate('diagram.language');
      const acquired = acquireCodeBlockLanguageController(
        editor,
        view,
        options.lowlight.listLanguages(),
        autoLabel,
        languageAriaLabel,
      );

      const dom = document.createElement('div');
      dom.className = 'code-block';

      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'code-block-language-trigger';
      trigger.contentEditable = 'false';
      trigger.setAttribute('aria-haspopup', 'listbox');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.setAttribute('aria-controls', acquired.controller.popupId);

      const pre = document.createElement('pre');
      pre.spellcheck = false;
      const contentDOM = document.createElement('code');
      contentDOM.spellcheck = false;
      pre.appendChild(contentDOM);
      dom.appendChild(trigger);
      dom.appendChild(pre);

      const syncTrigger = (): void => {
        const language = currentNode.attrs.language;
        const label = codeBlockLanguageLabel(language, autoLabel);
        const editable = editor.isEditable;
        dom.dataset.language = typeof language === 'string' ? language : '';
        dom.dataset.languageKind = typeof language === 'string' ? 'string' : 'auto';
        trigger.textContent = label;
        trigger.setAttribute('aria-label', `${languageAriaLabel}: ${label}`);
        trigger.setAttribute('aria-disabled', String(!editable));
        if (!editable) acquired.controller.close(true);
      };

      recordCodeBlockLanguageTriggerCreated();
      syncTrigger();

      return {
        dom,
        contentDOM,
        update(updatedNode) {
          if (updatedNode.type !== currentNode.type) return false;
          currentNode = updatedNode;
          syncTrigger();
          acquired.controller.sync(trigger, updatedNode);
          return true;
        },
        stopEvent(event) {
          return event.target instanceof dom.ownerDocument.defaultView!.Node
            && trigger.contains(event.target);
        },
        ignoreMutation(mutation) {
          return 'target' in mutation
            && mutation.target instanceof dom.ownerDocument.defaultView!.Node
            && trigger.contains(mutation.target);
        },
        destroy() {
          if (destroyed) return;
          destroyed = true;
          acquired.controller.unregister(trigger);
          acquired.release();
          recordCodeBlockLanguageTriggerDestroyed();
        },
      };
    };
  },
  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      createOptimizedLowlightPlugin({
        name: this.name,
        lowlight: this.options.lowlight,
        defaultLanguage: this.options.defaultLanguage,
      }),
    ];
  },
});
