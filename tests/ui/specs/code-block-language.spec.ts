import { expect, test } from '@playwright/test';

test('shares one accessible code-language listbox across a rich 5k editor', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/performance.html?corpus=rich-mixed-5k');
  await page.waitForFunction(() => document.documentElement.dataset.performanceReady === 'true');

  const editor = page.locator('.ProseMirror');
  const blocks = editor.locator('.code-block');
  const popup = page.locator('.code-block-language-popup');
  const select = popup.locator('select');
  await expect(blocks).toHaveCount(250);
  await expect(popup).toHaveCount(1);
  await expect(popup).toBeHidden();

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
  expect(await page.evaluate(() => window.__sdocBrowserPerformance?.transactionCount()))
    .toBe(beforeCommit);
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
  expect(commitProbe.filter(({ docChanged }) => !docChanged)).toEqual([
    expect.objectContaining({
      stepCount: 0,
      selectionSet: false,
      addToHistory: null,
      uiEvent: false,
      pointer: false,
      composition: false,
    }),
  ]);
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
  expect(await page.evaluate(() => window.__sdocBrowserPerformance?.transactionCount()))
    .toBe(afterReplacement);
  await page.keyboard.press('Escape');

  await customTrigger.click();
  await expect(popup).toBeVisible();
  expect(await page.evaluate(() => window.__sdocBrowserPerformance?.deleteCodeBlock(1))).toBe(true);
  await expect(popup).toBeHidden();
  expect(await page.evaluate(() => window.__sdocBrowserPerformance?.undo())).toBe(true);

  await literalNullTrigger.click();
  await expect(popup).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await expect(popup).toBeHidden();

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
