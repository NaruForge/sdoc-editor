import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiagramRenderIntentStore } from '../shared/editor/diagram/DiagramRenderIntentStore';
import { DiagramBlock } from '../shared/editor/extensions/DiagramBlock';
import {
  NOOP_EDITOR_EXTENSION_RUNTIME,
  type EditorExtensionRuntime,
} from '../shared/editor/extensionRuntime';

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly dataset: Record<string, string> = {};
  readonly style: Record<string, string> = {};
  readonly classList = { add: (...names: string[]) => names.forEach((name) => {
    this.className = [this.className, name].filter(Boolean).join(' ');
  }) };
  className = '';
  textContent = '';
  title = '';
  src = '';
  alt = '';
  innerHTML = '';

  constructor(readonly tagName: string) {}

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children.splice(0, this.children.length, ...children);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  addEventListener(): void {}
}

interface DiagramStorage {
  renderIntents: DiagramRenderIntentStore;
}

interface DiagramExtensionContext {
  name: string;
  options: { runtime: EditorExtensionRuntime };
  storage: DiagramStorage;
}

type InsertDiagramCommand = (
  language: string,
  code: string,
  renderAfterInsert?: boolean,
) => (props: {
  commands: { insertContent: (content: unknown) => boolean };
}) => boolean;

type DiagramNodeViewFactory = (props: {
  node: { attrs: { language: string; code: string }; type: { name: string } };
  getPos: () => number;
}) => { dom: FakeElement; destroy: () => void };

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function createExtensionHarness(renderDiagram: EditorExtensionRuntime['renderDiagram']) {
  const storage: DiagramStorage = { renderIntents: new DiagramRenderIntentStore() };
  const context: DiagramExtensionContext = {
    name: 'diagram',
    options: {
      runtime: { ...NOOP_EDITOR_EXTENSION_RUNTIME, renderDiagram },
    },
    storage,
  };
  const addCommands = DiagramBlock.config.addCommands as unknown as (
    this: DiagramExtensionContext,
  ) => { insertDiagram: InsertDiagramCommand };
  const addNodeView = DiagramBlock.config.addNodeView as unknown as (
    this: DiagramExtensionContext,
  ) => DiagramNodeViewFactory;
  return {
    insertDiagram: addCommands.call(context).insertDiagram,
    createNodeView: addNodeView.call(context),
  };
}

function installFakeDocument(): void {
  vi.stubGlobal('document', {
    createElement: (tagName: string) => new FakeElement(tagName),
  });
}

describe('DiagramRenderIntentStore', () => {
  it('keeps passive external diagrams blocked', () => {
    const intents = new DiagramRenderIntentStore();

    expect(intents.consume('d2', 'a -> b')).toBe(false);
  });

  it('carries one explicit insertion interaction into exactly one matching NodeView', () => {
    const intents = new DiagramRenderIntentStore();

    intents.mark('D2', 'a -> b');

    expect(intents.consume('d2', 'other')).toBe(false);
    expect(intents.consume('d2', 'a -> b')).toBe(true);
    expect(intents.consume('d2', 'a -> b')).toBe(false);
  });

  it('renders an explicitly inserted D2 node once while passive hydration stays source-only', async () => {
    vi.useFakeTimers();
    installFakeDocument();
    const renderDiagram = vi.fn(async () => ({
      kind: 'image' as const,
      dataUrl: 'data:image/svg+xml;base64,PHN2ZyB2aWV3Qm94PSIwIDAgMSAxIj48L3N2Zz4=',
      width: 320,
      height: 180,
    }));
    const explicit = createExtensionHarness(renderDiagram);
    const insertedContent = vi.fn(() => true);

    expect(explicit.insertDiagram('d2', 'a -> b', true)({
      commands: { insertContent: insertedContent },
    })).toBe(true);
    expect(insertedContent).toHaveBeenCalledWith({
      type: 'diagram',
      attrs: { language: 'd2', code: 'a -> b' },
    });

    const explicitView = explicit.createNodeView({
      node: { attrs: { language: 'd2', code: 'a -> b' }, type: { name: 'diagram' } },
      getPos: () => 0,
    });
    await vi.advanceTimersByTimeAsync(500);

    expect(renderDiagram).toHaveBeenCalledOnce();
    const rendered = explicitView.dom.children[1];
    expect(rendered.children[0]).toMatchObject({
      tagName: 'img',
      src: expect.stringMatching(/^data:image\/svg\+xml;base64,/),
      alt: 'd2 diagram',
    });
    expect(rendered.children[0].attributes).toEqual(new Map([
      ['width', '320'],
      ['height', '180'],
    ]));

    const passiveRenderer = vi.fn(async () => ({
      kind: 'image' as const,
      dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+',
      width: 1,
      height: 1,
    }));
    const passive = createExtensionHarness(passiveRenderer);
    const passiveView = passive.createNodeView({
      node: { attrs: { language: 'd2', code: 'a -> b' }, type: { name: 'diagram' } },
      getPos: () => 0,
    });
    await vi.runAllTimersAsync();

    expect(passiveRenderer).not.toHaveBeenCalled();
    expect(passiveView.dom.children[1].children[0].children[0].textContent)
      .toContain('unavailable');

    explicitView.destroy();
    passiveView.destroy();
  });
});
