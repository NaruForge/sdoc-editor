import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { SIDE_PANEL_TAB_CONTENT_ID } from '../../../shared/editor/components/SidePanelTabPanel';

type Theme = 'light' | 'dark' | 'hc';
type Locale = 'ko' | 'en';
type Scene = 'editor' | 'settings' | 'templates' | 'files' | 'book' | 'diagram-error' | 'external-change' | 'invalid-document' | 'interactions';

interface FixtureOptions {
  width: number;
  height?: number;
  theme?: Theme;
  locale?: Locale;
  scene?: Scene;
  columns?: number;
  panel?: boolean;
  operation?: 'idle' | 'running' | 'failed' | 'succeeded-export' | 'succeeded-import';
}

async function openFixture(page: Page, {
  width,
  height = 800,
  theme = 'light',
  locale = 'ko',
  scene = 'editor',
  columns = 8,
  panel = false,
  operation = 'idle',
}: FixtureOptions): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.goto(`/?theme=${theme}&locale=${locale}&scene=${scene}&columns=${columns}&panel=${panel ? '1' : '0'}&operation=${operation}`);
  await page.locator('.quality-harness[data-ready="true"]').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({
    content: '*, *::before, *::after { animation: none !important; transition: none !important; }',
  });
  await page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

test.describe('responsive toolbar contract', () => {
  for (const width of [320, 480, 768, 1024, 1280]) {
    test(`${width}px keeps every visible action inside one toolbar row`, async ({ page }) => {
      await openFixture(page, { width });
      const toolbar = page.getByRole('toolbar');
      await expect(toolbar).toBeVisible();

      const toolbarBox = await toolbar.boundingBox();
      expect(toolbarBox).not.toBeNull();
      expect(toolbarBox!.height).toBeLessThanOrEqual(42);

      const visibleControls = toolbar.locator('button:visible');
      const count = await visibleControls.count();
      expect(count).toBeGreaterThan(0);
      for (let index = 0; index < count; index += 1) {
        const box = await visibleControls.nth(index).boundingBox();
        expect(box, `toolbar control ${index} has a layout box`).not.toBeNull();
        expect(box!.y).toBeGreaterThanOrEqual(toolbarBox!.y - 1);
        expect(box!.y + box!.height).toBeLessThanOrEqual(toolbarBox!.y + toolbarBox!.height + 1);
        expect(box!.x).toBeGreaterThanOrEqual(toolbarBox!.x - 1);
        expect(box!.x + box!.width).toBeLessThanOrEqual(toolbarBox!.x + toolbarBox!.width + 1);
      }
    });
  }

  test('overflow is keyboard-operable and restores focus', async ({ page }) => {
    await openFixture(page, { width: 320 });
    const trigger = page.getByRole('button', { name: /도구 모음 더보기|More toolbar actions/i });
    await expect(trigger).toBeVisible();
    await trigger.focus();
    await page.keyboard.press('Enter');

    const menu = page.getByRole('menu', { name: /도구 모음 더보기|More toolbar actions/i });
    await expect(menu).toBeVisible();
    const items = menu.getByRole('menuitem');
    expect(await items.count()).toBeGreaterThan(0);
    await expect(items.first()).toBeFocused();

    if (await items.count() > 1) {
      await page.keyboard.press('ArrowDown');
      await expect(items.nth(1)).toBeFocused();
    }
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('visible and overflow actions are not lost or duplicated after resize', async ({ page }) => {
    await openFixture(page, { width: 1280 });
    const toolbar = page.getByRole('toolbar');
    const wideLabels = unique(await toolbar.locator('button:visible').evaluateAll(buttons =>
      buttons.map(button => button.getAttribute('aria-label') ?? '').filter(Boolean)));
    expect(wideLabels.length).toBeGreaterThan(10);

    await page.setViewportSize({ width: 320, height: 800 });
    const trigger = page.getByRole('button', { name: /도구 모음 더보기|More toolbar actions/i });
    await expect(trigger).toBeVisible();
    const narrowVisibleLabels = unique(await toolbar.locator('button:visible').evaluateAll(buttons =>
      buttons.map(button => button.getAttribute('aria-label') ?? '').filter(Boolean)));
    await trigger.click();
    const overflowGroups = page.getByRole('menu', { name: /도구 모음 더보기|More toolbar actions/i });
    const overflowLabels = unique(await overflowGroups.getByRole('menuitem').evaluateAll(items =>
      items.map(item => item.getAttribute('aria-label') ?? item.textContent?.trim() ?? '').filter(Boolean)));

    expect(narrowVisibleLabels.length).toBe(new Set(narrowVisibleLabels).size);
    expect(overflowLabels.length).toBe(new Set(overflowLabels).size);
    expect(overflowLabels.length).toBeGreaterThan(0);
    expect(narrowVisibleLabels).toContainEqual(expect.stringMatching(/도구 모음 더보기|More toolbar actions/i));

    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(trigger).toBeHidden();
    const restoredLabels = unique(await toolbar.locator('button:visible').evaluateAll(buttons =>
      buttons.map(button => button.getAttribute('aria-label') ?? '').filter(Boolean)));
    expect(restoredLabels).toEqual(wideLabels);
  });

  test('insert submenus support arrow navigation and restore focus', async ({ page }) => {
    await openFixture(page, { width: 1280, locale: 'en' });
    const trigger = page.getByRole('button', { name: 'Insert', exact: true });
    await trigger.focus();
    await page.keyboard.press('Enter');

    const insertMenu = page.getByRole('menu', { name: 'Insert', exact: true });
    await expect(insertMenu).toBeVisible();
    await expect(insertMenu.getByRole('textbox', { name: /Search insert items/ })).toBeFocused();

    await page.keyboard.press('ArrowDown');
    const tableTrigger = insertMenu.getByRole('menuitem', { name: 'Table', exact: true });
    await expect(tableTrigger).toBeFocused();
    await page.keyboard.press('ArrowRight');

    const tableMenu = page.getByRole('menu', { name: 'Table', exact: true });
    await expect(tableMenu).toBeVisible();
    await expect(tableMenu.getByRole('menuitem').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(tableMenu).toBeHidden();
    await expect(tableTrigger).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(insertMenu).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  for (const menuName of ['Text color', 'Highlight', 'More formatting', 'Text alignment']) {
    test(`${menuName} popup supports keyboard navigation and focus restoration`, async ({ page }) => {
      await openFixture(page, { width: 1280, locale: 'en' });
      const trigger = page.getByRole('button', { name: menuName, exact: true });
      await trigger.focus();
      await page.keyboard.press('Enter');
      const menu = page.getByRole('menu', { name: menuName, exact: true });
      await expect(menu).toBeVisible();
      const items = menu.locator('[role^="menuitem"]');
      await expect(items.first()).toBeFocused();
      if (await items.count() > 1) {
        await page.keyboard.press('ArrowDown');
        await expect(items.nth(1)).toBeFocused();
      }
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
      await expect(trigger).toBeFocused();
    });
  }

  test('Heading popup supports roving focus, Escape, and trigger restoration', async ({ page }) => {
    await openFixture(page, { width: 1280, locale: 'en' });
    const trigger = page.getByRole('button', { name: 'Heading', exact: true });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu', { name: 'Heading level', exact: true });
    await expect(menu).toBeVisible();
    const items = menu.getByRole('menuitemradio');
    await expect(items.first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});

test.describe('table behavior', () => {
  for (const columns of [3, 8, 15]) {
    test(`${columns} columns remain contained and scroll when necessary`, async ({ page }) => {
      await openFixture(page, { width: 480, columns });
      const container = page.locator('.fixture-table-region .table-container');
      await expect(page.getByTestId('actual-table-editor')).toBeVisible();
      await expect(container).toHaveAttribute('role', 'region');
      const inlineLayout = await container.evaluate(element => {
        const table = element.querySelector('table');
        return {
          containerWidth: (element as HTMLElement).style.width,
          tableWidth: table?.style.width,
          tableMinWidth: table?.style.minWidth,
          tableLayout: table?.style.tableLayout,
        };
      });
      expect(inlineLayout).toEqual({
        containerWidth: 'fit-content',
        tableWidth: 'auto',
        tableMinWidth: `${columns * 6}rem`,
        tableLayout: 'auto',
      });
      const dimensions = await container.evaluate(element => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        bodyWidth: document.documentElement.clientWidth,
        right: element.getBoundingClientRect().right,
      }));
      expect(dimensions.right).toBeLessThanOrEqual(dimensions.bodyWidth + 1);
      if (columns === 3) {
        expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
      } else {
        expect(dimensions.scrollWidth).toBeGreaterThan(dimensions.clientWidth);
        await container.evaluate(element => { element.scrollLeft = element.scrollWidth; });
        expect(await container.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
      }
    });
  }
});

test.describe('responsive side panel contract', () => {
  for (const width of [800, 1024]) {
    test(`${width}px uses the overlay contract without horizontal overflow`, async ({ page }) => {
      await openFixture(page, {
        width,
        theme: 'dark',
        locale: 'en',
        panel: true,
      });
      const panel = page.getByRole('dialog');
      await expect(panel).toBeVisible();
      const overflow = await panel.evaluate((element) =>
        element.scrollWidth - element.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    });
  }

  test('1440px uses a docked complementary panel', async ({ page }) => {
    await openFixture(page, {
      width: 1440,
      theme: 'light',
      locale: 'ko',
      panel: true,
    });
    const panel = page.getByRole('complementary');
    await expect(panel).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const metrics = await panel.evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      overflow: element.scrollWidth - element.clientWidth,
    }));
    expect(metrics.width).toBeGreaterThanOrEqual(320);
    expect(metrics.width).toBeLessThanOrEqual(380);
    expect(metrics.overflow).toBeLessThanOrEqual(1);
  });

  test('docked panel resizes by pointer and restores its host-local width', async ({ page }) => {
    await openFixture(page, { width: 1440, locale: 'en', scene: 'settings' });
    const panel = page.getByRole('complementary');
    const separator = page.getByRole('separator', { name: 'Resize side panel' });
    const initialWidth = (await panel.boundingBox())!.width;
    const handle = (await separator.boundingBox())!;

    await page.mouse.move(handle.x + handle.width / 2, handle.y + 40);
    await page.mouse.down();
    await expect(page.locator('html')).toHaveClass(/is-resizing-side-panel/);
    await page.mouse.move(handle.x + 120, handle.y + 40);
    await page.mouse.up();
    await expect.poll(async () => (await panel.boundingBox())!.width).toBeCloseTo(initialWidth + 116, 0);

    await page.mouse.move(handle.x + 300, handle.y + 40);
    expect((await panel.boundingBox())!.width).toBeCloseTo(initialWidth + 116, 0);

    await page.locator('#activity-destination-design').click();
    await expect(panel).toBeHidden();
    await page.locator('#activity-destination-design').click();
    await expect.poll(async () => (await panel.boundingBox())!.width).toBeCloseTo(initialWidth + 116, 0);
    await page.reload();
    await page.locator('.quality-harness[data-ready="true"]').waitFor();
    await expect.poll(async () => (await page.getByRole('complementary').boundingBox())!.width)
      .toBeCloseTo(initialWidth + 116, 0);

    const restoredSeparator = page.getByRole('separator', { name: 'Resize side panel' });
    let restoredHandle = (await restoredSeparator.boundingBox())!;
    await page.mouse.move(restoredHandle.x + 4, restoredHandle.y + 40);
    await page.mouse.down();
    await page.mouse.move(1435, restoredHandle.y + 40);
    await page.mouse.up();
    expect((await page.getByRole('complementary').boundingBox())!.width).toBeCloseTo(560, 0);

    restoredHandle = (await restoredSeparator.boundingBox())!;
    await page.mouse.move(restoredHandle.x + 4, restoredHandle.y + 40);
    await page.mouse.down();
    await page.mouse.move(1, restoredHandle.y + 40);
    await page.mouse.up();
    expect((await page.getByRole('complementary').boundingBox())!.width).toBeCloseTo(320, 0);
  });

  test('separator keyboard controls clamp, persist, and retain focus', async ({ page }) => {
    await openFixture(page, { width: 1440, locale: 'en', scene: 'settings' });
    const panel = page.getByRole('complementary');
    const separator = page.getByRole('separator', { name: 'Resize side panel' });
    await separator.focus();
    await page.keyboard.press('End');
    await expect(separator).toBeFocused();
    await expect(separator).toHaveAttribute('aria-valuenow', '560');
    expect((await panel.boundingBox())!.width).toBeCloseTo(560, 0);
    await page.keyboard.press('ArrowRight');
    expect((await panel.boundingBox())!.width).toBeCloseTo(560, 0);
    await page.keyboard.press('Home');
    await expect(separator).toHaveAttribute('aria-valuenow', '320');
    expect((await panel.boundingBox())!.width).toBeCloseTo(320, 0);
    await page.keyboard.press('ArrowRight');
    await expect(separator).toHaveAttribute('aria-valuenow', '336');
  });

  test('Escape during pointer resize restores the starting width and clears global state', async ({ page }) => {
    await openFixture(page, { width: 1440, locale: 'en', scene: 'settings' });
    const panel = page.getByRole('complementary');
    const separator = page.getByRole('separator', { name: 'Resize side panel' });
    const initialWidth = (await panel.boundingBox())!.width;
    const handle = (await separator.boundingBox())!;

    await page.mouse.move(handle.x + handle.width / 2, handle.y + 40);
    await page.mouse.down();
    await page.mouse.move(handle.x + 100, handle.y + 40);
    await expect.poll(async () => (await panel.boundingBox())!.width).toBeGreaterThan(initialWidth);
    await page.keyboard.press('Escape');

    await expect.poll(async () => (await panel.boundingBox())!.width).toBeCloseTo(initialWidth, 0);
    await expect(page.locator('html')).not.toHaveClass(/is-resizing-side-panel/);
    await page.mouse.up();
  });

  test('1101px is docked while 1100px is overlay without a resize handle', async ({ page }) => {
    await openFixture(page, { width: 1101, locale: 'ko', scene: 'settings' });
    await expect(page.getByRole('complementary')).toBeVisible();
    await expect(page.getByRole('separator', { name: '사이드 패널 크기 조절' })).toBeVisible();
    await page.setViewportSize({ width: 1100, height: 800 });
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('separator')).toHaveCount(0);
    await expect(page.locator('.side-panel-scrim')).toBeVisible();
    await page.setViewportSize({ width: 1101, height: 800 });
    await expect(page.getByRole('complementary')).toBeVisible();
    await expect(page.getByRole('separator')).toBeVisible();
  });

  test('narrow overlay is modal, traps focus, and closes with Escape', async ({ page }) => {
    await openFixture(page, { width: 480, locale: 'en', panel: true });
    const panel = page.getByRole('dialog', { name: 'Document settings' });
    await expect(panel).toBeVisible();
    const close = panel.getByRole('button', { name: 'Close document panel' });
    await expect(close).toBeFocused();

    const last = panel.getByRole('button', { name: 'Last panel action' });
    await last.focus();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(last).toBeFocused();
    await expect(page.getByTestId('panel-return-target')).not.toBeFocused();

    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(page.getByTestId('panel-return-target')).toBeVisible();
    await expect(page.getByTestId('panel-return-target')).toBeFocused();
  });
});

test.describe('external change resolution prompt', () => {
  test('cancel, Escape, and wrapped Tab restore the triggering Keep button', async ({ page }) => {
    await openFixture(page, {
      width: 800,
      height: 700,
      locale: 'en',
      scene: 'external-change',
    });

    const keepButton = page.getByRole('button', { name: 'Keep my changes' });
    await keepButton.click();
    const dialog = page.getByRole('alertdialog');
    const cancelButton = dialog.getByRole('button', { name: 'Cancel' });
    const confirmButton = dialog.getByRole('button', { name: 'Keep my changes' });
    await expect(cancelButton).toBeFocused();

    await page.keyboard.press('Shift+Tab');
    await expect(confirmButton).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(cancelButton).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(keepButton).toBeFocused();
  });

  test('failure remains recoverable and success closes only after the correlated operation', async ({ page }) => {
    await openFixture(page, {
      width: 800,
      height: 700,
      locale: 'en',
      scene: 'external-change',
    });

    await page.getByRole('button', { name: 'Keep my changes' }).click();
    const dialog = page.getByRole('alertdialog');
    await dialog.getByRole('button', { name: 'Keep my changes' }).click();
    await expect(dialog).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByTestId('external-change-banner')).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByTestId('external-change-attempts')).toHaveText('1');

    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await page.getByTestId('external-change-reject').evaluate((button: HTMLButtonElement) => {
      button.click();
    });
    await expect(dialog.getByRole('alert')).toContainText('could not be resolved');
    await expect(page.getByTestId('external-change-banner')).toBeVisible();

    await dialog.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByTestId('external-change-attempts')).toHaveText('2');
    await page.getByTestId('external-change-resolve').evaluate((button: HTMLButtonElement) => {
      button.click();
    });
    await expect(page.getByTestId('external-change-banner')).toBeHidden();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('external-change-fallback')).toBeFocused();
  });

  test('Reload uses the same accessible dialog without horizontal overflow', async ({ page }) => {
    await openFixture(page, {
      width: 320,
      height: 700,
      locale: 'en',
      scene: 'external-change',
    });

    const reloadButton = page.getByRole('button', { name: 'Reload external version' });
    await reloadButton.click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByRole('heading')).toHaveText('Reload the external version?');
    const accessibility = await new AxeBuilder({ page })
      .include('.quality-harness')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(accessibility.violations).toEqual([]);
    const dimensions = await dialog.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(reloadButton).toBeFocused();
  });
});

test.describe('invalid document recovery', () => {
  test('defaults to Cancel and restores stable focus across rejection and success', async ({ page }) => {
    await openFixture(page, {
      width: 480,
      height: 700,
      locale: 'en',
      scene: 'invalid-document',
    });

    const fallback = page.getByTestId('invalid-recovery-fallback');
    const recover = page.getByRole('button', { name: 'Recover from local draft' });
    await recover.click();
    let dialog = page.getByRole('alertdialog');
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Recover and overwrite' }).click();
    await expect(fallback).toBeFocused();
    await expect(page.getByRole('button', { name: 'Recovering from local draft…' })).toBeDisabled();

    await page.getByTestId('invalid-recovery-reject').evaluate((button: HTMLButtonElement) => button.click());
    await expect(page.getByText('The invalid source could not be recovered.')).toBeVisible();
    await expect(fallback).toBeFocused();
    const accessibility = await new AxeBuilder({ page })
      .include('.quality-harness')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(accessibility.violations).toEqual([]);

    await page.getByRole('button', { name: 'Recover from local draft' }).click();
    dialog = page.getByRole('alertdialog');
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Recover and overwrite' }).click();
    await expect(fallback).toBeFocused();
    await page.getByTestId('invalid-recovery-resolve').evaluate((button: HTMLButtonElement) => button.click());
    await expect(page.locator('.invalid-document-banner')).toBeHidden();
    await expect(fallback).toBeFocused();

  });
});

test.describe('accessibility and visual regions', () => {
  const scenes: Array<Required<Omit<
    FixtureOptions,
    'columns' | 'height' | 'panel' | 'scene'
  >>> = [
    { width: 320, theme: 'light', locale: 'ko' },
    { width: 480, theme: 'dark', locale: 'en' },
    { width: 768, theme: 'hc', locale: 'ko' },
  ];

  for (const scene of scenes) {
    const name = `vscode-${scene.theme}-${scene.locale}-${scene.width}`;
    test(`${name} has no WCAG A/AA violations`, async ({ page }) => {
      await openFixture(page, scene);
      const results = await new AxeBuilder({ page })
        .include('.quality-harness')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(results.violations).toEqual([]);
    });

    test(`${name} matches approved regions`, async ({ page }) => {
      await openFixture(page, scene);
      await expect(page.getByRole('toolbar')).toHaveScreenshot(`${name}-toolbar.png`);
      await expect(page.locator('.fixture-canvas')).toHaveScreenshot(`${name}-canvas.png`);
    });
  }
});

test.describe('diagram dialog language defaults', () => {
  test('replaces the source with the selected language default example', async ({ page }) => {
    await openFixture(page, {
      scene: 'diagram-error',
      width: 1024,
      height: 900,
      theme: 'dark',
      locale: 'en',
    });

    const language = page.locator('#diagram-language');
    const source = page.locator('#diagram-code');

    await language.selectOption('d2');
    await expect(source).toHaveValue(`Start -> Decision
Decision -> Process: Yes
Decision -> End: No
Process -> End`);

    await language.selectOption('graphviz');
    await expect(source).toHaveValue(`digraph G {
  Start -> Decision
  Decision -> Process [label="Yes"]
  Decision -> End [label="No"]
  Process -> End
}`);

    await language.selectOption('mermaid');
    await expect(source).toHaveValue(`graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Process 1]
    B -->|No| D[Process 2]
    C --> E[End]
    D --> E`);

    await language.selectOption('plantuml');
    await expect(source).toHaveValue(`@startuml
Alice -> Bob: Request
Bob --> Alice: Response
@enduml`);
  });

  test('keeps Mermaid flowchart and class diagrams at their intrinsic SVG size', async ({ page }) => {
    await openFixture(page, {
      scene: 'diagram-error',
      width: 1024,
      height: 900,
      theme: 'dark',
      locale: 'en',
    });

    await page.locator('#diagram-language').selectOption('mermaid');
    const preview = page.locator('.diagram-preview-area');
    const svg = preview.locator('svg');

    const expectIntrinsicSize = async () => {
      await expect(svg).toBeVisible();
      const layout = await svg.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const container = element.closest('.diagram-preview-area');
        const viewBox = element.viewBox.baseVal;
        return {
          widthAttribute: element.getAttribute('width'),
          heightAttribute: element.getAttribute('height'),
          expectedWidth: Math.ceil(viewBox.width),
          expectedHeight: Math.ceil(viewBox.height),
          renderedWidth: bounds.width,
          renderedHeight: bounds.height,
          availableWidth: container?.clientWidth ?? 0,
        };
      });
      expect(layout.widthAttribute).toBe(String(layout.expectedWidth));
      expect(layout.heightAttribute).toBe(String(layout.expectedHeight));
      expect(layout.renderedWidth).toBeLessThanOrEqual(layout.expectedWidth + 1);
      expect(layout.renderedHeight).toBeLessThanOrEqual(layout.expectedHeight + 1);
      expect(layout.renderedWidth).toBeLessThanOrEqual(layout.availableWidth);
    };

    await expectIntrinsicSize();
    await page.getByRole('button', { name: 'Class', exact: true }).click();
    await expect(page.locator('#diagram-code')).toHaveValue(/classDiagram/);
    await expectIntrinsicSize();
  });

  test('traps focus, restores the invoker, and fits a 320px viewport', async ({ page }) => {
    await openFixture(page, {
      scene: 'diagram-error',
      width: 320,
      height: 700,
      theme: 'dark',
      locale: 'en',
    });

    const initialDialog = page.getByRole('dialog', { name: 'Insert text diagram' });
    await initialDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(initialDialog).toBeHidden();

    const opener = page.getByTestId('diagram-dialog-opener');
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'Insert text diagram' });
    await expect(dialog.locator('#diagram-code')).toBeFocused();

    const firstControl = dialog.locator('#diagram-language');
    const lastControl = dialog.getByRole('button', { name: /Insert.*Ctrl\+Enter/ });
    await firstControl.focus();
    await page.keyboard.press('Shift+Tab');
    await expect(lastControl).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(firstControl).toBeFocused();

    const bounds = await dialog.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      };
    });
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(320);
    expect(bounds.top).toBeGreaterThanOrEqual(0);
    expect(bounds.bottom).toBeLessThanOrEqual(700);
    expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });
});

test.describe('shared keyboard interaction foundations', () => {
  test('table and image menu actions run on click, Enter, and Space', async ({ page }) => {
    await openFixture(page, {
      scene: 'interactions', width: 640, height: 480, theme: 'light', locale: 'en',
    });

    const tableTrigger = page.getByRole('button', { name: 'Open table menu' });
    await tableTrigger.click();
    let tableMenu = page.getByRole('menu', { name: 'Table actions' });
    await expect(tableMenu.getByRole('menuitem', { name: 'Table properties…' })).toBeFocused();
    await tableMenu.getByRole('menuitem', { name: 'Table properties…' }).click();
    await expect(page.getByTestId('interaction-action')).toHaveText('table-properties');
    await expect(tableTrigger).toBeFocused();

    await tableTrigger.click();
    tableMenu = page.getByRole('menu', { name: 'Table actions' });
    await expect(tableMenu.getByRole('menuitem', { name: /caption/i })).toHaveCount(0);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('interaction-action')).toHaveText('table-properties');
    await expect(tableTrigger).toBeFocused();

    const imageTrigger = page.getByRole('button', { name: 'Open image menu' });
    await imageTrigger.click();
    const imageMenu = page.getByRole('menu', { name: 'Image actions' });
    await expect(imageMenu.getByRole('menuitem', { name: 'Image properties…' })).toBeFocused();
    await page.keyboard.press('Space');
    await expect(page.getByTestId('interaction-action')).toHaveText('image-properties');
    await expect(imageTrigger).toBeFocused();
  });

  test('side-panel tabs use automatic roving focus for arrows, Home, and End', async ({ page }) => {
    await openFixture(page, {
      scene: 'files', width: 1024, height: 800, theme: 'dark', locale: 'en',
    });

    const exportTab = page.getByRole('tab', { name: 'Export' });
    const importTab = page.getByRole('tab', { name: 'Import' });
    await exportTab.focus();
    await page.keyboard.press('ArrowRight');
    await expect(importTab).toBeFocused();
    await expect(importTab).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(exportTab).toBeFocused();
    await page.keyboard.press('End');
    await expect(importTab).toBeFocused();
    await page.keyboard.press('Home');
    await expect(exportTab).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(importTab).toBeFocused();
  });
});

test.describe('commercial workflow scene gate', () => {
  interface WorkflowScene {
    scene: Exclude<Scene, 'editor' | 'external-change' | 'interactions'>;
    width: 800 | 1024 | 1440;
    theme: Theme;
    locale: Locale;
  }

  const scenes: readonly WorkflowScene[] = [
    { scene: 'settings', width: 800, theme: 'light', locale: 'en' },
    { scene: 'settings', width: 1024, theme: 'dark', locale: 'en' },
    { scene: 'settings', width: 1440, theme: 'hc', locale: 'ko' },
    { scene: 'templates', width: 1024, theme: 'dark', locale: 'en' },
    { scene: 'files', width: 800, theme: 'dark', locale: 'ko' },
    { scene: 'diagram-error', width: 800, theme: 'hc', locale: 'ko' },
  ];

  const componentSelector: Record<WorkflowScene['scene'], string> = {
    settings: '.design-panel',
    templates: '.template-panel',
    files: '.files-panel',
    'diagram-error': '.diagram-error',
  };

  for (const scene of scenes) {
    const name = [
      scene.scene,
      'vscode',
      scene.theme,
      scene.locale,
      scene.width,
    ].join('-');

    test(`${name} passes screenshot, accessibility, and overflow gates`, async ({ page }) => {
      await openFixture(page, { ...scene, height: 900 });

      const sharedComponent = page.locator(componentSelector[scene.scene]);
      await expect(sharedComponent).toBeVisible();

      if (scene.scene !== 'diagram-error') {
        const panel = page.locator('#editor-side-panel');
        await expect(panel).toHaveAttribute(
          'role',
          scene.width <= 1100 ? 'dialog' : 'complementary',
        );

        if (scene.scene === 'files') {
          const selectedTab = page.getByRole('tab', { selected: true });
          const tabPanel = page.getByRole('tabpanel');
          await expect(selectedTab).toHaveAttribute('aria-controls', SIDE_PANEL_TAB_CONTENT_ID);
          await expect(tabPanel).toHaveAttribute('id', SIDE_PANEL_TAB_CONTENT_ID);
          await expect(tabPanel).toHaveAttribute(
            'aria-labelledby',
            await selectedTab.getAttribute('id') ?? '',
          );
        } else {
          await expect(page.getByRole('tablist')).toHaveCount(0);
          await expect(page.getByRole('tabpanel')).toHaveCount(0);
        }

        if (scene.scene === 'settings') {
          await expect(page.locator('#editor-side-panel')).toContainText(
            scene.locale === 'ko' ? '디자인' : 'Design',
          );
          await expect(page.locator('.side-panel-section-desc')).toBeVisible();
          await expect(page.locator('.settings-panel-description')).toBeVisible();
          await expect(page.locator('.design-panel .side-panel-section')).toBeVisible();
          await expect(page.locator('.design-panel .settings-panel')).toBeVisible();
          await expect(page.getByRole('button', {
            name: scene.locale === 'ko' ? '모든 문서 설정 초기화' : 'Reset all document settings',
          })).toBeAttached();
        }
      }

      const accessibility = await new AxeBuilder({ page })
        .include('.quality-harness')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(accessibility.violations).toEqual([]);

      const overflowTargets = scene.scene === 'diagram-error'
        ? ['html', '.quality-harness', '.modal-content']
        : ['html', '.quality-harness', '#editor-side-panel'];
      for (const selector of overflowTargets) {
        const dimensions = await page.locator(selector).evaluate((element) => ({
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
        }));
        expect(
          dimensions.scrollWidth,
          `${selector} must not overflow horizontally`,
        ).toBeLessThanOrEqual(dimensions.clientWidth + 1);
      }

      await expect(page.locator('.scene-surface')).toHaveScreenshot(`${name}.png`);
    });
  }
});

test.describe('Book workspace contract', () => {
  for (const fixture of [
    { width: 480, theme: 'light' as const, locale: 'en' as const },
    { width: 1024, theme: 'dark' as const, locale: 'ko' as const },
    { width: 1440, theme: 'hc' as const, locale: 'en' as const },
  ]) {
    test(`${fixture.width}px ${fixture.theme} ${fixture.locale} is accessible and contained`, async ({ page }) => {
      await openFixture(page, { ...fixture, height: 900, scene: 'book' });
      const workspace = page.locator('.book-workspace');
      await expect(workspace).toBeVisible();
      await expect(page.getByRole('heading', { name: fixture.locale === 'ko' ? 'Book 개요' : 'Book outline' })).toBeVisible();
      await expect(page.getByRole('heading', { name: fixture.locale === 'ko' ? '합본 읽기 전용 미리보기' : 'Composed read-only preview' })).toBeVisible();
      await expect(page.getByRole('button', { name: fixture.locale === 'ko' ? 'HTML 내보내기' : 'Export HTML' })).toBeEnabled();

      const accessibility = await new AxeBuilder({ page })
        .include('.book-workspace')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(accessibility.violations).toEqual([]);
      for (const selector of ['html', '.book-workspace', '.book-content-grid']) {
        const dimensions = await page.locator(selector).evaluate((element) => ({
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
        }));
        expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
      }
    });
  }

  test('chapter rows support keyboard reorder, open, and removal shortcuts', async ({ page }) => {
    await openFixture(page, { width: 800, height: 900, locale: 'en', scene: 'book' });
    const rows = page.locator('.book-document-row');
    await expect(rows).toHaveCount(2);
    await rows.first().focus();
    await page.keyboard.press('Alt+ArrowDown');
    await expect(rows.first()).toContainText('Reference');
    await expect(rows.nth(1)).toBeFocused();
    await expect(page.getByRole('status')).toContainText('moved to position 2');
    await rows.nth(1).focus();
    await page.keyboard.press('Delete');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toBeFocused();
    await expect(page.getByRole('status')).toContainText('removed from the Book');
  });

  test('Book preflight is modal, cancel-first, trapped, inert, and restores export focus', async ({ page }) => {
    await openFixture(page, { width: 1024, height: 900, locale: 'en', scene: 'book' });
    const trigger = page.getByRole('button', { name: 'Export HTML' });
    await trigger.click();
    const dialog = page.getByRole('alertdialog', { name: 'Confirm export' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Effective publish settings' })).toBeVisible();
    await expect(page.locator('.book-workspace-background')).toHaveAttribute('inert', '');
    const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
    const confirm = dialog.getByRole('button', { name: 'Export file', exact: true });
    await expect(dialog).toContainText('Book folder');
    await expect(dialog).toContainText('./dist/system-guide.html');
    await expect(dialog).toContainText('Heading numbering');
    await expect(dialog).toContainText('Book profile');
    await expect(dialog).toContainText('Keep diagram source when rendering is unavailable.');
    await expect(dialog).toContainText('1 diagram fallback');
    await expect(cancel).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(confirm).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(cancel).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('Book profile exposes all portable settings with localized validation', async ({ page }) => {
    await openFixture(page, { width: 1024, height: 1100, locale: 'ko', scene: 'book' });
    for (const label of [
      '제목 번호 표시', '제목 시작 번호', '제목 장식', 'H1 번호 색상', 'H6 번호 색상',
      '캡션 스타일', '캡션 번호 방식', '수식 번호 방식', '상호 참조에 캡션 포함',
    ]) await expect(page.getByText(label, { exact: true })).toBeVisible();
    const color = page.getByLabel('H1 번호 색상');
    await color.fill('#abcde');
    await expect(color).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('3, 4, 6 또는 8자리 16진수 색상을 입력하세요.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Publish 프로필 저장' })).toBeDisabled();
  });

  test('Book result exposes fallback, artifact details, warnings, and common actions', async ({ page }) => {
    await openFixture(page, {
      width: 800, height: 900, locale: 'en', scene: 'book', operation: 'succeeded-export',
    });
    const result = page.locator('.book-operation.succeeded');
    await expect(result).toContainText('Export completed with fallback.');
    await expect(result).toContainText('system-guide.html');
    await expect(result).toContainText('4,096 bytes');
    await expect(result).toContainText('PDF is unavailable; an HTML fallback was created.');
    for (const action of ['Open', 'Reveal', 'Copy path', 'Repeat']) {
      await expect(result.getByRole('button', { name: action, exact: true })).toBeVisible();
    }
    await result.getByRole('button', { name: 'Open', exact: true }).dblclick();
    await expect(result).toContainText('Opening result…');
    for (const action of ['Open', 'Reveal', 'Copy path', 'Repeat']) {
      await expect(result.getByRole('button', { name: action, exact: true })).toBeDisabled();
    }
  });

  test('Book preview uses the profile color for heading text, number, and decoration', async ({ page }) => {
    await openFixture(page, { width: 1024, height: 900, locale: 'en', scene: 'book' });
    const colors = await page.locator('.book-preview-editor .ProseMirror h1').evaluate((heading) => ({
      text: getComputedStyle(heading).color,
      number: getComputedStyle(heading, '::before').color,
      border: getComputedStyle(heading).borderBottomColor,
      borderStyle: getComputedStyle(heading).borderBottomStyle,
    }));
    expect(colors).toEqual({
      text: 'rgb(37, 99, 235)',
      number: 'rgb(37, 99, 235)',
      border: 'rgb(37, 99, 235)',
      borderStyle: 'solid',
    });
    const h2Colors = await page.locator('.book-preview-editor .ProseMirror h2').evaluate((heading) => ({
      text: getComputedStyle(heading).color,
      number: getComputedStyle(heading, '::before').color,
    }));
    expect(h2Colors).toEqual({ text: 'rgb(37, 99, 235)', number: 'rgb(37, 99, 235)' });
  });

});

test.describe('Files operation UX contract', () => {
  test('file preflight traps keyboard focus, starts on Cancel, and restores its trigger', async ({ page }) => {
    await openFixture(page, {
      scene: 'files', width: 1024, height: 800, theme: 'dark', locale: 'en',
    });
    const trigger = page.getByRole('button', { name: /HTML.*Web page for sharing or publishing/i });
    await trigger.click();
    const dialog = page.getByRole('alertdialog', { name: 'Confirm export' });
    await expect(dialog).toBeVisible();
    const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
    const confirm = dialog.getByRole('button', { name: 'Export file', exact: true });
    await expect(cancel).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(confirm).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(cancel).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('Korean import preflight remains modal, accessible, and contained at 320px', async ({ page }) => {
    await openFixture(page, {
      scene: 'files', width: 320, height: 800, theme: 'hc', locale: 'ko',
    });
    await page.getByRole('tab', { name: '가져오기' }).click();
    const trigger = page.getByRole('button', { name: /Markdown.*현재 문서로 가져옵니다/i });
    await trigger.click();
    const dialog = page.getByRole('alertdialog', { name: '가져오기 확인' });
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(page.locator('.files-panel-background')).toHaveAttribute('inert', '');
    await expect(page.locator('.files-panel-background')).toHaveAttribute('aria-hidden', 'true');
    await expect(dialog.getByText('메타데이터와 설정은 유지됩니다.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: '취소', exact: true })).toBeFocused();
    const accessibility = await new AxeBuilder({ page })
      .include('.modal-overlay')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(accessibility.violations).toEqual([]);
    const dimensions = await dialog.evaluate((element) => ({
      left: element.getBoundingClientRect().left,
      right: element.getBoundingClientRect().right,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));
    expect(dimensions.left).toBeGreaterThanOrEqual(0);
    expect(dimensions.right).toBeLessThanOrEqual(320);
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
    await expect(page.locator('.scene-surface')).toHaveScreenshot('files-preflight-vscode-hc-ko-320.png');
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  });

  test('Files operation states expose localized live regions and distinct buffer persistence', async ({ page }) => {
    await openFixture(page, {
      scene: 'files', width: 800, height: 800, theme: 'dark', locale: 'ko', operation: 'running',
    });
    let status = page.locator('.file-operation-status[role="status"]');
    await expect(status).toHaveAttribute('aria-live', 'polite');
    await expect(status).toContainText('불변 스냅샷을 렌더링하는 중');

    await openFixture(page, {
      scene: 'files', width: 800, height: 800, theme: 'hc', locale: 'ko', operation: 'failed',
    });
    const alert = page.locator('.file-operation-status[role="alert"]');
    await expect(alert).toHaveAttribute('aria-live', 'assertive');
    await expect(alert.getByRole('button', { name: '다시 시도' })).toBeVisible();

    await openFixture(page, {
      scene: 'files', width: 800, height: 800, theme: 'light', locale: 'ko', operation: 'succeeded-export',
    });
    await expect(page.getByRole('button', { name: '열기', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '탐색기에서 보기' })).toBeVisible();

    await openFixture(page, {
      scene: 'files', width: 800, height: 800, theme: 'dark', locale: 'ko', operation: 'succeeded-import',
    });
    status = page.locator('.file-operation-result[role="status"]');
    await expect(status).toContainText('편집기 버퍼에 적용');
    await expect(status).toContainText('디스크에 기록하려면 문서를 저장');
    await expect(status.getByRole('button', { name: '가져오기 실행 취소' })).toBeVisible();
  });

  test('Design and Files remain horizontally contained with 200% text scaling', async ({ page }) => {
    for (const scene of ['settings', 'files'] as const) {
      await openFixture(page, { scene, width: 800, height: 900, theme: 'dark', locale: 'en' });
      await page.addStyleTag({ content: '#editor-side-panel { font-size: 200%; }' });
      const panel = page.locator('#editor-side-panel');
      const dimensions = await panel.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
    }
  });

  test('PDF scale keeps invalid drafts local and commits only a valid value', async ({ page }) => {
    await openFixture(page, {
      scene: 'files', width: 1024, height: 900, theme: 'dark', locale: 'en',
    });
    const surface = page.locator('.scene-surface');
    const pdfSection = page.locator('.settings-section').filter({
      has: page.getByRole('button', { name: 'PDF', exact: true }),
    }).first();
    await pdfSection.getByRole('button', { name: 'PDF', exact: true }).click();
    const scale = pdfSection.getByRole('textbox', { name: 'PDF scale' });
    await expect(surface).toHaveAttribute('data-pdf-scale', 'unset');

    for (const invalid of ['', 'not-a-number', '201']) {
      await scale.fill(invalid);
      await scale.blur();
      await expect(scale).toHaveAttribute('aria-invalid', 'true');
      const errorId = await scale.getAttribute('aria-errormessage');
      expect(errorId).toBeTruthy();
      await expect(page.locator(`#${errorId}`)).toHaveText('Enter a number from 10 through 200.');
      await expect(surface).toHaveAttribute('data-pdf-scale', 'unset');
    }

    await scale.fill('95');
    await scale.press('Enter');
    await expect(scale).not.toHaveAttribute('aria-invalid', 'true');
    await expect(surface).toHaveAttribute('data-pdf-scale', '95');
  });
});

test.describe('heading palette contract', () => {
  test('view preference labels remain fully readable across widths, locales, and text scaling', async ({ page }) => {
    for (const width of [800, 1024, 1440]) {
      for (const locale of ['en', 'ko'] as const) {
        for (const scale of [100, 200]) {
          await openFixture(page, { scene: 'settings', width, height: 900, theme: 'dark', locale });
          if (scale === 200) {
            await page.addStyleTag({
              content: `
                #editor-side-panel .side-panel-view-preference .side-panel-control-copy,
                #editor-side-panel .side-panel-view-preference .side-panel-select {
                  font-size: 200%;
                }
              `,
            });
          }
          const row = page.locator('.side-panel-view-preference').first();
          const select = row.locator('select');
          await expect(select.locator('option:checked')).toHaveText(
            locale === 'ko' ? '문서 설정 따르기' : 'Follow document',
          );
          const fit = await select.evaluate((element: HTMLSelectElement) => {
            const styles = getComputedStyle(element);
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            if (!context) throw new Error('Canvas context unavailable.');
            context.font = styles.font;
            const labelWidth = context.measureText(element.selectedOptions[0]?.text ?? '').width;
            const horizontalPadding = Number.parseFloat(styles.paddingLeft)
              + Number.parseFloat(styles.paddingRight);
            return {
              clientWidth: element.clientWidth,
              requiredWidth: Math.ceil(labelWidth + horizontalPadding + 4),
            };
          });
          expect(
            fit.clientWidth,
            `${width}px ${locale} at ${scale}% must show the selected label without truncation`,
          ).toBeGreaterThanOrEqual(fit.requiredWidth);
          const copy = await row.locator('.side-panel-control-copy').evaluate((element) => ({
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
          }));
          expect(copy.scrollWidth).toBeLessThanOrEqual(copy.clientWidth + 1);
        }
      }
    }
  });

  test('keeps session view preferences separate from persisted document settings', async ({ page }) => {
    await openFixture(page, {
      scene: 'settings', width: 1024, height: 900, theme: 'dark', locale: 'en',
    });

    const viewRow = page.locator('.side-panel-view-preference')
      .filter({ hasText: 'Heading numbering' });
    const preference = viewRow.locator('select');
    const persisted = page.locator('.settings-panel')
      .getByRole('checkbox', { name: 'Heading numbering' });

    await expect(preference).toHaveValue('follow-document');
    await expect(persisted).toBeChecked();
    await preference.selectOption('hide');
    await expect(viewRow).toContainText('currently hidden');
    await expect(viewRow).toContainText('Temporary view');
    await expect(persisted).toBeChecked();
    await expect(page.locator('.fixture-canvas')).toHaveAttribute('data-effective-numbering', 'hide');
    await expect(page.locator('.design-compact-preview-h1')).toHaveText('Document heading');

    await preference.selectOption('follow-document');
    await expect(page.locator('.fixture-canvas')).toHaveAttribute('data-effective-numbering', 'show');
    await expect(page.locator('.design-compact-preview-h1')).toHaveText('1 Document heading');
  });

  test('undoes persisted settings to the panel-open baseline', async ({ page }) => {
    await openFixture(page, {
      scene: 'settings', width: 1024, height: 900, theme: 'dark', locale: 'en',
    });

    const decoration = page.locator('.settings-panel')
      .getByRole('checkbox', { name: 'Decoration' });
    await decoration.uncheck();
    const appearance = page.locator('.settings-section').filter({
      has: page.getByRole('button', { name: 'Document appearance' }),
    }).first();
    await expect(appearance.locator('.settings-change-summary')).toHaveText(
      '1 changes since panel opened',
    );
    await appearance.getByRole('button', { name: 'Undo group' }).click();
    await expect(decoration).toBeChecked();
    await expect(appearance.locator('.settings-change-summary')).toHaveText(
      '0 changes since panel opened',
    );
  });

  test('uses four keyboard-operable cards and reveals Custom without rewriting Mixed', async ({ page }) => {
    await openFixture(page, {
      scene: 'settings', width: 1024, height: 900, theme: 'dark', locale: 'en',
    });

    const cards = page.locator('.settings-palette-card');
    await expect(cards).toHaveCount(4);
    const narrowRows = await cards.evaluateAll((elements) =>
      new Set(elements.map((element) => Math.round(element.getBoundingClientRect().y))).size);
    expect(narrowRows).toBe(2);
    await expect(page.getByRole('button', { name: /^Mixed/ })).toHaveCount(0);
    await expect(page.locator('.settings-custom-palette-controls')).toHaveCount(0);

    const custom = page.getByRole('button', { name: /Custom, #2563EB/i });
    await custom.focus();
    await page.keyboard.press('Space');
    await expect(custom).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('Custom palette color picker')).toBeVisible();
    await page.getByRole('button', { name: 'Remove overrides' }).first().click();
    await expect(page.locator('.settings-custom-palette-controls')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Blue palette, #2563EB/i })).toHaveAttribute('aria-pressed', 'true');

    await custom.focus();
    await page.keyboard.press('Space');
    let hex = page.getByRole('textbox', { name: 'Custom palette HEX color' });
    await hex.fill('#12');
    await hex.blur();
    await expect(hex).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('button', { name: /Custom, #2563EB/i })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: /LG heritage red, #A50034/i }).click();
    await expect(page.locator('.settings-custom-palette-controls')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /LG heritage red, #A50034/i })).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: /Custom, #A50034/i }).click();
    hex = page.getByRole('textbox', { name: 'Custom palette HEX color' });
    await hex.fill('#123456');
    await hex.press('Enter');
    await expect(page.getByRole('button', { name: /Custom, #123456/i })).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: 'Advanced heading colors' }).click();
    await page.getByRole('button', { name: 'H1 Black' }).click();
    await expect(page.locator('.settings-palette-mixed-notice'))
      .toHaveText('Advanced heading colors are applied.');
    await expect(page.getByRole('button', { name: /^Mixed/ })).toHaveCount(0);
    await expect(page.locator('.settings-custom-palette-controls')).toHaveCount(0);
    await page.getByRole('button', { name: /Custom, #000000/i }).click();
    await expect(page.locator('.settings-palette-mixed-notice'))
      .toHaveText('Advanced heading colors are applied.');
    await expect(page.locator('.settings-custom-palette-controls')).toBeVisible();
  });

  test('places all four palette cards in one row at the maximum panel width', async ({ page }) => {
    await openFixture(page, {
      scene: 'settings', width: 1440, height: 900, theme: 'light', locale: 'en',
    });
    const separator = page.getByRole('separator', { name: 'Resize side panel' });
    await separator.focus();
    await page.keyboard.press('End');
    const cards = page.locator('.settings-palette-card');
    await expect(cards).toHaveCount(4);
    const wideRows = await cards.evaluateAll((elements) =>
      new Set(elements.map((element) => Math.round(element.getBoundingClientRect().y))).size);
    expect(wideRows).toBe(1);
  });
});

test.describe('template interaction contract', () => {
  test('confirmation and metadata dialogs trap focus, validate, cancel, and complete', async ({ page }) => {
    await openFixture(page, {
      scene: 'templates', width: 1024, height: 900, theme: 'dark', locale: 'en',
    });

    await page.getByRole('button', { name: /Technical report/ }).click();
    const createNew = page.getByRole('button', { name: 'Create new document' });
    await expect(createNew).toBeVisible();
    await createNew.click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.getByText('Template action completed.')).toBeVisible();

    const replace = page.getByRole('button', { name: 'Replace current document' });
    await replace.click();
    const confirmation = page.getByRole('alertdialog');
    await expect(confirmation).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('button', { name: 'Replace current document' }).last()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(confirmation).toBeHidden();
    await expect(replace).toBeFocused();

    await replace.click();
    await page.getByRole('button', { name: 'Replace current document' }).last().click();
    await expect(page.getByText('Template action completed.')).toBeVisible();
    await expect(page.locator('.template-panel')).toBeVisible();

    await page.getByText('My templates', { exact: true }).last().click();
    await page.getByRole('button', { name: /Save current document/ }).click();
    const metadataDialog = page.getByRole('dialog', { name: 'Save personal template' });
    await expect(metadataDialog).toBeVisible();
    const name = metadataDialog.getByLabel('Name');
    await name.fill(' ');
    await metadataDialog.getByRole('button', { name: 'Save' }).click();
    const nameError = metadataDialog.getByRole('alert');
    await expect(nameError).toContainText('1 and 200');
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    await expect(name).toHaveAttribute(
      'aria-errormessage',
      await nameError.getAttribute('id') ?? '',
    );
    await name.fill('Validated template');
    await page.keyboard.press('Enter');
    await expect(metadataDialog).toBeHidden();
    await expect(page.getByText('Template action completed.')).toBeVisible();

    await page.getByRole('button', { name: /My weekly review/ }).click();
    await page.getByRole('button', { name: 'Edit' }).click();
    const editDialog = page.getByRole('dialog', { name: 'Edit personal template' });
    await editDialog.getByLabel('Name').fill('Updated weekly review');
    await page.keyboard.press('Enter');
    await expect(editDialog).toBeHidden();

    await page.getByRole('button', { name: 'Duplicate' }).click();
    const duplicateDialog = page.getByRole('dialog', { name: 'Duplicate personal template' });
    await duplicateDialog.getByLabel('Name').fill('Weekly review copy');
    await page.keyboard.press('Enter');
    await expect(duplicateDialog).toBeHidden();

    await page.locator('.template-personal-actions').getByRole('button', { name: 'Delete', exact: true }).click();
    const deleteDialog = page.getByRole('alertdialog', { name: 'Delete this template?' });
    await deleteDialog.getByRole('button', { name: 'Delete' }).click();
    await expect(deleteDialog).toBeHidden();
  });

  test('open-folder failure restores the invoking button and the activity toggles with localized focus', async ({ page }) => {
    await openFixture(page, {
      scene: 'templates', width: 800, height: 900, theme: 'light', locale: 'ko',
    });

    const activity = page.locator('#activity-destination-templates');
    await activity.click();
    await expect(page.locator('.template-panel')).toBeHidden();
    await expect(activity).toBeFocused();
    await activity.click();
    await expect(page.locator('.template-panel')).toBeVisible();

    await page.getByRole('button', { name: '다시 시도' }).click();
    await expect(page.locator('.template-result-count')).toContainText('3');

    await page.getByText('내 템플릿', { exact: true }).last().click();
    const openFolder = page.getByRole('button', { name: '개인 템플릿 폴더 열기' });
    await openFolder.click();
    await expect(page.getByRole('alert')).toContainText('템플릿 작업을 완료하지 못했습니다.');
    await expect(openFolder).toBeFocused();
  });
});
