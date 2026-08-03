import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

type Host = 'vscode' | 'tauri';
type Theme = 'light' | 'dark' | 'hc';
type Locale = 'ko' | 'en';
type Scene = 'editor' | 'settings' | 'templates' | 'files' | 'diagram-error' | 'external-change';

interface FixtureOptions {
  width: number;
  height?: number;
  host?: Host;
  theme?: Theme;
  locale?: Locale;
  scene?: Scene;
  columns?: number;
  panel?: boolean;
}

async function openFixture(page: Page, {
  width,
  height = 800,
  host = 'vscode',
  theme = 'light',
  locale = 'ko',
  scene = 'editor',
  columns = 8,
  panel = false,
}: FixtureOptions): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.goto(`/?host=${host}&theme=${theme}&locale=${locale}&scene=${scene}&columns=${columns}&panel=${panel ? '1' : '0'}`);
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
        host: 'vscode',
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
      host: 'tauri',
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
      host: 'vscode',
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
      host: 'tauri',
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
      host: 'vscode',
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

test.describe('accessibility and visual regions', () => {
  const scenes: Array<Required<Omit<
    FixtureOptions,
    'columns' | 'height' | 'panel' | 'scene'
  >>> = [
    { width: 320, host: 'vscode', theme: 'light', locale: 'ko' },
    { width: 480, host: 'vscode', theme: 'dark', locale: 'en' },
    { width: 768, host: 'vscode', theme: 'hc', locale: 'ko' },
    { width: 1024, host: 'tauri', theme: 'light', locale: 'en' },
    { width: 1280, host: 'tauri', theme: 'dark', locale: 'ko' },
  ];

  for (const scene of scenes) {
    const name = `${scene.host}-${scene.theme}-${scene.locale}-${scene.width}`;
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

test.describe('commercial workflow scene gate', () => {
  interface WorkflowScene {
    scene: Exclude<Scene, 'editor' | 'external-change'>;
    width: 800 | 1024 | 1440;
    host: Host;
    theme: Theme;
    locale: Locale;
  }

  const scenes: readonly WorkflowScene[] = [
    { scene: 'settings', width: 800, host: 'vscode', theme: 'light', locale: 'en' },
    { scene: 'settings', width: 1024, host: 'tauri', theme: 'dark', locale: 'ko' },
    { scene: 'settings', width: 1440, host: 'vscode', theme: 'hc', locale: 'ko' },
    { scene: 'templates', width: 800, host: 'tauri', theme: 'light', locale: 'ko' },
    { scene: 'templates', width: 1024, host: 'vscode', theme: 'dark', locale: 'en' },
    { scene: 'templates', width: 1440, host: 'tauri', theme: 'hc', locale: 'en' },
    { scene: 'files', width: 800, host: 'vscode', theme: 'dark', locale: 'ko' },
    { scene: 'files', width: 1440, host: 'tauri', theme: 'light', locale: 'en' },
    { scene: 'diagram-error', width: 1024, host: 'tauri', theme: 'dark', locale: 'en' },
    { scene: 'diagram-error', width: 800, host: 'vscode', theme: 'hc', locale: 'ko' },
  ];

  const componentSelector: Record<WorkflowScene['scene'], string> = {
    settings: '.settings-panel',
    templates: '.template-panel',
    files: '.files-panel',
    'diagram-error': '.diagram-error',
  };

  for (const scene of scenes) {
    const name = [
      scene.scene,
      scene.host,
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

test.describe('template interaction contract', () => {
  test('confirmation and metadata dialogs trap focus, validate, cancel, and complete', async ({ page }) => {
    await openFixture(page, {
      scene: 'templates', width: 1024, height: 900, host: 'vscode', theme: 'dark', locale: 'en',
    });

    await page.getByRole('button', { name: /Technical report/ }).click();
    const apply = page.getByRole('button', { name: 'Apply template' });
    await apply.click();
    const confirmation = page.getByRole('alertdialog');
    await expect(confirmation).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('button', { name: 'Apply template' }).last()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(confirmation).toBeHidden();
    await expect(apply).toBeFocused();

    await apply.click();
    await page.getByRole('button', { name: 'Apply template' }).last().click();
    await expect(page.getByText('Template action completed.')).toBeVisible();
    await expect(page.locator('.template-panel')).toBeVisible();

    await page.getByText('My templates', { exact: true }).last().click();
    await page.getByRole('button', { name: /Save current document/ }).click();
    const metadataDialog = page.getByRole('dialog', { name: 'Save personal template' });
    await expect(metadataDialog).toBeVisible();
    const name = metadataDialog.getByLabel('Name');
    await name.fill(' ');
    await metadataDialog.getByRole('button', { name: 'Save' }).click();
    await expect(metadataDialog.getByRole('alert')).toContainText('1 and 200');
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

  test('Tauri failure restores the invoking button and the activity toggles with localized focus', async ({ page }) => {
    await openFixture(page, {
      scene: 'templates', width: 800, height: 900, host: 'tauri', theme: 'light', locale: 'ko',
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
