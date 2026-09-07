import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { Editor } from '@tiptap/core';

async function openTable(page: Page, options: { width?: number; columns?: number; theme?: string; locale?: string; editable?: boolean; rows?: 3 | 30 } = {}) {
  const { width = 320, columns = 8, theme = 'light', locale = 'en', editable = false, rows = 3 } = options;
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`/?theme=${theme}&locale=${locale}&columns=${columns}&tableEditable=${editable ? '1' : '0'}&tableRows=${rows}`);
  await page.locator('.quality-harness[data-ready="true"]').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: '.host-badge { display: none; }' });
  const wrapper = page.locator('.fixture-table-region .table-node-wrapper');
  await wrapper.scrollIntoViewIfNeeded();
  return {
    wrapper,
    region: wrapper.locator('.table-scroll-controls'),
    controls: wrapper.locator('.table-scroll-controls'),
    status: wrapper.locator('.table-scroll-status'),
  };
}

test('table scroll controls describe start, middle and end with hidden scrollbars', async ({ page }) => {
  const { wrapper, region, controls, status } = await openTable(page);
  await page.addStyleTag({ content: '.table-container { scrollbar-width: none; } .table-container::-webkit-scrollbar { display: none; }' });
  await expect(controls).toBeVisible();
  await expect(status).toHaveText('More columns to the right · 0%');
  await expect(wrapper.getByRole('button', { name: 'Scroll table left' })).toBeDisabled();
  await region.focus();
  await expect(wrapper.locator('.table-scroll-instructions')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(status).toContainText('More columns on both sides');
  await page.keyboard.press('End');
  await expect(status).toHaveText('More columns to the left · 100%');
  await expect(wrapper.getByRole('button', { name: 'Scroll table right' })).toBeDisabled();
  await page.keyboard.press('Home');
  await expect(status).toHaveText('More columns to the right · 0%');
  await wrapper.getByRole('button', { name: 'Scroll table right' }).click();
  await expect(status).toContainText('More columns on both sides');
  await wrapper.getByRole('button', { name: 'Scroll table left' }).click();
  await expect(status).toHaveText('More columns to the right · 0%');
});

test('three-column tables that fit have no scroll hints', async ({ page }) => {
  const { controls, region } = await openTable(page, { width: 480, columns: 3 });
  await expect(controls).toBeHidden();
  await expect(region).not.toHaveAttribute('aria-describedby');
});

test('table scroll hints follow pane resizing', async ({ page }) => {
  const { controls } = await openTable(page, { width: 800, columns: 5 });
  await expect(controls).toBeHidden();
  await page.setViewportSize({ width: 320, height: 900 });
  await expect(controls).toBeVisible();
  await page.setViewportSize({ width: 800, height: 900 });
  await expect(controls).toBeHidden();
});

test('keyboard users reach and edit first and last cells and return to scrolling', async ({ page }) => {
  const { wrapper, region, status } = await openTable(page, { editable: true });
  const first = wrapper.locator('th').first();
  const last = wrapper.locator('th').last();
  await wrapper.locator('.table-caption-display').focus();
  await page.keyboard.press('Tab');
  await expect(region).toBeFocused();
  await page.keyboard.press('End');
  await expect(status).toHaveText('More columns to the left · 100%');
  await page.keyboard.press('Enter');
  await page.keyboard.type('LAST ');
  await expect(last).toContainText('LAST Column 8');
  await page.keyboard.press('Escape');
  await expect(region).toBeFocused();
  await page.keyboard.press('Home');
  await expect(status).toHaveText('More columns to the right · 0%');
  await page.keyboard.press('Enter');
  await page.keyboard.type('FIRST ');
  await expect(first).toContainText('FIRST Column 1');
  await page.keyboard.press('Escape');
  await expect(region).toBeFocused();
  await page.getByRole('button', { name: 'Toggle test read only' }).click();
  await region.focus();
  await expect(wrapper.locator('.table-scroll-instructions')).not.toContainText('Enter to edit');
  await page.keyboard.press('Enter');
  await expect(region).toBeFocused();
  await expect(first).toContainText('FIRST Column 1');
});

test('table column edits update sizing and overflow without remounting', async ({ page }) => {
  const { wrapper, controls } = await openTable(page, { width: 480, columns: 3, editable: true });
  await expect(controls).toBeHidden();
  await wrapper.locator('th').first().click();
  await page.getByRole('button', { name: 'Add test column', exact: true }).click();
  await page.getByRole('button', { name: 'Add test column', exact: true }).click();
  await expect(wrapper.locator('th')).toHaveCount(5);
  await expect(wrapper.locator('table')).toHaveAttribute('style', /min-width: 30rem/);
  await page.setViewportSize({ width: 320, height: 900 });
  await expect(controls).toBeVisible();
  await page.getByRole('button', { name: 'Delete test column', exact: true }).click();
  await page.getByRole('button', { name: 'Delete test column', exact: true }).click();
  await expect(wrapper.locator('th')).toHaveCount(3);
  await expect(controls).toBeHidden();
});

test('Escape from a tall table visibly restores controls without losing horizontal position', async ({ page }) => {
  const { wrapper, region } = await openTable(page, { editable: true, rows: 30 });
  const lastCell = wrapper.locator('td').last();
  await lastCell.click();
  await expect.poll(() => lastCell.evaluate(cell => {
    const { view } = (cell.closest('.ProseMirror') as HTMLElement & { editor: Editor }).editor;
    return cell.contains(view.domAtPos(view.state.selection.from).node);
  })).toBe(true);
  const container = wrapper.locator('.table-container');
  const offset = await container.evaluate(element => element.scrollLeft);
  expect(offset).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await expect(region).toBeFocused();
  await expect(region).toBeInViewport();
  await expect.poll(() => container.evaluate(element => element.scrollLeft)).toBe(offset);
});

test('fitting a focused table transfers focus to its visible caption', async ({ page }) => {
  const { wrapper, controls } = await openTable(page, { columns: 5 });
  await controls.getByRole('button', { name: 'Scroll table right' }).focus();
  await page.setViewportSize({ width: 800, height: 900 });
  await expect(controls).toBeHidden();
  const caption = wrapper.locator('.table-caption-display');
  await expect(caption).toBeFocused();
  await expect(caption).toBeInViewport();
});

test('keyboard focus survives when a scroll button reaches either edge', async ({ page }) => {
  const { controls } = await openTable(page);
  for (const direction of ['left', 'right']) {
    await controls.focus();
    await page.keyboard.press(direction === 'right' ? 'End' : 'Home');
    await page.keyboard.press(direction === 'right' ? 'ArrowLeft' : 'ArrowRight');
    const button = controls.getByRole('button', { name: `Scroll table ${direction}` });
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(button).toBeDisabled();
    await expect(controls).toBeFocused();
  }
});

for (const theme of ['light', 'dark', 'hc']) {
  test(`table hints in ${theme} remain accessible at 320px and 200% zoom`, async ({ page }) => {
    const { wrapper, region, controls } = await openTable(page, { theme, locale: theme === 'hc' ? 'ko' : 'en' });
    await expect(controls).toBeVisible();
    await region.focus();
    await expect(wrapper).toHaveScreenshot(`table-scroll-${theme}-320.png`);
    await page.setViewportSize({ width: 640, height: 1200 });
    await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
    await wrapper.scrollIntoViewIfNeeded();
    await expect(controls).toBeVisible();
    const bounds = await controls.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(641);
    const audit = await new AxeBuilder({ page }).include('.fixture-table-region').analyze();
    expect(audit.violations).toEqual([]);
    await expect(wrapper).toHaveScreenshot(`table-scroll-${theme}-200.png`);
  });
}
