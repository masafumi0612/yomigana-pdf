import type { Page } from '@playwright/test';

import { expect, openFromFile, test } from './fixtures';

/** ルビが付く、横書きのお知らせ */
const HORIZONTAL_PRINT = 'horizontal-print.pdf';
/** 辞書の読み込みを含めて、最初のルビが出るまで待つ時間の上限（ミリ秒） */
const FIRST_RUBY_TIMEOUT_MS = 15_000;
/** ルビのない所を右クリックするときの、紙面の端からの長さ（px） */
const MARGIN_PX = 12;

/**
 * PDF を開き、ルビが出るのを待つ。
 * @param page 画面
 * @param extensionId 入れた拡張の ID
 */
async function openWithRuby(page: Page, extensionId: string): Promise<void> {
  await openFromFile(page, extensionId, HORIZONTAL_PRINT);
  await expect(page.locator('.ruby-layer > span').first()).toBeAttached({
    timeout: FIRST_RUBY_TIMEOUT_MS,
  });
}

/**
 * 紙面の左の余白の、バーに隠れていない所（ルビのない所）を右クリックする。
 * @param page 画面
 */
async function rightClickMargin(page: Page): Promise<void> {
  const pageBox = await page.locator('.page[data-page-number="1"]').boundingBox();
  const containerBox = await page.locator('#viewer-container').boundingBox();
  if (pageBox === null || containerBox === null) throw new Error('ページが見えていない');
  await page.mouse.click(pageBox.x + MARGIN_PX, containerBox.y + MARGIN_PX, { button: 'right' });
}

test('ルビのない所を右クリックしたとき、向きを直す項目と設定を開く項目を出す', async ({
  page,
  extensionId,
}) => {
  await openWithRuby(page, extensionId);

  await rightClickMargin(page);

  await expect(page.getByRole('menu').getByRole('menuitem')).toHaveText([
    '文字の向きを直す…',
    'ルビの設定を開く',
  ]);
  await expect(page.getByRole('menuitem', { name: '文字の向きを直す…' })).toBeFocused();
});

test('メニューで下の矢印を押したとき、次の項目に移る', async ({ page, extensionId }) => {
  await openWithRuby(page, extensionId);
  await rightClickMargin(page);

  await page.keyboard.press('ArrowDown');

  await expect(page.getByRole('menuitem', { name: 'ルビの設定を開く' })).toBeFocused();
});

test('メニューの最初の項目で上の矢印を押したとき、最後の項目に移る', async ({
  page,
  extensionId,
}) => {
  await openWithRuby(page, extensionId);
  await rightClickMargin(page);

  await page.keyboard.press('ArrowUp');

  await expect(page.getByRole('menuitem', { name: 'ルビの設定を開く' })).toBeFocused();
});

test('紙面で Shift+F10 を押したとき、メニューを開いて最初の項目に移る', async ({
  page,
  extensionId,
}) => {
  await openWithRuby(page, extensionId);
  await page.locator('#viewer-container').focus();

  await page.keyboard.press('Shift+F10');

  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.getByRole('menu').getByRole('menuitem').first()).toBeFocused();
});

test('メニューで Esc を押したとき、メニューを閉じて焦点が紙面に戻る', async ({
  page,
  extensionId,
}) => {
  await openWithRuby(page, extensionId);
  await rightClickMargin(page);

  await page.keyboard.press('Escape');

  await expect(page.getByRole('menu')).toBeHidden();
  await expect(page.locator('#viewer-container')).toBeFocused();
});

test('「ルビの設定を開く」を押したとき、設定の画面が開く', async ({
  page,
  context,
  extensionId,
}) => {
  const optionsUrl = `chrome-extension://${extensionId}/options.html`;
  // 初めて入れたときに開く設定の画面を閉じ、新しく開いたことが分かるようにする
  for (const other of context.pages()) {
    if (other.url() === optionsUrl) await other.close();
  }
  await openWithRuby(page, extensionId);
  await rightClickMargin(page);

  const opened = context.waitForEvent('page');
  await page.getByRole('menuitem', { name: 'ルビの設定を開く' }).click();

  await expect(await opened).toHaveURL(optionsUrl);
});
