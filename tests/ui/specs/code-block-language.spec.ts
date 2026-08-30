import { expect, test, type Page } from '@playwright/test';

const openInteractionContract = async (page: Page) => {
  await page.goto('/performance.html?corpus=code-language-contract');
  await page.waitForFunction(() => document.documentElement.dataset.performanceReady === 'true');

  const editor = page.locator('.ProseMirror');
  const blocks = editor.locator('.code-block');
  const popup = page.locator('.code-block-language-popup');
  const select = popup.locator('select');
  await expect(blocks).toHaveCount(3);
  await expect(popup).toHaveCount(1);
  await expect(popup).toBeHidden();
  await page.evaluate(() => window.__sdocBrowserPerformance?.closeHistoryGroup());
  return { blocks, popup, select };
};

test('keeps code-language controls bounded across a rich 5k editor', async ({ page }) => {
  await page.goto('/performance.html?corpus=rich-mixed-5k');
  await page.waitForFunction(() => document.documentElement.dataset.performanceReady === 'true');

  const state = await page.evaluate(() => {
    const report = window.__sdocBrowserPerformance?.report();
    const popup = document.querySelector<HTMLDivElement>('.code-block-language-popup');
    return {
      popupCount: document.querySelectorAll('.code-block-language-popup').length,
      popupHidden: popup?.hidden ?? false,
      ...report?.context,
    };
  });

  expect(state).toMatchObject({
    popupCount: 1,
    popupHidden: true,
    domCodeBlockCount: 250,
    domCodeLanguageOptionCount: 0,
    codeBlockReactRootsCurrent: 0,
    codeBlockLanguageTriggersCurrent: 250,
    codeBlockLanguageControllersCurrent: 1,
    codeBlockLanguageControllersMaximum: 1,
    codeBlockLanguagePopupsCurrent: 1,
    codeBlockLanguagePopupsMaximum: 1,
  });
});

test('supports accessible language selection, composition, and history', async ({ page }) => {
  const { blocks, popup, select } = await openInteractionContract(page);

  const literalNullBlock = blocks.nth(0);
  const literalNullTrigger = literalNullBlock.locator('.code-block-language-trigger');
  await expect(literalNullBlock).toHaveAttribute('data-language', 'null');
  await expect(literalNullTrigger).toHaveAttribute('aria-haspopup', 'listbox');
  await expect(literalNullTrigger).toHaveAttribute('aria-expanded', 'false');
  await expect(literalNullTrigger).toHaveAttribute('aria-controls', /.+/);
  await expect(literalNullTrigger).toHaveAccessibleName(/Language.*null/i);
  await literalNullTrigger.focus();
  await expect(popup).toBeHidden();
  const beforeCommit = await page.evaluate(
    () => window.__sdocBrowserPerformance?.transactionCount() ?? -1,
  );
  await literalNullTrigger.click();
  await expect(literalNullTrigger).toHaveAttribute('data-activation-result', 'click');
  await expect(popup).toHaveAttribute('data-open-result', 'opened');
  await expect(popup).toBeVisible();
  await expect(select).toBeFocused();
  await expect(popup.getByRole('listbox')).toHaveCount(1);
  await expect(select.locator('option')).toHaveCount(194);
  await expect(select.locator('option:checked')).toHaveText('null');
  const openProbe = await page.evaluate(
    (baseline) => window.__sdocBrowserPerformance?.transactionProbe()
      .filter(({ sequence }) => sequence > baseline) ?? [],
    beforeCommit,
  );
  expect(openProbe.filter(({ docChanged }) => docChanged)).toEqual([]);
  const triggerBox = await literalNullTrigger.boundingBox();
  const popupBox = await popup.boundingBox();
  expect(triggerBox).not.toBeNull();
  expect(popupBox).not.toBeNull();
  expect(popupBox!.x).toBeGreaterThanOrEqual(0);
  expect(popupBox!.y).toBeGreaterThanOrEqual(0);
  expect(popupBox!.x + popupBox!.width).toBeLessThanOrEqual(1280);
  expect(popupBox!.y + popupBox!.height).toBeLessThanOrEqual(720);
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await expect(popup).toBeHidden();
  await expect(literalNullTrigger).toBeFocused();
  await expect(literalNullBlock).toHaveAttribute('data-language-kind', 'auto');
  const commitProbe = await page.evaluate(
    (baseline) => window.__sdocBrowserPerformance?.transactionProbe()
      .filter(({ sequence }) => sequence > baseline) ?? [],
    beforeCommit,
  );
  expect(commitProbe.filter(({ docChanged }) => docChanged)).toEqual([
    expect.objectContaining({ stepCount: 1, addToHistory: null }),
  ]);
  for (const transaction of commitProbe.filter(({ docChanged }) => !docChanged)) {
    expect(transaction).toEqual(expect.objectContaining({
      stepCount: 0,
      selectionSet: false,
      addToHistory: null,
      uiEvent: false,
      pointer: false,
      composition: false,
    }));
  }
  expect(await page.evaluate(() => window.__sdocBrowserPerformance?.undo())).toBe(true);
  await expect(literalNullBlock).toHaveAttribute('data-language', 'null');
  expect(await page.evaluate(() => window.__sdocBrowserPerformance?.redo())).toBe(true);
  expect(await page.evaluate(() => window.__sdocBrowserPerformance?.undo())).toBe(true);

  const customBlock = blocks.nth(1);
  const customTrigger = customBlock.locator('.code-block-language-trigger');
  await customTrigger.focus();
  await page.keyboard.press('Space');
  await expect(select.locator('option:checked')).toHaveText('custom:언어');
  await page.keyboard.press('Escape');
  await expect(popup).toBeHidden();
  await expect(customTrigger).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.type('type');
  await select.dispatchEvent('compositionstart', { data: 't' });
  await page.keyboard.press('Enter');
  await expect(popup).toBeVisible();
  await select.dispatchEvent('compositionend', { data: 't' });
  await page.keyboard.press('Enter');
  await expect(customBlock).toHaveAttribute('data-language', 'typescript');
  expect(await page.evaluate(() => window.__sdocBrowserPerformance?.undo())).toBe(true);

  const emptyBlock = blocks.nth(2);
  const emptyTrigger = emptyBlock.locator('.code-block-language-trigger');
  await expect(emptyBlock).toHaveAttribute('data-language-kind', 'string');
  await emptyTrigger.focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(select.locator('option:checked')).toHaveAttribute('data-language-empty', 'true');
  await page.keyboard.press('Tab');
  await expect(popup).toBeHidden();
  await expect(emptyTrigger).toBeFocused();

  await emptyTrigger.press('Alt+ArrowDown');
  await select.locator('option').filter({ hasText: 'typescript' }).click();
  await expect(popup).toBeHidden();
  await expect(emptyTrigger).toBeFocused();
  await expect(emptyBlock).toHaveAttribute('data-language', 'typescript');
});

test('closes stale language sessions across replacement, deletion, and print', async ({ page }) => {
  const { blocks, popup } = await openInteractionContract(page);
  const literalNullTrigger = blocks.nth(0).locator('.code-block-language-trigger');
  const customTrigger = blocks.nth(1).locator('.code-block-language-trigger');

  await customTrigger.click();
  await expect(popup).toBeVisible();
  expect(await page.evaluate(() => window.__sdocBrowserPerformance?.replaceCodeBlockText(1)))
    .toBe(true);
  await expect(popup).toBeHidden();
  await expect(customTrigger).toBeFocused();
  const afterReplacement = await page.evaluate(
    () => window.__sdocBrowserPerformance?.transactionCount() ?? -1,
  );
  await customTrigger.press('Enter');
  await expect(popup).toBeVisible();
  const reopenProbe = await page.evaluate(
    (baseline) => window.__sdocBrowserPerformance?.transactionProbe()
      .filter(({ sequence }) => sequence > baseline) ?? [],
    afterReplacement,
  );
  expect(reopenProbe.filter(({ docChanged }) => docChanged)).toEqual([]);
  await page.keyboard.press('Escape');

  await customTrigger.click();
  await expect(popup).toBeVisible();
  expect(await page.evaluate(() => window.__sdocBrowserPerformance?.deleteCodeBlock(1))).toBe(true);
  await expect(popup).toBeHidden();
  await expect(blocks).toHaveCount(2);

  await literalNullTrigger.click();
  await expect(popup).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await expect(popup).toBeHidden();
});

test('closes the language session without a transaction when the editor becomes read-only', async ({ page }) => {
  const { blocks, popup, select } = await openInteractionContract(page);
  const literalNullTrigger = blocks.nth(0).locator('.code-block-language-trigger');

  await literalNullTrigger.click();
  await expect(popup).toBeVisible();
  const beforeReadOnly = await page.evaluate(
    () => window.__sdocBrowserPerformance?.transactionCount() ?? -1,
  );
  await page.evaluate(() => window.__sdocBrowserPerformance?.setEditable(false));
  await expect(popup).toBeHidden();
  await expect(select).not.toBeFocused();
  await expect(literalNullTrigger).toBeFocused();
  await expect(literalNullTrigger).toHaveAttribute('aria-disabled', 'true');
  expect(await page.evaluate(() => window.__sdocBrowserPerformance?.transactionCount()))
    .toBe(beforeReadOnly);
  const readOnlyTransactions = await page.evaluate(
    () => window.__sdocBrowserPerformance?.transactionCount() ?? -1,
  );
  await page.keyboard.press('Enter');
  await expect(popup).toBeHidden();
  expect(await page.evaluate(() => window.__sdocBrowserPerformance?.transactionCount()))
    .toBe(readOnlyTransactions);
});
